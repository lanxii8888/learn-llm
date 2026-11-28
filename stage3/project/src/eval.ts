import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { config, checkConfig } from './config.js';
import { ContextAgent } from './agent.js';

// ============================================================
// 阶段3核心 #6：评估（Evaluation）
//
// 「感觉能用」和「确实能用」之间隔着评估。
// 这里的评估刻意保持简单、可解释：
//   - 每个用例 = 一个任务 + 一组「可自动判定的检查」；
//   - 检查只看最终答案 / 产出文件 / 是否触发压缩，不评判语气和文采；
//   - 每个用例用全新的 agent（不共享对话历史与记忆），保证互不污染。
//
// 它不能替代人工评估，但能防止「改了一个 prompt，旧能力悄悄坏了」这种回归。
// ============================================================

const OUTPUT_DIR = path.join(config.projectRoot, 'output');

type CaseContext = {
  answer: string;
  steps: number;
  compacted: boolean;
  readOutput: (filename: string) => string | null;
};

type Check = {
  label: string;
  fn: (ctx: CaseContext) => boolean;
};

type EvalCase = {
  name: string;
  task: string;
  budgetTokens?: number;
  checks: Check[];
};

// ---------- 检查器 ----------

function containsAny(...terms: string[]): Check {
  return {
    label: `答案包含「${terms.join(' / ')}」之一`,
    fn: (c) => terms.some((t) => c.answer.toLowerCase().includes(t.toLowerCase())),
  };
}

function containsAll(...terms: string[]): Check {
  return {
    label: `答案同时包含 ${terms.map((t) => `「${t}」`).join('、')}`,
    fn: (c) => terms.every((t) => c.answer.toLowerCase().includes(t.toLowerCase())),
  };
}

function fileWritten(filename: string, minChars = 30): Check {
  return {
    label: `产出 output/${filename}（≥${minChars} 字符）`,
    fn: (c) => {
      const text = c.readOutput(filename);
      return !!text && text.trim().length >= minChars;
    },
  };
}

const compacted: Check = {
  label: '触发了上下文保护（压缩或截断）',
  fn: (c) => c.compacted,
};

// ---------- 用例集 ----------

const CASES: EvalCase[] = [
  {
    name: '列文档',
    task: '语料库里有哪些 Markdown 文档？只列出文件名。',
    checks: [containsAll('rag.md', 'transformer.md', 'agent.md')],
  },
  {
    name: '检索 RAG',
    task: 'RAG 想解决 LLM 的哪两个核心问题？各用一句话说明。',
    // 文档里的措辞是「知识过时」和「容易编造（幻觉）」，允许同义表达
    checks: [containsAny('过时', '截止'), containsAny('幻觉', '编造')],
  },
  {
    name: '读取与归纳',
    task: '阅读 transformer.md，用两句话解释它的核心机制。',
    checks: [containsAny('自注意力', 'self-attention', '注意力')],
  },
  {
    name: '写总结文件',
    task: '阅读 rag.md 后，用三句话总结「RAG 和 agent 的关系」，写入 output/eval-rag-agent.md。',
    checks: [fileWritten('eval-rag-agent.md')],
  },
  {
    name: '上下文保护',
    task: '依次读 rag.md、transformer.md、agent.md，然后分别用一句话概括这三篇讲什么。',
    // 故意把预算调得很小，让压缩/截断必然发生。
    // 这一项只检查「保护是否触发」，答案正确率不作为计分项（压缩本身就有信息损失）。
    budgetTokens: 1200,
    checks: [compacted],
  },
];

// ---------- 执行 ----------

export type EvalSummary = {
  checksTotal: number;
  checksPassed: number;
  casesTotal: number;
  casesPassed: number;
};

export async function runEval(client: OpenAI, opts: { verbose?: boolean } = {}): Promise<EvalSummary> {
  console.log('\n===== 阶段3 评估 =====');
  console.log(`模型: ${config.model}    用例数: ${CASES.length}\n`);

  let checksTotal = 0;
  let checksPassed = 0;
  let casesPassed = 0;
  const rows: string[] = [];

  for (const item of CASES) {
    cleanEvalOutputs();

    const agent = new ContextAgent(client, null, {
      budgetTokens: item.budgetTokens ?? config.contextBudgetTokens,
      maxSteps: 10,
    });

    const started = Date.now();
    let result;
    try {
      result = await agent.run(item.task, { useMemory: false, extractMemory: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\n[${item.name}] 运行失败：${msg}`);
      checksTotal += item.checks.length;
      rows.push(`${pad(item.name, 14)} │ 0/${item.checks.length} │  ERROR`);
      continue;
    }

    const ctx: CaseContext = {
      answer: result.answer,
      steps: result.steps,
      compacted: result.compacted,
      readOutput: (filename) => {
        const p = path.join(OUTPUT_DIR, path.basename(filename));
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
      },
    };

    const results = item.checks.map((check) => ({ label: check.label, ok: check.fn(ctx) }));
    const passed = results.filter((r) => r.ok).length;
    checksTotal += results.length;
    checksPassed += passed;
    if (passed === results.length) casesPassed += 1;

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    rows.push(
      `${pad(item.name, 14)} │ ${passed}/${results.length} │ ${pad(`${result.steps} 步`, 4)} │ ${secs}s${
        passed === results.length ? '' : '  ⚠'
      }`,
    );

    if (opts.verbose) {
      if (result.answer) {
        console.log(`\n[${item.name}] 答案：${result.answer.replace(/\s+/g, ' ').slice(0, 160)}${result.answer.length > 160 ? '…' : ''}`);
      }
      for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}`);
      if (result.contextNotes.length > 0) console.log(`  [上下文] ${result.contextNotes.join('；')}`);
    }
  }

  console.log('\n用例             │ 通过 │ 步数 │ 耗时');
  console.log('─────────────────┼──────┼──────┼──────');
  for (const row of rows) console.log(row);

  const rate = checksTotal === 0 ? 0 : Math.round((checksPassed / checksTotal) * 100);
  console.log(`\n总计：${checksPassed}/${checksTotal} 项检查通过（${rate}%），${casesPassed}/${CASES.length} 个用例全过。\n`);

  return {
    checksTotal,
    checksPassed,
    casesTotal: CASES.length,
    casesPassed,
  };
}

function cleanEvalOutputs(): void {
  if (!fs.existsSync(OUTPUT_DIR)) return;
  for (const f of fs.readdirSync(OUTPUT_DIR)) {
    if (f.startsWith('eval-')) fs.rmSync(path.join(OUTPUT_DIR, f), { force: true });
  }
}

/** 按显示宽度粗略右补空格（中文算 2 宽） */
function pad(text: string, width: number): string {
  let w = 0;
  for (const ch of text) w += /[㐀-鿿]/.test(ch) ? 2 : 1;
  return text + ' '.repeat(Math.max(0, width - w));
}

// 允许 `pnpm eval` / `tsx src/eval.ts` 直接运行
const entry = process.argv[1];
const invokedDirectly = !!entry && path.resolve(entry) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  checkConfig();
  const client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey });
  runEval(client, { verbose: true }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
