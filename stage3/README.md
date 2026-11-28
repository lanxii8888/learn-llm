# 阶段 3 动手项目：把 Agent 从「能跑」做到「能用」

> 阶段 2 的 agent 能完成多步任务，但它一跑长任务就会撞上下文窗口，一重启就忘光，输出难以校验，过程看不见，好坏也说不清。
> 阶段 3 就是来补这几件事的——按路线图，这是**现在 agent 开发真正的难点和核心竞争力**。

这个项目在阶段 2 的 ReAct 骨架上，叠加了五个工程模块（外加一个贯穿性的「工具设计」主题）：

| # | 主题 | 代码 | 一句话 |
|---|------|------|--------|
| 1 | 上下文工程 | [src/context.ts](project/src/context.ts) | 历史会无限变长，必须主动压缩 |
| 2 | 工具设计 | [src/tools.ts](project/src/tools.ts) | 工具描述是写给模型看的 API 文档 |
| 3 | 记忆系统 | [src/memory.ts](project/src/memory.ts) | 短期记忆在 messages，长期记忆要落盘 |
| 4 | 结构化输出 | [src/structured.ts](project/src/structured.ts) | 让模型输出程序能稳定消费的 JSON |
| 5 | 流式输出 | [src/agent.ts](project/src/agent.ts) 的 `callStreaming` | 边生成边展示，改善交互体验 |
| 6 | 评估 | [src/eval.ts](project/src/eval.ts) | 没有评估，改 prompt 就是盲改 |

## 这个 agent 能干什么

它还是那个「研究助理」，但多了这些能力：

- **跨会话记忆**：你说过「记住：我在做 agent 开发学习项目」，下次启动它还知道。
- **上下文自我保护**：跑长任务、读大文件时自动压缩历史，不会一步撞满窗口。
- **流式回答**：文字边生成边显示，不用干等一整段。
- **结构化抽取**：每次回答后，用一次「只输出 JSON」的调用把长期有用的事实存进记忆。
- **可评估**：内置 5 个用例，一条命令跑完，给出通过率。

跑起来后可以试：

```
你 > 语料库里有哪些文档？
你 > 帮我调研「RAG」，读相关文档，写一份总结到 output/rag总结.md
你 > 记住：我在做 agent 开发学习项目，目前进行到阶段3
你 > /memory          查看长期记忆
你 > /context         查看当前上下文用量
你 > /trace           查看最近一次执行过程（含压缩记录）
你 > /eval            跑一遍内置评估
你 > exit
```

## 和阶段 2 的对比

| | 阶段 2 | 阶段 3 |
|---|---|---|
| 上下文 | 字符数超预算就粗暴截断工具结果 | 按 user 轮次摘要 + 截断 + 丢旧轮的分级策略，并报告压缩前后的量 |
| 记忆 | 只有 messages（进程内） | messages + 落盘的长期记忆（检索注入、自动抽取、去重、容量上限） |
| 输出 | 一次性返回整段 | 默认流式，逐字显示 |
| 结构化 | 无 | JSON Schema 约束 + 校验 + 失败重试 |
| 工具 | 4 个基础工具 | 分块读取、结果数量上限、可恢复/不可恢复错误、`remember` 副作用工具 |
| 评估 | 无 | 可运行的用例集与通过率报告 |
| 成本意识 | 有步数上限 | 步数上限 + 上下文预算 + 额外的记忆抽取调用（可关） |

## 怎么跑起来

> monorepo：依赖统一装在根目录，`.env` 在根目录。前面阶段装过依赖就不用再装。

```bash
# 根目录（learn-llm/）执行一次
pnpm install

# 启动
pnpm start:stage3
# 或
cd stage3/project && pnpm start

# 单独跑评估
pnpm eval:stage3
```

可选环境变量（写在根目录 `.env`）：

```bash
CONTEXT_BUDGET_TOKENS=8000   # 上下文预算（估算 token），调小能更快看到压缩
MAX_STEPS=12                 # ReAct 最大步数
MEMORY_EXTRACT=off           # 关闭「回答后自动抽取记忆」，省一次调用
STREAM=off                   # 关闭流式输出（中转站不支持 SSE 时用）
```

## 目录结构

