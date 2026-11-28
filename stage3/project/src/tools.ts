import fs from 'node:fs';
import path from 'node:path';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from './config.js';
import type { MemoryStore } from './memory.js';

// ============================================================
// 阶段3核心 #2：工具设计
//
// 和阶段2相比，这里刻意做了几件「工具设计」上的升级：
//   1. 描述里写清楚「什么时候用 / 什么时候别用」，而不只是「这个工具是干嘛的」。
//   2. read_file 支持分块读（start_line / max_lines）——控制单次输出大小，
//      因为工具输出会直接进上下文，塞太多等于自杀。
//   3. 错误分「可恢复 / 不可恢复」：可恢复错误让模型自己改参数重试，
//      不可恢复的（未知工具、越权路径）明确告诉它别再试。
//   4. 副作用工具（write_file / remember）参数做严格校验，避免模型乱写。
// ============================================================

// 路径统一来自配置中心（config.projectRoot），不在工具里重复推导项目根目录。
const CORPUS_DIR = path.join(config.projectRoot, 'corpus');
const OUTPUT_DIR = path.join(config.projectRoot, 'output');

const MAX_READ_CHARS = 6000;
const MAX_WRITE_CHARS = 20000;

export type Toolset = {
  tools: ChatCompletionTool[];
  executeTool: (name: string, args: Record<string, unknown>) => string;
};

