# Transformer 简介

Transformer 是 2017 年 Google 提出的神经网络架构，论文《Attention Is All You Need》。

## 核心思想

Transformer 的核心是**自注意力机制（self-attention）**。它让序列中的每个 token 都能直接「看到」其他所有 token，并计算彼此之间的相关性权重。相比 RNN 的逐步串行处理，Transformer 可以并行处理整个序列。

## 关键组成

1. **自注意力**：计算每个位置对其他位置的关注度。
2. **多头注意力（multi-head attention）**：用多组参数并行做注意力，捕捉不同的关系模式。
3. **位置编码（positional encoding）**：注意力本身不感知顺序，需要额外注入位置信息。
4. **前馈网络（feed-forward）**：逐位置的非线性变换。
5. **残差连接 + LayerNorm**：稳定训练。

## 为什么重要

Transformer 是大语言模型（LLM）的底座。GPT 用它的 decoder，BERT 用它的 encoder。它带来的并行性和长程依赖建模能力，直接催生了后来的规模化（scaling）浪潮。

## 相关概念

- encoder-decoder 结构：用于翻译等序列到序列任务。
- token：文本被切分后的最小单元。
- attention 的复杂度是 O(n²)，序列越长计算越贵，这是长上下文的一个成本来源。
