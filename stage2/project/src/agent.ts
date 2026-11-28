import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { config } from './config.js';
import { tools, executeTool } from './tools.js';

// ---- 两个硬性上限：这是阶段2的核心考点 ----
// 1. MAX_STEPS：为什么必须限步数？
//    模型可能陷入「反复调工具也不给答案」的死循环（工具报错就重试、搜索没结果就换关键词……），
//    没有上限 = 无限烧钱 + 卡死。上限是 agent 的「刹车」。
//    取值来自统一配置（根目录 .env 的 MAX_STEPS），默认 12。
const MAX_STEPS = config.maxSteps;
// 2. 上下文预算：历史越攒越长，最终撞满模型上下文窗口就会直接报错。
//    这里用字符数做粗略估算（真实项目用 token 数），超了就压缩旧观察。见 notes/04。
const CONTEXT_BUDGET_CHARS = 60_000;

const SYSTEM_PROMPT = `你是一个研究助理 agent，必须严格分步推理再行动。

工作方式（ReAct）：
- 每一步先在心里想清楚「我现在知道什么、还缺什么、下一步该做什么」（Thought）。
- 需要外部信息时，调用工具（Action），等待结果（Observation），再继续推理。
- 不要凭记忆编造语料库里的内容——凡是涉及资料，必须先用工具查证。

规则：
- 了解有哪些资料用 list_docs；定位内容用 search_docs；阅读正文用 read_file。
- 用户要求「写总结/生成报告/写到文件」时，最终必须调用 write_file 落盘。
- 资料够了就停下来输出最终答案，不要无意义地反复调用工具。
- 用中文回答。`;

type TraceStep = {
  step: number;
  thought: string;              // 模型的推理（assistant content）
  actions: { name: string; args: string; observation: string }[]; // 行动 + 观察
};

export class ReactAgent {
  // messages = agent 的短期记忆。每步都整份重发。
  private messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];
  private trace: TraceStep[] = [];

  constructor(private client: OpenAI) { }

  async run(task: string): Promise<string> {
    this.trace = [];
    this.messages.push({ role: 'user', content: task });

    for (let step = 1; step <= MAX_STEPS; step++) {
      // 每步之前：检查上下文预算，超了就压缩（阶段3会深入，这里先有个意识）
      this.enforceContextBudget();

      const resp = await this.client.chat.completions.create({
        model: config.model,
        messages: this.messages,
        tools,
      });

      const message = resp.choices[0].message;
      // 模式匹配到用户问题需要调用tools中定义的工具时 message的object回返回需要调用的tool_calls
      /*
      伪代码👇
      for (step = 1; step <= MAX_STEPS; step++) {
        resp = 模型(全部 messages)     // 每步都发完整历史
        if (resp 有 tool_calls) {      // 判断：还要调工具
            执行工具 → 结果回填 → 继续下一轮
        } else {                        // 判断：不调了
          返回答案 → 结束
          }
      }
      */
      // ---- 这一步有工具调用 → 是 Act 阶段 ----
      if (message.tool_calls && message.tool_calls.length > 0) {
        // Thought：模型如果有说点什么（推理），记下来
        const thought = (message.content ?? '').trim();
        const record: TraceStep = { step, thought, actions: [] };

        // assistant 的 tool_calls 消息要先入历史
        this.messages.push(message as ChatCompletionMessageParam);

        for (const tc of message.tool_calls) {
          const name = tc.function.name;
          const rawArgs = tc.function.arguments || '{}';
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(rawArgs);
          } catch {
            // 参数解析失败的兜底：回填一条错误观察，让模型自己纠正（而不是整个崩掉）
            this.messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: '错误：工具参数不是合法 JSON，请重新生成调用参数。',
            });
            record.actions.push({ name, args: rawArgs, observation: '（参数解析失败）' });
            continue;
          }

          const observation = executeTool(name, args);

          // Observation 回填：带 tool_call_id，模型才知道对应哪次调用
          this.messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: observation,
          });
          record.actions.push({ name, args: rawArgs, observation });
        }

        this.trace.push(record);
        continue; // 带着观察结果进入下一轮推理
      }

      // ---- 没有工具调用 → 是最终答案，结束 ----
      const answer = (message.content ?? '').trim() || '(空回答)';
      this.messages.push({ role: 'assistant', content: answer });
      this.trace.push({ step, thought: answer, actions: [] });
      return answer;
    }

    // 用尽步数仍未收敛
    const msg = `（已用完 ${MAX_STEPS} 步仍未得到最终答案。这通常说明任务太大、或模型在工具调用上打转。可以拆小任务，或调大 MAX_STEPS。）`;
    this.trace.push({ step: MAX_STEPS, thought: msg, actions: [] });
    return msg;
  }

  // 上下文预算守卫：粗略统计历史字符数，超预算就压缩「最早的」工具观察结果。
  // 注意：我们只压缩 tool 消息的内容，保留消息结构（role/tool_call_id 不能动，否则模型会困惑）。
  private enforceContextBudget(): void {
    const total = this.messages.reduce((n, m) => n + lenOf(m), 0);
    if (total <= CONTEXT_BUDGET_CHARS) return;

    for (const m of this.messages) {
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 500) {
        m.content = m.content.slice(0, 200) + '\n……（为控制上下文已压缩此处旧观察）';
        const now = this.messages.reduce((n, x) => n + lenOf(x), 0);
        if (now <= CONTEXT_BUDGET_CHARS) break;
      }
    }
  }

  // 记录思考链条
  getTrace(): string {
    if (this.trace.length === 0) return '（还没有执行记录，先提一个问题）';
    return this.trace
      .map((t) => {
        const lines = [`── 第 ${t.step} 步 ──`];
        if (t.thought) lines.push(`Thought: ${t.thought}`);
        for (const a of t.actions) {
          lines.push(`Action: ${a.name}(${a.args})`);
          lines.push(`Observation: ${a.observation}`);
        }
        if (t.actions.length === 0) lines.push(`(最终答案)`);
        return lines.join('\n');
      })
      .join('\n\n');
  }
}

function lenOf(m: ChatCompletionMessageParam): number {
  if (typeof m.content === 'string') return m.content.length;
  if (Array.isArray(m.content)) return JSON.stringify(m.content).length;
  // 带 tool_calls 的 assistant 消息
  return JSON.stringify(m).length;
}
