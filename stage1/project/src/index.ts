import OpenAI from 'openai';
import readline from 'node:readline/promises';
import { config, checkConfig } from './config.js';
import { Conversation } from './chat.js';

checkConfig();

const client = new OpenAI({
  baseURL: config.baseURL,
  apiKey: config.apiKey,
});

const convo = new Conversation(client);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('=== 阶段1：带工具的聊天机器人 ===');
console.log(`模型: ${config.model}`);
console.log('命令：/dump 查看消息历史 | exit 退出\n');

async function main() {
  while (true) {
    const input = (await rl.question('你 > ')).trim();
    if (!input) continue;
    if (input === 'exit' || input === 'quit') break;
    if (input === '/dump') {
      console.log('\n--- 当前消息历史 ---');
      console.log(convo.dumpHistory());
      console.log('--- 结束 ---\n');
      continue;
    }

    try {
      const answer = await convo.ask(input);
      console.log(`\n助手 > ${answer}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n[错误] ${msg}\n`);
      console.error('如果是连接或鉴权报错，请检查 .env 里的 API_BASE_URL / API_KEY / MODEL 是否填对。');
    }
  }
  rl.close();
}

main();
