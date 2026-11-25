# 02 · 工具调用 / Function Calling

## 为什么工具调用是 agent 的「手」

LLM 只会「说」，不会「做」。它不能真的查天气、真的读文件、真的执行代码。
Function calling 的作用是：**让模型「说出」它想调用哪个函数、传什么参数，然后由你的代码去真正执行，再把结果喂回给模型。**

一句话：**模型负责决策（调用哪个工具、给什么参数），你的代码负责执行，结果回填后模型再继续推理。**

## 完整流程（务必背下来）

```
1. 你在请求里带上「工具定义」（每个工具的 名称/描述/参数 schema）
2. 模型根据用户问题，决定要不要调用工具
3. 若调用：返回 tool_call（工具名 + 参数 JSON 字符串），而不是最终文本
4. 你的代码解析参数、执行真正的函数、拿到结果
5. 把结果作为一条 tool 消息，连同 tool_call_id 一起追加进消息历史
6. 再把完整历史发回给模型，让它基于工具结果给出最终回答
```

对照 [src/chat.ts](../project/src/chat.ts) 的循环，就是这段逻辑的落地。

## JSON schema：工具参数的「接口契约」

工具定义里最关键是 `parameters`，它是 JSON Schema，告诉模型该传哪些参数、什么类型、哪些必填。

```ts
{
  type: 'function',
  function: {
    name: 'get_weather',
    description: '查询某个城市当前的天气情况',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名，如北京、上海' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'], description: '温度单位' },
      },
      required: ['city'],
    },
  },
}
```

三个关键点：

- **`name`**：模型通过这个名字「点名」调用哪个函数。要清晰、语义化。
- **`description`**：模型决定「什么时候用这个工具」的主要依据。**这是最容易被忽视、却最重要的一行**。写清楚这个工具是干嘛的、什么时候该用。
- **`parameters`**：约束模型传参。`required` 列出必填，`enum` 限定取值，`description` 帮模型理解每个字段含义。

### 为什么工具描述这么重要

模型看不见你的函数实现，它只能看到 `description` 和 `parameters`。描述写得含糊，模型就不知道该不该用、参数往哪填。**写工具描述 = 给模型写说明书**，这比函数本体还值得花心思。

## 参数传递与结果回填

模型返回的 `tool_call.function.arguments` 是一个 **JSON 字符串**（不是对象），要 `JSON.parse` 后使用：

```ts
const args = JSON.parse(tc.function.arguments || '{}');
const result = await executeTool(tc.function.name, args);
```

结果回填时，**必须带上 `tool_call_id`**，让模型知道「这条结果对应我刚才的哪次调用」：

```ts
messages.push({
  role: 'tool',
  tool_call_id: tc.id,   // 关键：配对用
  content: result,       // 结果用字符串回填
});
```

两个坑：

1. **结果要序列化成字符串**（`JSON.stringify` 或直接拼字符串），不要塞原始对象。
2. **回填内容要「对模型友好」**：结构化、带单位、可读。模型要靠这段文字继续推理，写乱了模型会懵。

## 本项目的工具实现

看 [src/tools.ts](../project/src/tools.ts)：

- `tools`：工具定义数组（模型看到的接口）
- `executeTool(name, args)`：根据名字分发到真正的实现（你的代码执行）
- `getWeather` / `calculate`：两个真实的函数实现

注意 `calculate` 用了一个**安全的自实现表达式求值器**（调度场算法），而不是 `eval()` —— 因为工具的实参来自模型，属于「不可信输入」，直接 `eval` 会带来代码注入风险。这个安全意识后面阶段 5 会专门讲。

## 练习

跑起来后，故意问一些模糊问题，观察模型的行为：
- 「今天热不热？」—— 模型能不能自动补全城市参数（或者问你要城市）？
- 「算一下 1/3」—— 观察返回的浮点数，体会「结果回填是字符串」这个细节。
