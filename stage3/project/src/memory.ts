import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 阶段3核心 #3：长期记忆
//
// 短期记忆 = messages 数组，只在一次会话（进程）里有效，重启就没了。
// 长期记忆 = 落盘的事实库，跨会话保留，需要时检索出来塞回上下文。
//
// 本项目刻意用「关键词 + 二段切分」做检索，而不是向量数据库：
// 目的是让检索过程完全可解释、零额外依赖。真实项目会换成 embedding + 向量库（见笔记 03）。
// ============================================================

export type MemoryItem = {
  id: string;
  text: string;
  tags: string[];
  source: string;
  createdAt: string;
};

export class MemoryStore {
  private items: MemoryItem[] = [];

  constructor(
    private file: string,
    private maxItems = 200,
  ) {
    this.load();
  }

  size(): number {
    return this.items.length;
  }

  list(): MemoryItem[] {
    return [...this.items];
  }

  /**
   * 新增一条记忆。返回 null 表示「太短 / 已存在高度相似条目」。
   * 去重很重要：自动抽取和 Model 主动 remember 会重复写同一件事。
   */
  add(text: string, opts: { tags?: string[]; source?: string } = {}): MemoryItem | null {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length < 4) return null;

    const tokens = tokenize(clean);
    for (const item of this.items) {
      if (jaccard(tokens, tokenize(item.text)) >= 0.85) return null;
    }

    const item: MemoryItem = {
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      text: clean.slice(0, 300),
      tags: (opts.tags ?? []).map((t) => String(t).toLowerCase().trim()).filter(Boolean),
      source: opts.source ?? 'unknown',
      createdAt: new Date().toISOString(),
    };
    this.items.push(item);
    this.trim();
    this.save();
    return item;
  }

  /**
   * 检索：把 query 和每条记忆都切成「检索词」，算命中比例。
   * 中文用 2-gram（避免依赖分词器），英文用长度 ≥2 的单词。
   * 这不是语义检索，但足以演示「先检索、再注入」的流程。
   */
  search(query: string, k = 3): MemoryItem[] {
    const q = tokenize(query);
    if (q.size === 0) return [];

    const scored = this.items
      .map((item) => {
        const it = tokenize(`${item.text} ${item.tags.join(' ')}`);
        let hit = 0;
        for (const t of q) if (it.has(t)) hit++;
        return { item, score: hit / Math.sqrt(q.size) };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, k).map((s) => s.item);
  }

  clear(): void {
    this.items = [];
    this.save();
  }

  private trim(): void {
    if (this.items.length > this.maxItems) {
      this.items = this.items.slice(-this.maxItems);
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.file)) return;
      const parsed: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(parsed)) this.items = parsed.filter(isMemoryItem);
    } catch {
      // 文件损坏就当作空记忆，不阻塞 agent 启动
      this.items = [];
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.items, null, 2), 'utf8');
  }
}

// ---------- 检索与去重的底层工具 ----------

function tokenize(text: string): Set<string> {
  const set = new Set<string>();
  const lower = text.toLowerCase();
  for (const w of lower.match(/[a-z0-9_]{2,}/g) ?? []) set.add(w);

  const cjkRuns = lower.match(/[㐀-鿿]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) set.add(run);
    for (let i = 0; i < run.length - 1; i++) set.add(run.slice(i, i + 2));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function isMemoryItem(v: unknown): v is MemoryItem {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.text === 'string' &&
    Array.isArray(o.tags) &&
    typeof o.source === 'string' &&
    typeof o.createdAt === 'string'
  );
}
