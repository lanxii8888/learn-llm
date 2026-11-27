import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnvPath });
dotenv.config();

export const config = {
  baseURL: process.env.API_BASE_URL ?? '',
  apiKey: process.env.API_KEY ?? '',
  model: process.env.MODEL ?? 'gpt-4o-mini',
} as const;

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
