import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { config } from './config.js';
import { estimateTokens, messageText } from './tokens.js';

// ============================================================
// 阶段3核心 #1：上下文工程
//
// agent 每一步都会把「整段历史」重新发给模型（这是它记住东西的唯一方式），
// 所以历史只会越来越长。ContextManager 负责在超预算时把它压回去：
//
//   1) 摘要（summarization）：把「旧的一整轮对话」交给模型压成要点。
//      只在 user 消息边界切，避免把 assistant.tool_calls 和对应的 tool 结果切开。
//   2) 硬截断（hard trim）：如果摘要之后仍然超，截断最长的工具观察正文。
//      只动 content，不动 role / tool_call_id 这些结构。
//   3) 丢旧轮次（drop）：最后的兜底，整轮丢弃（会真的忘事，日志里要说清楚）。
//
// 压缩是有代价的：信息一旦丢了就找不回来。所以优先级永远是「先摘要、后截断、最后丢」。
// ============================================================

const SUMMARY_PROMPT = `你是一个上下文压缩器。把下面这段 agent 执行历史压缩成要点（中文，不超过 300 字）。
必须保留：
1. 用户的原始任务与明确要求；
2. 已经从工具里查到的关键结论、数字、来源文件名；
3. 尚未完成的事项。
可以丢弃：重复的工具输出、无关的中间推理、已被后续步骤推翻的猜测。
直接输出压缩结果，不要加任何前缀。`;

export type ContextOptions = {
  budgetTokens?: number;
  /** 压缩时至少保留最近多少条消息不动 */
  keepRecent?: number;
  /** 是否允许调用模型做摘要（关闭则退化为截断） */
  enableSummary?: boolean;
};

export type FitResult = {
  compacted: boolean;
  before: number;
  after: number;
  summaryCalls: number;
  note: string;
};

export class ContextManager {
  private budgetTokens: number;
  private keepRecent: number;
  private enableSummary: boolean;

  constructor(private client: OpenAI, opts: ContextOptions = {}) {
    this.budgetTokens = opts.budgetTokens ?? config.contextBudgetTokens;
    this.keepRecent = opts.keepRecent ?? 6;
    this.enableSummary = opts.enableSummary ?? true;
  }

  get budget(): number {
    return this.budgetTokens;
  }

