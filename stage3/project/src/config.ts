import { stageConfig } from '../../../config/index.js';

// 配置统一来自 monorepo 根目录的 config/index.ts（唯一读 .env 的地方）。
// 阶段3 除了通用字段，还需要自己的路径（projectRoot / data / memory.json），
// stageConfig(import.meta.url) 会按「本文件位于 <stage>/project/src/」自动推出项目根目录。
export const config = stageConfig(import.meta.url);

export { checkConfig, MONOREPO_ROOT, ROOT_ENV_PATH } from '../../../config/index.js';
