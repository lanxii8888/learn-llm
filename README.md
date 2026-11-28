# learn-llm（monorepo）

Agent 开发学习项目，按阶段组织为多个子项目。使用 **npm workspaces**：
所有依赖统一声明在**根目录 [package.json](package.json)**，`npm install` 后会被 hoist 到根目录 `node_modules`，各子项目共享。

## 目录结构

```
learn-llm/
├── package.json            ← 根 workspace：声明全部依赖
├── tsconfig.base.json      ← 共享 TS 配置，子项目 extends 它
├── .env                    ← 唯一的环境变量文件（不进 git）
├── .env.example            ← 环境变量模板
├── config/index.ts         ← 统一配置中心：唯一读取 .env 的地方
├── .gitignore
├── agent开发学习路线.md     ← 总路线图
├── stage1/                 ← 阶段 1：带工具的聊天机器人
│   ├── README.md
│   ├── notes/              ← 学习笔记
│   └── project/            ← 子项目（workspace 成员）
│       ├── package.json    ← 只含 name/scripts，不含依赖
│       └── src/
├── stage2/                 ← 阶段 2：手写 ReAct Agent
│   ├── README.md
│   ├── notes/
│   └── project/
└── stage3/                 ← 阶段 3：上下文工程 + 记忆 + 结构化输出 + 流式 + 评估
    ├── README.md
    ├── notes/
    └── project/
```

## 配置读取（统一入口）

所有子项目的配置都来自根目录 [config/index.ts](config/index.ts)，它是**唯一读取 `.env` 的地方**：

- `.env` 只放根目录一份，子项目不再各自解析环境变量；
- 子项目的 `src/config.ts` 只是一行转发，保持 `./config.js` 的导入写法与阶段内教学可读性：

```ts
export const config = stageConfig(import.meta.url);
```

- 通用字段（`API_BASE_URL` / `API_KEY` / `MODEL` / `MAX_STEPS` / `CONTEXT_BUDGET_TOKENS` / `MEMORY_EXTRACT` / `STREAM`）集中解析；
- 与 stage 相关的路径（`projectRoot` / `dataDir` / `memoryFile`）由 `stageConfig()` 按调用文件位置自动推出。

## 安装（只需在根目录执行一次）

```bash
npm install
```

所有依赖装到根 `node_modules`，子项目靠 Node 向上查找自动解析到。

## 启动（各子项目单独启动）

**方式一：从根目录启动**

```bash
npm run start:stage1
# 阶段 2 / 3 同理
npm run start:stage2
npm run start:stage3
```

**方式二：进入子项目目录启动**

```bash
cd stage1/project
npm start
```

两种方式效果一样，只是启动目录不同。

## 添加新的阶段子项目

以后加 stage4、stage5，只需要：

1. 新建 `stage4/project/` 目录（会自动被 `stage*/project` 这个 workspace glob 纳入）
2. 子项目 `package.json` 里写一个唯一的 `name` 和 `start` 脚本
3. 新建 `src/config.ts`，一行接入统一配置：

   ```ts
   import { stageConfig } from '../../../config/index.js';
   export const config = stageConfig(import.meta.url);
   export { checkConfig, MONOREPO_ROOT, ROOT_ENV_PATH } from '../../../config/index.js';
   ```

4. 需要新的环境变量时，在**根目录** [config/index.ts](config/index.ts) 里加解析逻辑，并在根目录 `.env.example` 里补说明（子项目不再各自读 `.env`）
5. 需要新依赖时，在**根目录** `package.json` 里加，然后根目录重新 `npm install`

## 约定

- **依赖只在根目录声明**，子项目 `package.json` 不写 `dependencies`（只写 `name` / `type` / `scripts`）。
- **环境变量只在根目录 `.env` 声明**，配置解析只在 [config/index.ts](config/index.ts)，子项目 `src/config.ts` 只是转发。
- 子项目 `tsconfig.json` 通过 `extends` 复用根目录的 [tsconfig.base.json](tsconfig.base.json)。
- 每个阶段的具体说明见各自 `stageN/README.md`。