```
stage3/
├── README.md                  ← 你在这里
├── notes/                     ← 6 篇笔记，对应 6 个主题
└── project/
    ├── corpus/                ← 本地语料（rag / transformer / agent）
    ├── data/                  ← 长期记忆 memory.json（运行时生成，已 gitignore）
    ├── output/                ← agent 写文件的目标目录（运行时生成）
    └── src/
        ├── config.ts          ← 转发到根目录 config/index.ts（唯一读 .env 的地方）+ 本阶段路径
        ├── tokens.ts          ← token 估算启发式
        ├── context.ts         ← 核心①：上下文预算与三级压缩
        ├── tools.ts           ← 核心②：工具定义与实现（含错误分级）
        ├── memory.ts          ← 核心③：长期记忆存储与检索
        ├── structured.ts      ← 核心④：JSON Schema 输出与校验重试
        ├── agent.ts           ← ReAct 循环 + 上面四件事的串联 + 流式
        ├── eval.ts            ← 核心⑥：评估用例与报告
        └── index.ts           ← 命令行入口
```

## 六个主题，六篇笔记

1. **上下文工程** → [notes/01-上下文工程.md](notes/01-上下文工程.md)
   - 为什么每步重发历史、压缩策略怎么选、切点为什么必须在 user 边界、有损性怎么权衡。
2. **工具设计** → [notes/02-工具设计.md](notes/02-工具设计.md)
   - 粒度、描述、参数约束、错误分级、输出大小、安全边界。
3. **记忆系统** → [notes/03-记忆系统.md](notes/03-记忆系统.md)
   - 短期 vs 长期、写入/检索/注入/维护的完整生命周期、关键词检索与向量检索的取舍。
4. **结构化输出** → [notes/04-结构化输出.md](notes/04-结构化输出.md)
   - Prompt / JSON mode / json_schema / function calling 四种手段、校验与修复重试。
5. **流式输出** → [notes/05-流式输出.md](notes/05-流式输出.md)
   - SSE 与 delta 拼接、流式下 tool_calls 的坑、与计量和 UX 的关系。
6. **评估** → [notes/06-评估.md](notes/06-评估.md)
   - 用例集设计、确定性检查 vs LLM judge、回归与成本、本项目评估器的局限。

## 验收标准（路线图阶段 3）

能回答清楚下面这些问题，并且能指出代码里对应的位置，就算过关：

- [ ] 上下文为什么会满？本项目的三级压缩分别是什么，代价是什么？
- [ ] 为什么摘要的切点必须落在 user 消息上，不能随便切？
- [ ] 长期记忆的完整生命周期是什么？检索为什么先做关键词而不是直接上向量库？
- [ ] 结构化输出的四层保险分别防的是什么？校验失败后怎么自愈？
- [ ] 流式输出里 tool_calls 为什么要按 index 累积？它会改变 agent 的逻辑吗？
- [ ] 为什么说「没有评估 = 盲改」？本项目的评估有什么局限，生产环境还要补什么？

## 推荐阅读顺序

先跑起来随便问几个问题，感受 `/context`、`/trace`、`/memory` 三个命令 →
读 [notes/01](notes/01-上下文工程.md)，对照 [context.ts](project/src/context.ts) →
读 [notes/03](notes/03-记忆系统.md)，对照 [memory.ts](project/src/memory.ts) →
读 [notes/04](notes/04-结构化输出.md) 与 [notes/05](notes/05-流式输出.md) →
最后读 [notes/06](notes/06-评估.md) 并跑 `pnpm eval:stage3`。

## 练习（改代码才算真懂）

1. **把预算调到很小**（`CONTEXT_BUDGET_TOKENS=800`），问一个需要读三份文档的问题，观察 `/trace` 里的压缩记录和答案质量的变化。
2. **关掉摘要**（构造 `ContextManager({ enableSummary: false })`），对比「摘要」和「截断」两种策略的信息损失。
3. **加一个工具**（比如 `word_count(filename)`），重点不是实现，而是写清楚「何时用/何时不用」的描述，观察模型是否会正确选择。
4. **给记忆抽取换一个 schema**（比如加上 `category` 枚举字段），看失败重试是否生效。
5. **加一个评估用例**，然后故意把 system prompt 改坏，确认评估能抓住回归。
