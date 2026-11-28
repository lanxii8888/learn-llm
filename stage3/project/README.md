# stage3 子项目

这是阶段 3 的代码实现。**完整的学习说明、六个主题、验收标准见上一级：[../README.md](../README.md)**。

## 快速开始

```bash
# 在 monorepo 根目录（learn-llm/）
pnpm install
pnpm start:stage3

# 只跑评估
pnpm eval:stage3
```

## 代码结构

- `src/config.ts` — 转发到根目录 `config/index.ts`（唯一读 `.env` 的地方）
- `src/agent.ts` — ReAct 循环串联上下文工程、记忆、流式（先读这个，再顺着看其他文件）
- `src/context.ts` — 上下文预算与三级压缩（摘要 / 截断 / 丢旧轮）
- `src/memory.ts` — 长期记忆：落盘、去重、关键词检索
- `src/structured.ts` — JSON Schema 约束 + 校验 + 修复重试
- `src/tools.ts` — 工具定义与实现（错误分级、分块读取、输出上限）
- `src/eval.ts` — 评估用例与报告
- `src/index.ts` — 命令行入口（`/trace` `/context` `/memory` `/eval`）
- `corpus/` — 本地语料
- `data/` — 长期记忆（运行时生成，已 gitignore）
- `output/` — agent 写文件的目标目录（运行时生成）
