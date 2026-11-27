import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { config } from './config.js';
import { tools, executeTool } from './tools.js';

const SYSTEM_PROMPT = `你是一个有帮助的助手，可以查询天气、计算数学表达式。
规则：
- 用户问天气时，必须调用 get_weather 工具，不要自己编造天气。
- 用户问数学计算时，必须调用 calculate 工具，不要心算。
- 其他问题直接回答。
- 回答使用中文。`;

const MAX_LOOP = 5; // 单次提问最多循环几轮（阶段2会专门讲为什么限制步数）

export class Conversation {
  // messages 就是 agent 的「短期记忆」，每次请求都会把整份历史重新发一遍
  private messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // client OpenAI实例
  constructor(private client: OpenAI) { }

  async ask(userInput: string): Promise<string> {
    // 1. 把用户输入追加进历史
    this.messages.push({ role: 'user', content: userInput });

    // 2. 循环：可能触发多次工具调用，直到模型给出最终回答
    for (let step = 0; step < MAX_LOOP; step++) {
      const resp = await this.client.chat.completions.create({
        model: config.model,
        messages: this.messages,
        tools: tools,
      });

      const choice = resp.choices[0];
      const message = choice.message;

      // 3. 如果模型决定调用工具
      if (message.tool_calls && message.tool_calls.length > 0) {
        // 先把 assistant 的这条 tool_calls 消息追加进历史
        this.messages.push(message as ChatCompletionMessageParam);

        // 逐个执行工具（这里串行执行；并行工具阶段4会讲）
        for (const tc of message.tool_calls) {
          const name = tc.function.name;
          const args = JSON.parse(tc.function.arguments || '{}');
          console.log(`\n  [tool] 调用 ${name}(${JSON.stringify(args)})`);

          const result = executeTool(name, args);
          console.log(`  [tool] 结果: ${result}`);

          // 结果回填：必须带 tool_call_id，让模型知道对应哪次调用
          this.messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result,
          });
        }
        // 继续循环，把带工具结果的历史再发给模型
        continue;
      }

      // 4. 模型给出最终回答
      const content = message.content ?? '(空回答)';
      this.messages.push({ role: 'assistant', content });
      return content;
    }

    // 超出最大步数仍没拿到最终答案
    return '（达到最大工具调用次数，仍未得到最终答案）';
  }

  // 供 /dump 命令查看当前消息历史
  dumpHistory(): string {
    return this.messages
      .map((m) => {
        const head = `[${m.role}]`;
        if (m.role === 'assistant' && m.tool_calls) {
          const calls = m.tool_calls.map((tc) => `${tc.function.name}(${tc.function.arguments})`).join(', ');
          return `${head} tool_calls: ${calls}`;
        }
        const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `${head} ${c}`;
      })
      .join('\n');
  }
}
