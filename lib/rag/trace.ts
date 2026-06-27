/**
 * RAG 检索链路 Trace。
 *
 * 每次问答记录完整的检索链路，用于调试和评价。
 * 存储：data/rag-traces.jsonl
 */
import { mkdir, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '@/lib/storage/paths';

const TRACES_DIR = path.join(DATA_DIR, 'rag-traces');
const TRACES_FILE = path.join(TRACES_DIR, 'traces.jsonl');

// ---- Types ----

export interface TraceCandidate {
  chunkId: string;
  docId: string;
  title: string;
  docType: string;
  headingPath: string[];
  finalScore: number;
  vectorScore: number;
  keywordScore: number;
  metadataScore: number;
  freshnessScore: number;
  sourceBoost: number;
  selected: boolean;      // 是否在最终 topK 中
  rerankPosition?: number; // rerank 后的排位（仅前 30 有）
}

export interface RetrievalTrace {
  id: string;
  timestamp: string;
  /** 原始用户问题 */
  query: string;
  /** 改写后的检索查询 */
  rewrittenQuery?: string;
  /** 源路由意图 */
  intent?: string;
  /** 源路由匹配方式 */
  routeMethod?: 'llm' | 'regex' | 'none';
  /** 源路由各意图评分明细 */
  intentScores?: Array<{ intent: string; score: number; matched: string[] }>;
  /** 使用的评分权重 */
  weights?: { vector: number; keyword: number; metadata: number; freshness: number };
  /** 源 boost */
  sourceBoosts?: Record<string, number>;
  /** 是否使用了 rerank */
  rerankUsed?: boolean;
  /** 是否使用了 MMR */
  mmrUsed?: boolean;
  /** 总候选数 */
  totalCandidates: number;
  /** topK 候选详情 */
  topK: TraceCandidate[];
  /** 每步耗时 ms */
  latencyMs?: {
    filter: number;
    vectorScore: number;
    keywordScore: number;
    rerank?: number;
    mmr?: number;
    total: number;
  };
  /** 各过滤层去除的 chunk 数 */
  filterStats?: {
    total: number;
    afterDocTypes: number;
    afterStocks: number;
    afterThemes: number;
    afterDateRange: number;
    afterTags: number;
    /** 通过所有元数据过滤（docType+stock+theme+tag+date）的 chunk 数 */
    afterAllFilters: number;
    afterScoreFilter: number;
  };
  /** rerank 前后排序变化（仅当 rerank 实际执行且改变排序时记录） */
  rerankChanges?: Array<{
    chunkId: string;
    title: string;
    beforeRank: number;
    afterRank: number;
    score: number;
  }>;
}

// ---- Write ----

export async function writeTrace(entry: RetrievalTrace): Promise<void> {
  try {
    await mkdir(TRACES_DIR, { recursive: true });
    await appendFile(TRACES_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error('[rag/trace] 写入检索 trace 失败:', err);
  }
}

// ---- Read ----

export async function readTraces(limit = 50): Promise<RetrievalTrace[]> {
  try {
    const source = await readFile(TRACES_FILE, 'utf8');
    const seen = new Set<string>();
    return source
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RetrievalTrace)
      .reverse()
      .filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      })
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function readTraceById(id: string): Promise<RetrievalTrace | null> {
  const traces = await readTraces(500);
  return traces.find((t) => t.id === id) ?? null;
}
