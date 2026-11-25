import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// monorepo：.env 统一放在项目根目录（learn-llm/）。
// 本文件位于 stage1/project/src/config.ts，往上三级即根目录。
// 不用 import 'dotenv/config'，因为它默认读 process.cwd()，而 workspace 脚本
// 会把 cwd 设到子项目目录，读不到根目录的 .env。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnvPath });
// 兜底：若根目录没有，再读 cwd 下的 .env
dotenv.config();

export const config = {
  baseURL: process.env.API_BASE_URL ?? '',
  apiKey: process.env.API_KEY ?? '',
  model: process.env.MODEL ?? 'gpt-4o-mini',
} as const;

// 启动前校验，避免带着空配置跑起来后才发现报错
export function checkConfig(): void {
  const missing: string[] = [];
  if (!config.baseURL) missing.push('API_BASE_URL');
  if (!config.apiKey) missing.push('API_KEY');
  if (!config.model) missing.push('MODEL');
  if (missing.length > 0) {
    console.error(`缺少环境变量：${missing.join(', ')}`);
    console.error('请先在项目根目录创建 .env（可参考 stage1/project/.env.example）并填入中转站信息');
    process.exit(1);
  }
}