  /**
   * 就地压缩 messages。返回压缩前后的估算与说明。
   * 注意：这个方法会修改数组，agent 持有的 this.messages 会随之变化。
   */
  async fit(messages: ChatCompletionMessageParam[]): Promise<FitResult> {
    const before = estimateTokens(messages);
    if (before <= this.budgetTokens) {
      return { compacted: false, before, after: before, summaryCalls: 0, note: '' };
    }

    let summaryCalls = 0;
    const notes: string[] = [];

    // ---- 1. 找一个安全的切点：从「只保留最近 keepRecent 条」开始，
    //         往前退到最近的 user 消息。tool 消息绝不会被从中间切开。
    let cut = Math.max(1, messages.length - this.keepRecent);
    while (cut > 1 && messages[cut]?.role !== 'user') cut--;

    if (cut > 1) {
      const old = messages.slice(1, cut);
      let summary: string;
      if (this.enableSummary) {
        try {
          summary = await this.summarize(old);
          summaryCalls += 1;
          notes.push(`旧历史（${old.length} 条）已由模型摘要`);
        } catch (err) {
          summary = this.fallbackSummary(old);
          notes.push(`摘要调用失败，退化为截断：${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        summary = this.fallbackSummary(old);
        notes.push(`旧历史（${old.length} 条）已截断`);
      }
      // 用一个 system 消息占位，告诉模型「这里曾经有内容，但被压缩了」
      messages.splice(1, cut - 1, {
        role: 'system',
        content: `[历史摘要：为控制上下文，早先的对话与工具结果已被压缩]\n${summary}`,
      });
    } else {
      notes.push('没有可安全切分的旧轮次，跳过摘要');
    }

    // ---- 2. 摘要后仍然超预算 → 硬截断最长的工具观察（安全，只动正文）
    if (estimateTokens(messages) > this.budgetTokens) {
      const trimmed = this.hardTrimToolOutputs(messages);
      if (trimmed > 0) notes.push(`并截断了 ${trimmed} 条过长的工具观察`);
    }

    // ---- 3. 还是超 → 整轮丢弃（有损，最后手段）
    if (estimateTokens(messages) > this.budgetTokens) {
      const dropped = this.dropOldestTurns(messages);
      if (dropped > 0) notes.push(`并整轮丢弃了 ${dropped} 段旧对话（信息会丢失）`);
    }

    const after = estimateTokens(messages);
    return {
      // 只有真的把上下文压小了才算「发生了压缩」
      compacted: after < before,
      before,
      after,
      summaryCalls,
      note: notes.join('；'),
    };
  }

  // ---------- 三种压缩手段 ----------

  private async summarize(old: ChatCompletionMessageParam[]): Promise<string> {
    const transcript = this.buildTranscript(old);
    const resp = await this.client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: SUMMARY_PROMPT },
        { role: 'user', content: transcript },
      ],
      temperature: 0,
      max_tokens: 400,
    });
    const text = resp.choices[0].message.content?.trim() ?? '';
    if (!text) throw new Error('摘要返回为空');
    return text;
  }

  /** 不调模型时的退化摘要：只留每一轮的角色和开头，丢掉工具输出细节 */
  private fallbackSummary(old: ChatCompletionMessageParam[]): string {
    const lines: string[] = [];
    for (const m of old) {
      if (m.role === 'tool') continue;
      const text = messageText(m).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      lines.push(`- ${m.role}: ${clip(text, 160)}`);
    }
    return clip(lines.join('\n'), 1500);
  }

  /**
   * 摘要本身也要控制输入长度：如果旧历史特别长，只取头尾各一半。
   * （这有点反讽：负责压缩的东西，自己也需要预算守卫。）
   */
  private buildTranscript(old: ChatCompletionMessageParam[]): string {
    const raw = old
      .map((m) => `[${m.role}] ${messageText(m).replace(/\s+/g, ' ').trim()}`)
      .filter((line) => line.length > 6)
      .join('\n');
    const LIMIT = 12000;
    if (raw.length <= LIMIT) return raw;
    const half = Math.floor((LIMIT - 40) / 2);
    return `${raw.slice(0, half)}\n……（中间省略 ${raw.length - half * 2} 字符）……\n${raw.slice(-half)}`;
  }

  /** 只截断 tool 消息的正文，保持结构不变（tool_call_id 必须留着配对） */
  private hardTrimToolOutputs(messages: ChatCompletionMessageParam[]): number {
    let trimmed = 0;
    for (const m of messages) {
      if (estimateTokens(messages) <= this.budgetTokens) break;
      if (m.role !== 'tool') continue;

      const text = messageText(m);
      if (text.length <= 400) continue;

      const next = text.slice(0, 200) + '\n……（上下文超预算，此观察已截断；如仍需要请重新调用工具）';
      // 这里 content 在 tool 消息上必然是 string，但联合类型不允许直接赋值，做一次收窄
      (m as unknown as { content: string }).content = next;
      trimmed += 1;
    }
    return trimmed;
  }

  /**
   * 整轮丢弃：保留 system 和摘要，从最早的一轮开始删（删到下一个 user 之前）。
   * 只在连工具观察都截断了还超预算时才会走到这里。
   */
  private dropOldestTurns(messages: ChatCompletionMessageParam[]): number {
    let dropped = 0;
    while (estimateTokens(messages) > this.budgetTokens) {
      // [0] 永远是 system；如果 [1] 是我们的摘要，也从 [2] 开始删
      const start = messages[1]?.role === 'system' ? 2 : 1;
      let end = start + 1;
      while (end < messages.length && messages[end]?.role !== 'user') end++;
      // 只剩最后一轮 → 不能再删，否则模型连当前任务都看不到
      if (end >= messages.length || messages.length <= start + 1) break;
      messages.splice(start, end - start);
      dropped += 1;
    }
    return dropped;
  }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '……';
}
