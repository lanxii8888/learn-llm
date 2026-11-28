import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { config } from './config.js';

// ============================================================
// 阶段3核心 #4：结构化输出
//
// 目标：让模型输出「程序能稳定消费」的 JSON，而不是一段自由文本。
//
// 三层保险：
//   1) 提示词里给出 JSON Schema，明确要求只输出 JSON；
//   2) 从返回文本里提取 JSON（容忍 ```json 代码块、前后废话）；
//   3) 用 schema 做校验，不合格就把错误喂回模型，让它重试一次。
//
// 注意：OpenAI 有 response_format: { type: 'json_schema' } 这种「服务端强制」的能力，
// 但很多中转站不支持。这里用「提示词 + 校验 + 重试」的可移植做法；生产环境两者可结合。
// ============================================================

export type JsonSchemaProp = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  enum?: string[];
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
};

export type JsonSchema = JsonSchemaProp & { type: 'object' };

export type AskJsonOptions = {
  system: string;
  user: string;
  schema: JsonSchema;
  model?: string;
  /** 最多尝试几次（含首次） */
  attempts?: number;
  maxTokens?: number;
};

export async function askJson<T>(client: OpenAI, opts: AskJsonOptions): Promise<T> {
  const attempts = opts.attempts ?? 2;
  const schemaText = JSON.stringify(opts.schema, null, 2);
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `${opts.system}\n\n输出要求：只输出一个符合下面 JSON Schema 的 JSON 对象。不要输出任何解释，不要用 Markdown 代码块。\n\nJSON Schema:\n${schemaText}`,
    },
    { role: 'user', content: opts.user },
  ];

  let lastError = '';
  for (let i = 1; i <= attempts; i++) {
    const resp = await client.chat.completions.create({
      model: opts.model ?? config.model,
      messages,
      temperature: 0,
      max_tokens: opts.maxTokens ?? 600,
    });

    const raw = resp.choices[0].message.content ?? '';
    try {
      const parsed = extractJson(raw);
      const err = validateJson(parsed, opts.schema);
      if (!err) return parsed as T;
      lastError = err;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }

    // 把失败的输出和错误回填，让模型自我修正
    messages.push({ role: 'assistant', content: raw });
    messages.push({
      role: 'user',
      content: `上次输出不合格：${lastError}。请只重新输出修正后的 JSON。`,
    });
  }

  throw new Error(`结构化输出失败（尝试 ${attempts} 次）：${lastError}`);
}

/** 从自由文本里抠出 JSON：去掉代码块围栏，截取第一个 { 到最后一个 } */
export function extractJson(raw: string): unknown {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) text = fence[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);

  return JSON.parse(text);
}

/** 极简 JSON Schema 校验。返回 null 表示通过，否则返回人类可读的错误。 */
export function validateJson(value: unknown, schema: JsonSchemaProp, at = '$'): string | null {
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return `${at} 应为对象，实际是 ${typeName(value)}`;
      }
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in obj)) return `${at} 缺少必填字段 "${key}"`;
      }
      for (const [key, val] of Object.entries(obj)) {
        const prop = schema.properties?.[key];
        if (!prop) return `${at} 出现 Schema 未定义的字段 "${key}"`;
        const err = validateJson(val, prop, `${at}.${key}`);
        if (err) return err;
      }
      return null;
    }
    case 'array': {
      if (!Array.isArray(value)) return `${at} 应为数组，实际是 ${typeName(value)}`;
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const err = validateJson(value[i], schema.items, `${at}[${i}]`);
          if (err) return err;
        }
      }
      return null;
    }
    case 'string': {
      if (typeof value !== 'string') return `${at} 应为字符串，实际是 ${typeName(value)}`;
      if (schema.enum && !schema.enum.includes(value)) {
        return `${at} 应属于 ${schema.enum.map((v) => `"${v}"`).join(' / ')}`;
      }
      return null;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${at} 应为数字`;
      return null;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return `${at} 应为整数`;
      return null;
    }
    case 'boolean': {
      return typeof value === 'boolean' ? null : `${at} 应为布尔值`;
    }
    default:
      return `${at} 的 Schema 类型非法`;
  }
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
