import { stageConfig } from '../../../config/index.js';

// 配置统一来自 monorepo 根目录的 config/index.ts（唯一读 .env 的地方）。
// stageConfig(import.meta.url) 依据「本文件位于 <stage>/project/src/」推出项目根目录，
// 返回值同时包含通用字段（baseURL/apiKey/model…）与该 stage 的路径（projectRoot/data/memoryFile）。
export const config = stageConfig(import.meta.url);

export { checkConfig, MONOREPO_ROOT, ROOT_ENV_PATH } from '../../../config/index.js';
