# 01 · ReAct 模式

## 一句话

ReAct = **Reasoning（推理）+ Acting（行动）+ Observing（观察）** 的循环，是 agent 最经典、最值得先手写一遍的执行骨架。

## 三步循环

```
循环（直到任务完成或步数耗尽）：
    Thought    —— 我现在知道什么？还缺什么？下一步做什么？
    Action     —— 调用哪个工具？传什么参数？
    Observation—— 工具返回了什么？
    （带着 Observation 回到 Thought，继续推理）
```

注意：这个「Thought」不一定有独立的消息类型。在本项目的实现里，模型的「推理」体现为它调工具前输出的文字（assistant 的 `content`），以及它每一步「要不要调工具」这个决定本身。真正严格的 ReAct（Yao et al. 2022 论文）会强制模型先输出一段「Thought: ...」文本再输出「Action: ...」，但现代 function calling 已经把「行动」结构化成了 `tool_calls`，所以工程上我们通常只显式记录 Thought 和 Observation，Action 就是 tool_call。

## 为什么这是理解 agent 的关键

1. **它是 agent 的最小骨架**。所有框架（LangGraph、Claude Agent SDK 等）内部做的都是这件事，只是加了并行、子 agent、检查点等增强。手写一遍，再去看框架就一目了然。
2. **它暴露了 agent 的三大难题**，而这三个难题正好对应本阶段的三个验收问题：
   - 循环可能失控 → 为什么限步数（笔记 02）
   - 观察结果要喂回去 → 回填方式（笔记 03）
   - 历史无限增长 → 上下文窗口（笔记 04）

## 对照代码

核心循环在 [src/agent.ts](../project/src/agent.ts) 的 `run()` 方法：

- `for (let step = 1; step <= MAX_STEPS; step++)` → 循环骨架
- `if (message.tool_calls...)` → Act + Observe
- 否则 `return answer` → 结束

跑起来后用 `/trace`，能直观看到每一步的 Thought / Action / Observation 是怎么串起来的。
