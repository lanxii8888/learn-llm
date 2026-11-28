import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// 真实的 token 计量应该用 tiktoken（OpenAI）或厂商提供的计数接口。
// 这里用一个「够用、可解释」的启发式：
//   - 中日韩字符：约 1 字符 ≈ 1 token（中文常见区间 0.6~1.2）
//   - 其他字符（英文/空格/标点）：约 4 字符 ≈ 1 token
// 它不精确，但用来做「预算守卫」的相对判断足够了。阶段3的笔记会讨论误差来源。
const CJK = /[㐀-鿿぀-ヿ가-힯豈-﫿]/;

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (CJK.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk + other / 4);
}

/** 把一条消息里所有可能占 token 的部分拼成文本 */
export function messageText(m: ChatCompletionMessageParam): string {
  const parts: string[] = [];
  if (typeof m.content === 'string') parts.push(m.content);
  else if (Array.isArray(m.content)) parts.push(JSON.stringify(m.content));
  if ('tool_calls' in m && m.tool_calls) parts.push(JSON.stringify(m.tool_calls));
  if ('name' in m && m.name) parts.push(String(m.name));
  return parts.join('\n');
}

/** 每条消息还有 role、分隔符等固定开销，粗略按 4 token 计 */
export function estimateMessageTokens(m: ChatCompletionMessageParam): number {
  return 4 + estimateTextTokens(messageText(m));
}

export function estimateTokens(messages: ChatCompletionMessageParam[]): number {
  return messages.reduce((n, m) => n + estimateMessageTokens(m), 0);
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
