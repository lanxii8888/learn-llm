// 工具定义：模型「看到」的接口，用 JSON schema 描述。
// 注意 description 写得好坏，直接决定模型用得好坏。
export type ToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询某个城市当前的天气情况。当用户问到天气、温度、是否下雨下雪时使用。',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名，例如 北京、上海、东京' },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: '温度单位，默认 celsius（摄氏度）',
          },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: '计算一个数学表达式的值。当用户问数学计算、四则运算、求值时使用。',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '只含数字、+ - * / ( ) 和空格的数学表达式，例如 "(3 + 5) * 2"',
          },
        },
        required: ['expression'],
      },
    },
  },
];

// ---------- 真实实现（你的代码真正执行的部分） ----------

// 模拟的天气数据。真实项目里这里会调用天气 API。
function getWeather(city: string, unit: string): string {
  // 用城市名的 hash 造一个「看起来稳定」的假数据，方便练习时结果可复现
  let h = 0;
  for (const ch of city) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tempC = (h % 30) - 5; // -5 ~ 24 摄氏度
  const conditions = ['晴', '多云', '小雨', '阴'][h % 4];
  const temp = unit === 'fahrenheit' ? Math.round(tempC * 9 / 5 + 32) : tempC;
  const unitLabel = unit === 'fahrenheit' ? '华氏度' : '摄氏度';
  return `${city} 当前天气：${conditions}，气温 ${temp} ${unitLabel}`;
}

// 安全的自实现表达式求值器（调度场算法），只支持 + - * / ( ) 和数字。
// 不用 eval()，因为表达式来自模型（不可信输入），eval 有代码注入风险。
function calculate(expression: string): string {
  const tokens = expression.replace(/\s+/g, '').split(/([+\-*/()])/).filter(Boolean);
  const output: string[] = []; // 逆波兰表达式
  const ops: string[] = [];    // 运算符栈
  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

  for (const tok of tokens) {
    if (/^\d+(\.\d+)?$/.test(tok)) {
      output.push(tok);
    } else if ('+-*/'.includes(tok)) {
      while (
        ops.length > 0 &&
        ops[ops.length - 1] !== '(' &&
        precedence[ops[ops.length - 1]] >= precedence[tok]
      ) {
        output.push(ops.pop()!);
      }
      ops.push(tok);
    } else if (tok === '(') {
      ops.push(tok);
    } else if (tok === ')') {
      while (ops.length > 0 && ops[ops.length - 1] !== '(') output.push(ops.pop()!);
      if (ops[ops.length - 1] === '(') ops.pop();
    } else {
      return `无法计算：表达式含不支持的字符 "${tok}"，仅支持数字和 + - * / ( )`;
    }
  }
  while (ops.length > 0) output.push(ops.pop()!);

  const stack: number[] = [];
  for (const tok of output) {
    if (/^\d+(\.\d+)?$/.test(tok)) {
      stack.push(parseFloat(tok));
    } else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) return '无法计算：表达式不完整';
      switch (tok) {
        case '+': stack.push(a + b); break;
        case '-': stack.push(a - b); break;
        case '*': stack.push(a * b); break;
        case '/':
          if (b === 0) return '无法计算：除数不能为 0';
          stack.push(a / b);
          break;
      }
    }
  }
  const result = stack[0];
  if (stack.length !== 1 || !Number.isFinite(result)) return '无法计算：表达式有误';
  return `${expression} = ${result}`;
}

// 根据工具名分发。模型调用工具后，由这里真正执行并返回「给模型看的结果字符串」。
export function executeTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'get_weather':
      return getWeather(String(args.city ?? ''), String(args.unit ?? 'celsius'));
    case 'calculate':
      return calculate(String(args.expression ?? ''));
    default:
      return `未知工具：${name}`;
  }
}
