# 阶段 1：打好 LLM 基础

> Agent 是建在 LLM 之上的，地基不牢后面全白搭。
> 目标：理解提示词、工具调用、消息结构、模型与成本，并手写一个「带工具的聊天机器人」。

## 学什么（4 个主题）

按顺序读 [notes/](./notes/) 下的四篇笔记：

| 顺序 | 主题 | 笔记文件 | 对应的代码 |
|------|------|----------|-----------|
| 1 | 提示词工程 | [01-提示词工程.md](notes/01-提示词工程.md) | `src/chat.ts` 里的 SYSTEM_PROMPT |
| 2 | 工具调用 / Function Calling | [02-工具调用-Function-Calling.md](notes/02-工具调用-Function-Calling.md) | `src/tools.ts` |
| 3 | 对话/消息结构 | [03-对话消息结构.md](notes/03-对话消息结构.md) | `src/chat.ts` |
| 4 | 模型选择与成本 | [04-模型选择与成本.md](notes/04-模型选择与成本.md) | `src/config.ts` |

## 动手做什么

一个「能查天气、能算数学」的聊天机器人，**不用框架**（不引入 LangChain），直接用 OpenAI SDK + 手写循环。

它会演示阶段 1 的所有知识点：
- system / user / assistant / tool 四种消息如何组织
- 工具如何用 JSON schema 定义、模型如何返回 tool_call、结果如何回填
- 一个完整的多步对话循环

## 怎么跑起来

> 本项目是 monorepo，依赖统一装在**根目录**，`.env` 也放在**根目录**（`learn-llm/` 下）。

```bash
# 在根目录（learn-llm/）执行，装一次即可
npm install

# 复制 .env 模板到根目录，然后编辑填入中转站信息
cp stage1/project/.env.example .env

# 启动 stage1（两种方式任选）
npm run start:stage1          # 方式一：根目录启动
# 或
cd stage1/project && npm start  # 方式二：进入子项目启动
```

`.env`（放在根目录 `learn-llm/.env`）三个字段：

```
API_BASE_URL=https://你的中转站地址/v1
API_KEY=sk-你的key
MODEL=模型名，例如 gpt-4o-mini
```

> **关于中转站格式**：本项目按 **OpenAI 兼容格式**（`/v1/chat/completions`）编写，这是绝大多数中转站的标准。如果你的中转站是 **Anthropic 格式**（`/v1/messages`），告诉我，我把 SDK 换成 `@anthropic-ai/sdk`，逻辑不变，只改调用层。

运行后可以这样测：

```
你 > 北京今天多少度？
你 > 帮我算一下 (3 + 5) * 2 的平方
你 > 上海天气如何？顺便算算 100 除以 7 是多少
你 > /dump    （查看当前消息历史，理解 message 结构）
你 > exit     （退出）
```

## 怎么验证自己掌握了

能用自己的话回答出这几点，阶段 1 就过关：

1. system / user / assistant / tool 四种消息各是什么语义？tool 消息为什么必须带 `tool_call_id`？
2. 工具的 JSON schema 里 `type` / `properties` / `required` 各起什么作用？工具描述写得好坏为什么直接决定模型用得好坏？
3. 一次「查天气」的完整请求里，模型返回了什么、我们做了什么、又发回给模型了什么？
4. 为什么工具结果要用字符串回填、而不是塞回一个对象？
5. token 是怎么计费的？输入和输出 token 哪个更贵？prompt caching 为什么能省钱？

---

> 说明：本会话的 Bash 工具被禁用（Auto 模式安全检查无法运行），所以我没法替你执行 `npm install` / 运行 / 联网。上面的命令需要你本地自己跑。如果跑起来遇到报错，把报错贴给我即可。
