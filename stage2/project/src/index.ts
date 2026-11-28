import OpenAI from 'openai';
import { config, checkConfig } from './config.js';
import { ReactAgent } from './agent.js';
import { createPromptSession } from '../../../cli/index.js';

checkConfig();

const client = new OpenAI({
  baseURL: config.baseURL,
  apiKey: config.apiKey,
});

const agent = new ReactAgent(client);

const session = createPromptSession();

console.log('=== 阶段2：手写 ReAct Agent（研究助理）===');
console.log(`模型: ${config.model}`);
console.log('命令：/trace 查看最近一次 ReAct 过程 | exit 退出');
console.log('示例：帮我调研「RAG」，读相关文档，写一份总结到 output/rag总结.md\n');

async function main() {
  while (!session.stopped()) {
    const input = await session.ask('你 > ');
    if (input === null) break; // Ctrl+C 或输入流关闭
    const line = input.trim();
    if (!line) continue;
    if (line === 'exit' || line === 'quit') break;
    if (line === '/trace') {
      console.log('\n' + agent.getTrace() + '\n');
      continue;
    }

    try {
      console.log('\n[agent 思考中……]\n');
      const answer = await agent.run(line);
      if (session.stopped()) break; // 生成期间被 Ctrl+C：丢弃这次结果，直接退出
      console.log(`助手 > ${answer}\n`);
      console.log('（输入 /trace 可查看刚才的完整推理与工具调用过程）\n');
    } catch (err) {
      if (session.stopped()) break;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n[错误] ${msg}\n`);
      console.error('如果是连接/鉴权报错，请检查根目录 .env 的 API_BASE_URL / API_KEY / MODEL。');
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