export function createToolset(memory: MemoryStore | null): Toolset {
  const tools: ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'list_docs',
        description:
          '列出语料库中所有可用的 Markdown 文档文件名。任务开始时如果不确定有哪些资料，先调用它。不要用它来读内容。',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_docs',
        description:
          '按关键词在语料库中全文搜索，返回命中的片段、文件名和行号。适合「定位」资料；找到文件后请用 read_file 读正文。关键词要短而具体（如 RAG、注意力），不要整句搜索。',
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: '搜索关键词，例如 RAG、transformer、幻觉' },
            max_results: {
              type: 'integer',
              description: '最多返回几个片段，1-10，默认 5。结果太多会浪费上下文。',
            },
          },
          required: ['keyword'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description:
          '读取语料库或 output 目录中某个文件的正文。默认一次最多读 200 行；文件较大时用 start_line / max_lines 分块读，避免一次把上下文塞满。',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: '文件名，例如 rag.md' },
            start_line: { type: 'integer', description: '从第几行开始读（从 1 开始），默认 1' },
            max_lines: { type: 'integer', description: '最多读多少行，1-400，默认 200' },
          },
          required: ['filename'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description:
          '把 Markdown 文本写入 output 目录（同名文件会被覆盖）。只在用户明确要求「写总结 / 生成报告 / 保存到文件」时调用。内容必须是完整的最终稿，不要写占位符。',
        parameters: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: '文件名，必须以 .md 结尾，例如 rag总结.md' },
            content: { type: 'string', description: '要写入的完整 Markdown 内容' },
          },
          required: ['filename', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'remember',
        description:
          '把一条值得长期记住的事实写入长期记忆（跨会话保留）。只在这些情况调用：用户明确说「记住」、或信息在以后的会话里仍然有用（用户偏好、项目背景、确认过的结论）。不要记录一次性的任务细节。',
        parameters: {
          type: 'object',
          properties: {
            fact: {
              type: 'string',
              description: '一句完整、脱离当前上下文也能看懂的话，例如「用户正在学习 agent 开发，目前进行到阶段3」',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: '可选标签，例如 ["偏好", "项目"]',
            },
          },
          required: ['fact'],
        },
      },
    },
  ];

  function executeTool(name: string, args: Record<string, unknown>): string {
    try {
      switch (name) {
        case 'list_docs':
          return listDocs();
        case 'search_docs':
          return searchDocs(String(args.keyword ?? ''), args.max_results);
        case 'read_file':
          return readFile(String(args.filename ?? ''), args.start_line, args.max_lines);
        case 'write_file':
          return writeFile(String(args.filename ?? ''), String(args.content ?? ''));
        case 'remember':
          return remember(memory, args.fact, args.tags);
        default:
          return `错误（不可恢复）：未知工具「${name}」。可用工具：list_docs / search_docs / read_file / write_file / remember。`;
      }
    } catch (err) {
      return `错误（不可恢复）：工具 ${name} 执行异常：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return { tools, executeTool };
}

// ---------- 真实实现 ----------

function listDocs(): string {
  if (!fs.existsSync(CORPUS_DIR)) return `错误（不可恢复）：语料库目录不存在：${CORPUS_DIR}`;
  const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.md'));
  if (files.length === 0) return '语料库为空。';
  return `语料库文档（${files.length} 个）：\n` + files.map((f) => `- ${f}`).join('\n');
}

function searchDocs(keyword: string, maxResults: unknown): string {
  const kw = keyword.trim();
  if (kw.length < 1) {
    return '错误（可恢复）：keyword 不能为空。请换一个短而具体的关键词重试。';
  }
  if (!fs.existsSync(CORPUS_DIR)) return `错误（不可恢复）：语料库目录不存在：${CORPUS_DIR}`;

  const limit = clampInt(maxResults, 5, 1, 10);
  const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.md'));
  const k = kw.toLowerCase();
  const hits: string[] = [];

  outer: for (const f of files) {
    const lines = fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(k)) continue;
      const from = Math.max(0, i - 1);
      const to = Math.min(lines.length, i + 2);
      hits.push(`【${f} 第 ${i + 1} 行】\n${lines.slice(from, to).join('\n').trim()}`);
      if (hits.length >= limit) break outer;
    }
  }

  if (hits.length === 0) {
    return `没有找到与「${kw}」相关的内容。可以换一个更短的关键词，或先用 list_docs 看有哪些文档。`;
  }
  return hits.join('\n\n');
}

function readFile(filename: string, startLine: unknown, maxLines: unknown): string {
  const base = path.basename(filename);
  const candidates = [path.join(CORPUS_DIR, base), path.join(OUTPUT_DIR, base)];
  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) {
    return `错误（可恢复）：未找到文件「${filename}」。先用 list_docs 查看可用文件。`;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const total = lines.length;
  const start = clampInt(startLine, 1, 1, total);
  const max = clampInt(maxLines, 200, 1, 400);
  const end = Math.min(total, start + max - 1);

  const body = lines.slice(start - 1, end).join('\n');
  const clipped =
    body.length > MAX_READ_CHARS ? body.slice(0, MAX_READ_CHARS) + '\n……（单次输出过长已截断）' : body;
  const more = end < total ? `\n（还有 ${total - end} 行未读，可用 start_line=${end + 1} 继续）` : '';

  return `【${base}：第 ${start}-${end} 行 / 共 ${total} 行】\n${clipped}${more}`;
}

function writeFile(filename: string, content: string): string {
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.md')) {
    return `错误（可恢复）：只允许写入 .md 文件，收到「${filename}」。请换成 xxx.md。`;
  }
  if (content.trim().length < 10) {
    return '错误（可恢复）：content 太短。请写入完整的总结正文。';
  }
  if (content.length > MAX_WRITE_CHARS) {
    return `错误（可恢复）：content 超过 ${MAX_WRITE_CHARS} 字符上限，请精简后重试。`;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, safeName), content, 'utf8');
  return `已写入 output/${safeName}，共 ${content.length} 字符。`;
}

function remember(memory: MemoryStore | null, fact: unknown, tags: unknown): string {
  if (!memory) return '错误（不可恢复）：长期记忆未启用，无法保存。';
  const text = String(fact ?? '').trim();
  if (text.length < 4) {
    return '错误（可恢复）：fact 太短。请写成一句完整、脱离上下文也能看懂的话。';
  }
  if (text.length > 300) {
    return '错误（可恢复）：fact 超过 300 字符。请只保留最核心的一句。';
  }

  const tagList = Array.isArray(tags) ? tags.map(String) : [];
  const item = memory.add(text, { tags: tagList, source: 'agent 主动记录' });
  if (!item) return '已存在相同或高度相似的记忆，未重复保存。';
  return `已记住（id=${item.id}）：${item.text}`;
}

function clampInt(value: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}
