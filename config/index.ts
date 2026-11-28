import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// monorepo 统一配置中心
//
// 所有 stage 子项目都从这里读配置，不再各自维护一份 config.ts：
//   - 环境变量只认根目录 .env（learn-llm/.env），来源唯一；
//   - 通用字段（模型、密钥、预算、步数、开关）在这里解析一次；
//   - 与 stage 相关的路径（projectRoot / data / memory）用 createStageConfig 生成。
//
// 为什么不用无参 dotenv.config()：
// 它读 process.cwd()/.env，而 pnpm workspace 会把 cwd 设到子项目目录，
// 可能读到子项目里残留的 .env，把根目录配置悄悄覆盖掉。
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** monorepo 根目录（learn-llm/）。本文件位于 <root>/config/index.ts，往上一位即是。 */
export const MONOREPO_ROOT = path.resolve(__dirname, '..');
/** 唯一的环境变量文件路径：<root>/.env */
export const ROOT_ENV_PATH = path.join(MONOREPO_ROOT, '.env');

dotenv.config({ path: ROOT_ENV_PATH });

/** 读取正整数环境变量，非法（非数字 / ≤0）时用默认值 */
function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** 读取开关型环境变量：默认开，显式写 off/false/0/no 才关 */
function flag(name: string, defaultValue = true): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return !['off', 'false', '0', 'no'].includes(raw.trim().toLowerCase());
}

/** 所有子项目共用的配置字段 */
export type SharedConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
  /** ReAct 最大步数（刹车），阶段 2/3 使用 */
  maxSteps: number;
  /** 上下文预算（估算 token），阶段 3 使用 */
  contextBudgetTokens: number;
  /** 回答后是否自动抽取长期记忆，阶段 3 使用 */
  memoryExtract: boolean;
  /** 是否使用流式输出，阶段 3 使用 */
  stream: boolean;
};

function readShared(): SharedConfig {
  return {
    baseURL: process.env.API_BASE_URL ?? '',
    apiKey: process.env.API_KEY ?? '',
    model: process.env.MODEL ?? 'gpt-4o-mini',

    // 上下文预算故意设得比模型窗口小很多：让「压缩」在练习时真的会发生。
    contextBudgetTokens: positiveInt('CONTEXT_BUDGET_TOKENS', 8000),
    maxSteps: positiveInt('MAX_STEPS', 12),
    memoryExtract: flag('MEMORY_EXTRACT', true),
    stream: flag('STREAM', true),
  };
}

/** 通用配置（阶段 1/2 只需要其中 baseURL / apiKey / model） */
export const config: SharedConfig = readShared();

/** 某个 stage 的完整配置：通用字段 + 该 stage 自己的路径 */
export type StageConfig = SharedConfig & {
  projectRoot: string;
  dataDir: string;
  memoryFile: string;
};

/**
 * 生成某个 stage 的配置。
 * @param projectRoot 该 stage 的项目根目录，例如 stage3/project
 */
export function createStageConfig(projectRoot: string): StageConfig {
  const dataDir = path.join(projectRoot, 'data');
  return {
    ...readShared(),
    projectRoot,
    dataDir,
    memoryFile: path.join(dataDir, 'memory.json'),
  };
}

/**
 * 在子项目里一行拿到带路径的配置：
 *   const config = stageConfig(import.meta.url);
 * 约定调用方位于 <root>/stageN/project/src/ 下，其上一级即该 stage 的项目根目录。
 */
export function stageConfig(moduleUrl: string): StageConfig {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  return createStageConfig(path.resolve(moduleDir, '..'));
}

/**
 * 启动前校验，避免带着空配置跑起来后才发现报错。
 * 可以在任何 stage 调用；默认校验通用配置。
 */
export function checkConfig(cfg: Pick<SharedConfig, 'baseURL' | 'apiKey' | 'model'> = config): void {
  const missing: string[] = [];
  if (!cfg.baseURL) missing.push('API_BASE_URL');
  if (!cfg.apiKey) missing.push('API_KEY');
  if (!cfg.model) missing.push('MODEL');
  if (missing.length > 0) {
    console.error(`缺少环境变量：${missing.join(', ')}`);
    console.error('请先在 monorepo 根目录创建 .env 并填入中转站信息（可参考根目录 .env.example）');
    console.error(`期望的 .env 路径：${ROOT_ENV_PATH}`);
    process.exit(1);
  }
}
