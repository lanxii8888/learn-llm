import OpenAI from 'openai';
import { config, checkConfig } from './config.js';
import { Conversation } from './chat.js';
import { createPromptSession } from '../../../cli/index.js';

// 命令行调用入口
checkConfig();

const client = new OpenAI({
  baseURL: config.baseURL,
  apiKey: config.apiKey,
});

const convo = new Conversation(client);

const session = createPromptSession();

console.log('=== 阶段1：带工具的聊天机器人 ===');
console.log(`模型: ${config.model}`);
console.log('命令：/dump 查看消息历史 | exit 退出\n');

async function main() {
  while (!session.stopped()) {
    const input = await session.ask('你 > ');
    if (input === null) break; // Ctrl+C 或输入流关闭
    if (!input.trim()) continue;
    const line = input.trim();
    if (line === 'exit' || line === 'quit') break;
    if (line === '/dump') {
      console.log('\n--- 当前消息历史 ---');
      console.log(convo.dumpHistory());
      console.log('--- 结束 ---\n');
      continue;
    }

    try {
      const answer = await convo.ask(line);
      if (session.stopped()) break; // 等待回答期间被 Ctrl+C：丢弃结果，直接退出
      console.log(`\n助手 > ${answer}\n`);
    } catch (err) {
      if (session.stopped()) break;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n[错误] ${msg}\n`);
      console.error('如果是连接或鉴权报错，请检查根目录 .env 的 API_BASE_URL / API_KEY / MODEL 是否填对。');
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
