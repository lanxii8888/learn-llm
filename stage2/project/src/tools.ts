// 阶段2 的真实工具。和阶段1最大的不同：
// 1. 工具是「真」的 —— 真正读文件、写文件、搜索本地语料。
// 2. 工具返回给模型的结果是「观察」（Observation），带来源和内容摘要，
//    让模型能基于它继续推理（这正是 ReAct 里的 O）。
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// 路径统一来自配置中心（config.projectRoot），不在工具里重复推导项目根目录。
const CORPUS_DIR = path.join(config.projectRoot, 'corpus');
const OUTPUT_DIR = path.join(config.projectRoot, 'output');

// 工具定义（模型看到的接口）
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
      name: 'list_docs',
      description:
        '列出语料库中的所有文档文件名。当你需要了解有哪些资料可用时，先用这个工具。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_docs',
      description:
        '在语料库中搜索与关键词相关的文档内容，返回匹配到的片段及其所在文件。用于定位资料。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '要搜索的关键词，例如 RAG、transformer' },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取某个文件的完整内容。搜索到相关文件后，用这个工具阅读正文。',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: '文件名，例如 rag.md' },
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
        '把一段文本写入 output 目录下的指定文件（会覆盖）。当用户要求「写总结/生成报告」时使用。',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: '文件名，例如 rag总结.md' },
          content: { type: 'string', description: '要写入的完整内容（Markdown 文本）' },
        },
        required: ['filename', 'content'],
      },
    },
  },
];

// ---------- 真实实现 ----------

function listDocs(): string {
  if (!fs.existsSync(CORPUS_DIR)) return `语料库目录不存在：${CORPUS_DIR}`;
  const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.md'));
  if (files.length === 0) return '语料库为空。';
  return `语料库文档：\n` + files.map((f) => `- ${f}`).join('\n');
}

function searchDocs(keyword: string): string {
  if (!fs.existsSync(CORPUS_DIR)) return `语料库目录不存在：${CORPUS_DIR}`;
  const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.md'));
  const k = keyword.toLowerCase();
  const hits: string[] = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(k)) {
        // 命中行 + 上下文各一行
        const from = Math.max(0, i - 1);
        const to = Math.min(lines.length, i + 2);
        hits.push(`【${f} 第 ${i + 1} 行】\n${lines.slice(from, to).join('\n').trim()}`);
        if (hits.length >= 5) break; // 限制返回片段数，避免一次塞太多
      }
    }
  }
  if (hits.length === 0) return `没有找到与「${keyword}」相关的内容。`;
  return hits.join('\n\n');
}

function readFile(filename: string): string {
  // 安全：只允许读语料库和 output 目录，防止路径穿越读任意文件
  const base = path.basename(filename);
  const candidates = [path.join(CORPUS_DIR, base), path.join(OUTPUT_DIR, base)];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      // 太长则截断，保护上下文（引出阶段3的「上下文窗口」）
      if (content.length > 4000) {
        return content.slice(0, 4000) + `\n\n……（文件过长，已截断，共 ${content.length} 字符）`;
      }
      return content;
    }
  }
  return `未找到文件「${filename}」。可用文件见 list_docs。`;
}

function writeFile(filename: string, content: string): string {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const safeName = path.basename(filename);
  if (!safeName.endsWith('.md')) {
    return `只允许写入 .md 文件，收到：${filename}`;
  }
  const p = path.join(OUTPUT_DIR, safeName);
  fs.writeFileSync(p, content, 'utf8');
  return `已写入 ${path.join('output', safeName)}，共 ${content.length} 字符。`;
}

export function executeTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'list_docs':
      return listDocs();
    case 'search_docs':
      return searchDocs(String(args.keyword ?? ''));
    case 'read_file':
      return readFile(String(args.filename ?? ''));
    case 'write_file':
      return writeFile(String(args.filename ?? ''), String(args.content ?? ''));
    default:
      return `未知工具：${name}`;
  }
}
