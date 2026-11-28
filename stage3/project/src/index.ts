import OpenAI from 'openai';
import { config, checkConfig } from './config.js';
import { ContextAgent } from './agent.js';
import { MemoryStore } from './memory.js';
import { runEval } from './eval.js';
import { formatTokens } from './tokens.js';
import { createPromptSession } from '../../../cli/index.js';

checkConfig();

const client = new OpenAI({
  baseURL: config.baseURL,
  apiKey: config.apiKey,
});

const memory = new MemoryStore(config.memoryFile);
const agent = new ContextAgent(client, memory);

const session = createPromptSession();

console.log('=== 阶段3：上下文工程 + 长期记忆 Agent ===');
console.log(`模型: ${config.model}`);
console.log(`上下文预算: ≈${formatTokens(config.contextBudgetTokens)} token | 最大步数: ${config.maxSteps}`);
console.log('命令：/trace 过程 | /context 上下文用量 | /memory 长期记忆 | /eval 跑评估 | /help 帮助 | exit 退出');
console.log('示例：帮我调研「RAG」，读相关文档，写一份总结到 output/rag总结.md');
console.log('示例：记住：我在做 agent 开发学习项目，目前在阶段3\n');

async function main() {
  while (!session.stopped()) {
    const input = await session.ask('你 > ');
    if (input === null) break; // Ctrl+C 或输入流关闭
    const line = input.trim();
    if (!line) continue;
    if (line === 'exit' || line === 'quit') break;

    if (line === '/help') {
      console.log(`
命令：
  /trace    查看最近一次执行的每一步（Thought / Action / Observation / 上下文压缩）
  /context  查看当前上下文的估算 token、预算、历史条数与记忆条数
  /memory   列出长期记忆；/memory clear 清空
  /eval     运行内置评估用例（会产生额外模型调用和费用）
  exit      退出
`);
      continue;
    }

    if (line === '/trace') {
      console.log('\n' + agent.getTrace() + '\n');
      continue;
    }

    if (line === '/context') {
      const s = agent.getContextStats();
      const pct = Math.round((s.tokens / s.budget) * 100);
      console.log(
        `\n[上下文] ≈${formatTokens(s.tokens)} / ${formatTokens(s.budget)} token（${pct}%）` +
          ` | 历史 ${s.messages} 条 | 长期记忆 ${s.memoryItems} 条\n`,
      );
      continue;
    }

    if (line === '/memory clear') {
      memory.clear();
      console.log('\n[记忆] 已清空。\n');
      continue;
    }

    if (line === '/memory') {
      const items = memory.list();
      if (items.length === 0) {
        console.log('\n[记忆] 暂无长期记忆。\n');
      } else {
        console.log(`\n[记忆] 共 ${items.length} 条：`);
        for (const item of items) {
          console.log(`- ${item.text}  (${item.source}, ${item.createdAt.slice(0, 10)})`);
        }
        console.log('');
      }
      continue;
    }

    if (line === '/eval') {
      await runEval(client, { verbose: true });
      continue;
    }

    try {
      let printed = false;
      // Ctrl+C 之后不再往 stdout 写（否则可能 EPIPE / EINVAL），同时让流式循环尽快收尾
      const onDelta = config.stream
        ? (text: string) => {
            if (session.stopped()) return;
            if (!printed) {
              process.stdout.write('\n助手 > ');
              printed = true;
            }
            process.stdout.write(text);
          }
        : undefined;

      const result = await agent.run(line, { onDelta });

      if (session.stopped()) break; // 生成期间被 Ctrl+C：丢弃这次结果，直接退出

      // 流式时正文已经边生成边打印了；非流式（或全程没有文本）才在这里补打印
      if (!printed) console.log(`\n助手 > ${result.answer}`);
      console.log('\n');

      const parts = [
        `步数 ${result.steps}`,
        `上下文 ≈${formatTokens(result.tokens)} token`,
        result.compacted ? `压缩 是${result.summaryCalls > 0 ? `（摘要 ${result.summaryCalls} 次）` : ''}` : '压缩 否',
        `新增记忆 ${result.memoryAdded.length}`,
      ];
      console.log(`[统计] ${parts.join(' | ')}`);
      if (result.contextNotes.length > 0) console.log(`[上下文] ${result.contextNotes.join('；')}`);
      for (const m of result.memoryAdded) console.log(`[记忆+] ${m.text}`);
      console.log('');
    } catch (err) {
      if (session.stopped()) break;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n[错误] ${msg}\n`);
      console.error('如果是连接/鉴权报错，请检查根目录 .env 的 API_BASE_URL / API_KEY / MODEL。\n');
    }
  }
  session.close();
  console.log('再见。');
}

main().catch((err) => {
  console.error('\n[致命错误]', err instanceof Error ? err.message : String(err));
  session.close();
  process.exitCode = 1;
});
