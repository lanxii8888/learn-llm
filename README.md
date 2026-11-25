# learn-llm（monorepo）

Agent 开发学习项目，按阶段组织为多个子项目。使用 **npm workspaces**：
所有依赖统一声明在**根目录 [package.json](package.json)**，`npm install` 后会被 hoist 到根目录 `node_modules`，各子项目共享。

## 目录结构

```
learn-llm/
├── package.json            ← 根 workspace：声明全部依赖
├── tsconfig.base.json      ← 共享 TS 配置，子项目 extends 它
├── .gitignore
├── agent开发学习路线.md     ← 总路线图
└── stage1/                 ← 阶段 1
    ├── README.md
    ├── notes/              ← 学习笔记
    └── project/            ← 子项目（workspace 成员）
        ├── package.json    ← 只含 name/scripts，不含依赖
        └── src/
```

## 安装（只需在根目录执行一次）

```bash
npm install
```

所有依赖装到根 `node_modules`，子项目靠 Node 向上查找自动解析到。

## 启动（各子项目单独启动）

**方式一：从根目录启动**

```bash
npm run start:stage1
```

**方式二：进入子项目目录启动**

```bash
cd stage1/project
npm start
```

两种方式效果一样，只是启动目录不同。

## 添加新的阶段子项目

以后加 stage2、stage3，只需要：

1. 新建 `stage2/project/` 目录（会自动被 `stage*/project` 这个 workspace glob 纳入）
2. 子项目 `package.json` 里写一个唯一的 `name` 和 `start` 脚本
3. 需要新依赖时，在**根目录** `package.json` 里加，然后根目录重新 `npm install`

## 约定

- **依赖只在根目录声明**，子项目 `package.json` 不写 `dependencies`（只写 `name` / `type` / `scripts`）。
- 子项目 `tsconfig.json` 通过 `extends` 复用根目录的 [tsconfig.base.json](tsconfig.base.json)。
- 每个阶段的具体说明见各自 `stageN/README.md`。
