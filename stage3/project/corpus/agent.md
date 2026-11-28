# Agent 与 ReAct 模式

Agent（智能体）和「简单调用一次 LLM」的本质区别在于：**循环 + 工具调用 + 自主决策**。

## 什么是 ReAct

ReAct 是「Reasoning + Acting」的缩写，是 agent 最经典的一种工作模式。它把一次任务的执行拆成反复的三步：

- **Reasoning（推理）**：模型思考当前状态，决定下一步做什么。
- **Acting（行动）**：调用工具执行决定（搜索、读文件、写文件……）。
- **Observing（观察）**：接收工具返回的结果，作为下一步推理的输入。

这个循环反复进行，直到模型认为任务完成，输出最终答案。

## 一个例子（研究任务）

```
任务：调研 RAG 并写总结

Thought: 我还不知道有哪些资料，先列目录看看。
Action: list_docs()
Observation: [transformer.md, rag.md, agent.md]

Thought: rag.md 显然最相关，读它。
Action: read_file(rag.md)
Observation: （RAG 的完整内容……）

Thought: 已经掌握足够信息，写总结。
Action: write_file(rag总结.md, "……")
Observation: 已写入 output/rag总结.md

Thought: 任务完成，报告结果。
最终答案：已生成总结……
```

## 为什么 ReAct 有效

1. **可拆解复杂任务**：一个大任务被拆成多步小决策。
2. **可观察**：每一步的推理和行动都透明，出了问题能定位。
3. **可纠错**：观察结果不符合预期时，模型可以调整下一步（换个关键词、换份资料）。

## 何时用 workflow，何时用 agent

这是 Anthropic《Building Effective Agents》的核心观点：**不要什么都用 agent**。
- 流程固定、步骤确定 → 用**工作流（workflow）**，成本低、可控。
- 步骤不固定、需要根据中间结果动态决策 → 用 **agent**。

多数真实系统是两者的混合：主干用 workflow，需要灵活决策的环节用 agent。
