/**
 * 重排序（Rerank）。
 *
 * 优先级：
 *   1. 本地 cross-encoder 模型（Xenova/bge-reranker-v2-m3，若存在）
 *   2. DeepSeek API（回退）
 *
 * 统一前置优化：LRU 缓存、去重、候选集裁剪。
 */

import { getDeepSeekConfig } from '@/lib/ai/model';
import type { RagSearchHit } from '@/lib/rag/types';

// ---- LRU Cache ----

const CACHE_MAX = 200;
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { result: RagSearchHit[]; ts: number }>();

function getCached(query: string, hitIds: string[]): RagSearchHit[] | null {
  const key = `${query}|${hitIds.join(',')}`;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function setCached(query: string, hitIds: string[], result: RagSearchHit[]) {
  const key = `${query}|${hitIds.join(',')}`;
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value!;
    cache.delete(first);
  }
  cache.set(key, { result, ts: Date.now() });
}

// ---- 去重：同一文档只保留得分最高的 chunk ----

function dedupByDocId(hits: RagSearchHit[]): RagSearchHit[] {
  const seen = new Map<string, RagSearchHit>();
  for (const h of hits) {
    const existing = seen.get(h.chunk.docId);
    if (!existing || h.finalScore > existing.finalScore) {
      seen.set(h.chunk.docId, h);
    }
  }
  return Array.from(seen.values());
}

// ---- 本地 cross-encoder（transformers.js） ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let localCE: any = null;
let localCELoaded = false;
let localCELoading: Promise<boolean> | null = null;

async function loadLocalCE(): Promise<boolean> {
  if (localCELoaded) return localCE !== null;
  if (localCELoading) return localCELoading;

  localCELoading = (async () => {
    try {
      const { pipeline } = await import('@huggingface/transformers');
      const modelPath = process.cwd() + '/models/onnx-community/bge-reranker-v2-m3-ONNX';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipe = await pipeline('text-classification', modelPath) as any;
      localCE = pipe;
      console.log('[rerank] 本地 cross-encoder 加载成功');
      return true;
    } catch (err) {
      console.warn('[rerank] 本地 cross-encoder 不可用，使用 DeepSeek API 回退:', err);
      localCE = null;
      return false;
    } finally {
      localCELoaded = true;
    }
  })();

  return localCELoading;
}

async function localRerank(
  query: string,
  candidates: RagSearchHit[],
  topK: number,
  hitIds: string[],
): Promise<RagSearchHit[]> {
  const t0 = Date.now();
  // Cross-encoder — 批量送入模型（比逐条快 3-5 倍）
  const pairs = candidates.map(h =>
    `${query} [SEP] ${h.chunk.title} ${h.chunk.content}`,
  );
  const results = await localCE!(pairs);
  // transformers.js 批量返回 { label, score }[] 或 [{ label, score }][]
  const scores: number[] = (Array.isArray(results) ? results : []).map(
    (r: unknown) => {
      if (Array.isArray(r)) return Number(r[0]?.score ?? 0);
      if (r && typeof r === 'object' && 'score' in (r as Record<string, unknown>))
        return Number((r as Record<string, unknown>).score);
      return 0;
    },
  );

  const scored = candidates
    .map((h, i) => ({ hit: h, score: scores[i] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  const result = scored.slice(0, topK).map(s => s.hit);
  console.log(`[rerank] 本地模型: ${candidates.length} 候选 → ${topK} 结果 (${Date.now() - t0}ms)`);
  setCached(query, hitIds, result);
  return result;
}

// ---- DeepSeek API 回退 ----

async function apiRerank(
  query: string,
  candidates: RagSearchHit[],
  topK: number,
  hitIds: string[],
): Promise<RagSearchHit[]> {
  const config = getDeepSeekConfig();
  const candidateText = candidates
    .map((h, i) => `[${i}] ${h.chunk.title}\n${h.chunk.content.slice(0, 200)}`)
    .join('\n\n');

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            '你是 A 股投研 RAG 重排序助手。根据问题判断每个候选段落的相关性。',
            '评分标准：',
            '- 10-8分: 内容直接回答问题，包含关键事实或数据',
            '- 7-5分: 内容部分相关，提供背景或辅助信息',
            '- 4-1分: 内容边缘相关，仅提及相同主题',
            '- 0分: 不相关',
            '只输出 JSON。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `问题: ${query}\n\n候选段落:\n${candidateText}\n\n为每个候选段落打分（0-10）并输出得分最高的 top ${topK} 的索引，按得分降序排列。输出 JSON: { "ranked": [得分最高的索引, ...], "scores": { "0": 8, "1": 3, ... } }。`,
        },
      ],
    }),
  });

  if (!res.ok) return candidates.slice(0, topK);

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return candidates.slice(0, topK);

  const parsed = JSON.parse(json);
  const ranked = parsed.ranked;
  if (!Array.isArray(ranked) || ranked.length === 0) return candidates.slice(0, topK);

  const result = ranked
    .map((idx: number) => candidates[idx])
    .filter(Boolean)
    .slice(0, topK);

  setCached(query, hitIds, result);
  return result;
}

// ---- 统一入口 ----

export async function rerankHits(
  query: string,
  hits: RagSearchHit[],
  options: { topK?: number; candidateLimit?: number } = {},
): Promise<RagSearchHit[]> {
  if (hits.length <= 1) return hits;

  // 1. 去重
  const deduped = dedupByDocId(hits);

  // 2. 裁剪候选集，默认保留 30 个用于高召回场景。
  const candidateLimit = options.candidateLimit ?? 30;
  const candidates = deduped.slice(0, candidateLimit);
  const topK = Math.min(options.topK ?? candidates.length, candidates.length);

  // 3. 缓存命中
  const hitIds = candidates.map(h => h.chunk.id);
  const cached = getCached(query, hitIds);
  if (cached) return cached;

  // 4. 优先本地模型
  try {
    const ready = await loadLocalCE();
    if (ready && localCE) {
      return await localRerank(query, candidates, topK, hitIds);
    }
  } catch (err) {
    console.error('[rerank] 本地模型执行失败，切换到 API:', err);
  }

  // 5. API 回退
  return apiRerank(query, candidates, topK, hitIds);
}
