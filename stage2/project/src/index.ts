import OpenAI from 'openai';
import readline from 'node:readline/promises';
import { config, checkConfig } from './config.js';
import { ReactAgent } from './agent.js';

checkConfig();

const client = new OpenAI({
  baseURL: config.baseURL,
  apiKey: config.apiKey,
});

const agent = new ReactAgent(client);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('=== 阶段2：手写 ReAct Agent（研究助理）===');
console.log(`模型: ${config.model}`);
console.log('命令：/trace 查看最近一次 ReAct 过程 | exit 退出');
console.log('示例：帮我调研「RAG」，读相关文档，写一份总结到 output/rag总结.md\n');

async function main() {
  while (true) {
    const input = (await rl.question('你 > ')).trim();
    if (!input) continue;
    if (input === 'exit' || input === 'quit') break;
    if (input === '/trace') {
      console.log('\n' + agent.getTrace() + '\n');
      continue;
    }

    try {
      console.log('\n[agent 思考中……]\n');
      const answer = await agent.run(input);
      console.log(`助手 > ${answer}\n`);
      console.log('（输入 /trace 可查看刚才的完整推理与工具调用过程）\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n[错误] ${msg}\n`);
      console.error('如果是连接/鉴权报错，请检查根目录 .env 的 API_BASE_URL / API_KEY / MODEL。');
    }
  }
  rl.close();
}

main();
