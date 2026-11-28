import OpenAI from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';
import { config } from './config.js';
import { ContextManager } from './context.js';
import type { MemoryStore, MemoryItem } from './memory.js';
import { askJson, type JsonSchema } from './structured.js';
import { createToolset } from './tools.js';
import { estimateTokens, formatTokens } from './tokens.js';

// ============================================================
// 阶段3 的 agent：在阶段2「ReAct 循环」之上叠了四层工程能力
//
//   ReAct 循环（没变） + 上下文工程（ContextManager）
//                    + 长期记忆（MemoryStore：检索注入 + 事后抽取）
//                    + 流式输出（stream: true，边生成边展示）
//                    + 结构化输出（用于记忆抽取）
//
// 循环本身仍然是阶段2那个：每步把完整历史发给模型，有 tool_calls 就执行并回填，
// 没有就收尾。区别在于「发出去之前」要先过上下文预算，以及「收尾之后」要做记忆抽取。
// ============================================================

const SYSTEM_PROMPT = `你是一个研究助理 agent，必须严格分步推理再行动。

工作方式（ReAct）：
- 每一步先想清楚「我现在知道什么、还缺什么、下一步该做什么」（Thought）。
- 需要外部信息时调用工具（Action），等待结果（Observation），再继续推理。
- 不要凭记忆编造语料库里的内容——凡是涉及资料，必须先用工具查证。

工具使用规则：
- 了解有哪些资料用 list_docs；定位内容用 search_docs；阅读正文用 read_file。
- 读大文件要分块（start_line / max_lines），不要一次塞满上下文。
- 用户要求「写总结 / 生成报告 / 写到文件」时，最终必须调用 write_file 落盘。
- 只有用户明确要求、或信息长期有用时，才用 remember 写入长期记忆。
- 资料够了就停下来输出最终答案，不要无意义地反复调用工具。

上下文说明：
- 你的历史里可能出现 [历史摘要] 和 [相关长期记忆] 两个标记。
- [历史摘要] 是早先对话被压缩后的结果，可能丢失细节；需要时重新调用工具查证。
- [相关长期记忆] 是跨会话保存的旧信息，可作为背景参考，但事实仍以工具查证为准。

用中文回答。`;

export type StepTrace = {
  step: number;
  thought: string;
  actions: { name: string; args: string; observation: string }[];
  contextNote?: string;
};

export type RunOptions = {
  /** 传入则开启流式：模型每吐一个 delta 就回调一次 */
  onDelta?: (text: string) => void;
  /** 默认 true：把相关长期记忆检索出来注入本次任务 */
  useMemory?: boolean;
  /** 默认 true（且 config.memoryExtract 打开）：回答后自动抽取长期记忆 */
  extractMemory?: boolean;
};

export type RunResult = {
  answer: string;
  steps: number;
  compacted: boolean;
  summaryCalls: number;
  memoryAdded: MemoryItem[];
  /** 本次结束时的上下文估算 token */
  tokens: number;
  contextNotes: string[];
};

export type AgentOptions = {
  maxSteps?: number;
  budgetTokens?: number;
  keepRecent?: number;
  enableSummary?: boolean;
};

export class ContextAgent {
  private messages: ChatCompletionMessageParam[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  private trace: StepTrace[] = [];
  private ctx: ContextManager;
  private toolset: ReturnType<typeof createToolset>;
  private maxSteps: number;

  constructor(
    private client: OpenAI,
    private memory: MemoryStore | null = null,
    opts: AgentOptions = {},
  ) {
    this.maxSteps = opts.maxSteps ?? config.maxSteps;
    this.ctx = new ContextManager(client, {
      budgetTokens: opts.budgetTokens ?? config.contextBudgetTokens,
      keepRecent: opts.keepRecent ?? 6,
      enableSummary: opts.enableSummary ?? true,
    });
    this.toolset = createToolset(memory);
  }

  getContextStats() {
    return {
      tokens: estimateTokens(this.messages),
      budget: this.ctx.budget,
      messages: this.messages.length,
      traceSteps: this.trace.length,
      memoryItems: this.memory?.size() ?? 0,
    };
  }

  async run(task: string, opts: RunOptions = {}): Promise<RunResult> {
    this.trace = [];
    let compacted = false;
    let summaryCalls = 0;
    const contextNotes: string[] = [];

    // ---- 0. 长期记忆检索：把和本次任务相关的事实注入到 user 消息里。
    //     注入在 user 消息内（而不是额外 system 消息），这样每轮任务各带各的检索结果，
    //     不会在历史里无限堆叠。
    const hits =
      opts.useMemory !== false && this.memory ? this.memory.search(task, 3) : [];
    const userContent = hits.length > 0 ? `${formatMemoryHits(hits)}\n\n[当前任务]\n${task}` : task;
    this.messages.push({ role: 'user', content: userContent });

    for (let step = 1; step <= this.maxSteps; step++) {
      // ---- 1. 发请求前先做上下文预算守卫（可能触发摘要/截断）
      const fit = await this.ctx.fit(this.messages);
      if (fit.compacted) {
        compacted = true;
        summaryCalls += fit.summaryCalls;
        if (fit.note) contextNotes.push(`第 ${step} 步前：${fit.note}（≈${formatTokens(fit.before)} → ${formatTokens(fit.after)} token）`);
      }

      // ---- 2. 调模型（流式或普通）
      const { content, toolCalls } = opts.onDelta
        ? await this.callStreaming(opts.onDelta)
        : await this.callOnce();

      // ---- 3. 有工具调用 → Act + Observe，回填后继续循环
      if (toolCalls && toolCalls.length > 0) {
        const thought = content.trim();
        const record: StepTrace = { step, thought, actions: [] };
        if (fit.compacted) record.contextNote = fit.note;

        // assistant 的 tool_calls 必须先入历史，否则后面的 tool 消息找不到对应 id
        const assistantMsg: ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: thought || null,
          tool_calls: toolCalls,
        };
        this.messages.push(assistantMsg);

        for (const tc of toolCalls) {
          const name = tc.function.name;
          const rawArgs = tc.function.arguments || '{}';
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(rawArgs) as Record<string, unknown>;
          } catch {
            // 参数解析失败的兜底：回填错误观察，让模型自己纠正
            const msg = '错误（可恢复）：工具参数不是合法 JSON，请重新生成调用参数。';
            this.messages.push({ role: 'tool', tool_call_id: tc.id, content: msg });
            record.actions.push({ name, args: rawArgs, observation: msg });
            continue;
          }

          const observation = this.toolset.executeTool(name, args);
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: observation });
          record.actions.push({ name, args: rawArgs, observation: clip(observation, 300) });
        }

