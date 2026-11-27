# stage2 子项目

这是阶段 2 的代码实现。**完整的学习说明、笔记目录、验收标准见上一级：[../README.md](../README.md)**。

## 快速开始

```bash
# 在 monorepo 根目录（learn-llm/）
pnpm install
pnpm run start:stage2
```

## 代码结构

- `src/agent.ts` — 手写 ReAct 循环（核心，先读这个）
- `src/tools.ts` — 4 个真实工具：list_docs / search_docs / read_file / write_file
- `src/index.ts` — 命令行入口（`/trace` 可查看完整推理过程）
- `corpus/` — 本地语料，作为搜索与阅读的来源
- `output/` — agent 写总结的目标目录（运行时自动创建）