        this.trace.push(record);
        continue;
      }

      // ---- 4. 没有工具调用 → 最终答案
      const answer = content.trim() || '(空回答)';
      this.messages.push({ role: 'assistant', content: answer });
      this.trace.push({ step, thought: answer, actions: [] });

      // ---- 5. 回答之后：用结构化输出抽取长期记忆（额外一次模型调用）
      const memoryAdded: MemoryItem[] = [];
      const store = this.memory;
      if (opts.extractMemory !== false && config.memoryExtract && store) {
        try {
          const facts = await this.extractMemories(task, answer);
          for (const fact of facts) {
            const item = store.add(fact, { source: '自动抽取' });
            if (item) memoryAdded.push(item);
          }
        } catch (err) {
          contextNotes.push(`记忆抽取失败（不影响回答）：${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return {
        answer,
        steps: step,
        compacted,
        summaryCalls,
        memoryAdded,
        tokens: estimateTokens(this.messages),
        contextNotes,
      };
    }

    // ---- 步数用尽仍未收敛
    const msg = `（已用完 ${this.maxSteps} 步仍未得到最终答案。这通常说明任务太大、或模型在工具调用上打转。可以拆小任务，或调大 MAX_STEPS。）`;
    this.trace.push({ step: this.maxSteps, thought: msg, actions: [] });
    return {
      answer: msg,
      steps: this.maxSteps,
      compacted,
      summaryCalls,
      memoryAdded: [],
      tokens: estimateTokens(this.messages),
      contextNotes,
    };
  }

  // ---------- 调模型 ----------

  private async callOnce(): Promise<{ content: string; toolCalls: ChatCompletionMessageToolCall[] | undefined }> {
    const resp = await this.client.chat.completions.create({
      model: config.model,
      messages: this.messages,
      tools: this.toolset.tools,
    });
    const message = resp.choices[0].message;
    return { content: message.content ?? '', toolCalls: message.tool_calls };
  }

  /**
   * 流式调用。注意 tool_calls 在流里是「分片」到达的：
   * 同一个调用会按 index 拆成多次 delta，name 和 arguments 都要自己拼接。
   */
  private async callStreaming(onDelta: (text: string) => void): Promise<{
    content: string;
    toolCalls: ChatCompletionMessageToolCall[] | undefined;
  }> {
    const stream = await this.client.chat.completions.create({
      model: config.model,
      messages: this.messages,
      tools: this.toolset.tools,
      stream: true,
    });

    let content = '';
    const calls = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        onDelta(delta.content);
      }

      for (const tc of delta.tool_calls ?? []) {
        const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(tc.index, cur);
      }
    }

    const toolCalls: ChatCompletionMessageToolCall[] | undefined =
      calls.size === 0
        ? undefined
        : [...calls.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, c]) => ({
              id: c.id,
              type: 'function' as const,
              function: { name: c.name, arguments: c.args },
            }));

    return { content, toolCalls };
  }

  // ---------- 长期记忆抽取 ----------

  private async extractMemories(task: string, answer: string): Promise<string[]> {
    if (!this.memory) return [];
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          items: { type: 'string' },
          description: '值得跨会话长期记住的事实，每条一句完整的话；没有则返回空数组',
        },
      },
      required: ['facts'],
    };

    const data = await askJson<{ facts: string[] }>(this.client, {
      system:
        '你负责从对话中提炼长期记忆。只保留跨会话仍然有用的事实（用户偏好、项目背景、确认过的结论）；一次性任务细节不要记。只输出 JSON。',
      user: `用户任务：\n${clip(task, 1200)}\n\nagent 的最终回答：\n${clip(answer, 1500)}\n\n请抽取值得长期记住的事实；没有就返回 {"facts": []}。`,
      schema,
      maxTokens: 500,
    });

    return (Array.isArray(data.facts) ? data.facts : [])
      .map((f) => String(f).trim())
      .filter((f) => f.length >= 6 && f.length <= 300);
  }

  // ---------- 观察接口 ----------

  getTrace(): string {
    if (this.trace.length === 0) return '（还没有执行记录，先提一个问题）';
    return this.trace
      .map((t) => {
        const lines = [`── 第 ${t.step} 步 ──`];
        if (t.contextNote) lines.push(`[上下文] ${t.contextNote}`);
        if (t.thought) lines.push(`Thought: ${t.thought}`);
        for (const a of t.actions) {
          lines.push(`Action: ${a.name}(${a.args})`);
          lines.push(`Observation: ${a.observation}`);
        }
        if (t.actions.length === 0) lines.push('(最终答案)');
        return lines.join('\n');
      })
      .join('\n\n');
  }
}

function formatMemoryHits(hits: MemoryItem[]): string {
  return ['[相关长期记忆]', ...hits.map((h) => `- ${h.text}`), '[/相关长期记忆]'].join('\n');
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '……';
}
