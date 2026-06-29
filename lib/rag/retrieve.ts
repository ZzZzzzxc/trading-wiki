import { readFile } from 'node:fs/promises';
import { embedText, cosineSimilarity, tokenizeForEmbedding } from '@/lib/rag/embed';
import { rerankHits } from '@/lib/rag/rerank';
import { computeBm25Score, tokenize as bm25Tokenize } from '@/lib/rag/bm25';
import { readTraceById, writeTrace } from '@/lib/rag/trace';
import { RAG_FILES } from '@/lib/storage/paths';
import type { RagChunk, RagEmbedding, RagSearchHit, RetrieveOptions } from '@/lib/rag/types';

function computeFreshnessScore(chunk: RagChunk): number {
  if (!chunk.date) {
    return 0.7;
  }

  const now = new Date();
  const docDate = new Date(chunk.date);
  const ageDays = Math.floor((now.getTime() - docDate.getTime()) / (1000 * 60 * 60 * 24));

  if (ageDays < 30) return 1.0;
  if (ageDays < 90) return 0.9;
  if (ageDays < 180) return 0.7;
  return 0.5;
}

function clampScore(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizeDateScore(chunk: RagChunk, options: RetrieveOptions): boolean {
  if (!options.dateFrom && !options.dateTo) return true;
  if (!chunk.date) return false;
  if (options.dateFrom && chunk.date < options.dateFrom) return false;
  if (options.dateTo && chunk.date > options.dateTo) return false;
  return true;
}

function buildMetadataTokens(chunk: RagChunk): Set<string> {
  return new Set(
    tokenizeForEmbedding(
      [
        chunk.title,
        chunk.author,
        chunk.platform,
        ...(chunk.headingPath ?? []),
        ...(chunk.themes ?? []),
        ...(chunk.stocks ?? []),
        ...(chunk.tags ?? []),
      ]
        .filter(Boolean)
        .join(' '),
    ),
  );
}

function computeKeywordScore(queryTokens: string[], chunk: RagChunk): number {
  if (!queryTokens.length) return 0;

  // BM25 评分：标题 45% + 段落标题 20% + 正文 35%，加权求和
  const titleScore = computeBm25Score(queryTokens, bm25Tokenize(chunk.title), 50) * 0.45;
  const headingScore = computeBm25Score(queryTokens, bm25Tokenize(chunk.headingPath.join(' ')), 50) * 0.20;
  const contentScore = computeBm25Score(queryTokens, bm25Tokenize(chunk.content.slice(0, 1200)), 300) * 0.35;

  return clampScore(titleScore + headingScore + contentScore);
}

function computeMetadataScore(
  queryTokens: string[],
  chunk: RagChunk,
  options: RetrieveOptions,
): number {
  const metadataScores: number[] = [];

  if (options.docTypes?.length) {
    metadataScores.push(options.docTypes.includes(chunk.docType) ? 1 : 0);
  }
  if (options.themes?.length) {
    metadataScores.push(options.themes.some((theme) => chunk.themes?.some((ct) => ct.includes(theme) || theme.includes(ct))) ? 1 : 0);
  }
  if (options.stocks?.length) {
    metadataScores.push(options.stocks.some((stock) => chunk.stocks?.some((cs) => cs.includes(stock) || stock.includes(cs))) ? 1 : 0);
  }
  if (options.tags?.length) {
    metadataScores.push(options.tags.some((tag) => chunk.tags?.some((ct) => ct.includes(tag))) ? 1 : 0);
  }
  if (options.author) {
    metadataScores.push((chunk.author || '').toLowerCase().includes(options.author.toLowerCase()) ? 1 : 0);
  }
  if (options.stance) {
    metadataScores.push(chunk.stance === options.stance ? 1 : 0);
  }

  if (!metadataScores.length) {
    if (!queryTokens.length) return 0;
    const metadataTokens = buildMetadataTokens(chunk);
    const hits = queryTokens.reduce((count, token) => count + (metadataTokens.has(token) ? 1 : 0), 0);
    return clampScore(hits / queryTokens.length);
  }

  return clampScore(metadataScores.reduce((sum, score) => sum + score, 0) / metadataScores.length);
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  try {
    const source = await readFile(filePath, 'utf8');
    return source
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * MMR (Maximal Marginal Relevance) dedup.
 * Balances relevance and diversity among top candidates.
 */
function applyMMR(
  candidates: RagSearchHit[],
  embeddingMap: Map<string, number[]>,
  lambda: number,
  topK: number,
): RagSearchHit[] {
  if (candidates.length <= topK) return candidates;

  const selected: RagSearchHit[] = [candidates[0]];
  const remaining = candidates.slice(1);

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].finalScore;
      const vec = embeddingMap.get(remaining[i].chunk.id);
      let maxSim = 0;

      if (vec) {
        for (const sel of selected) {
          const selVec = embeddingMap.get(sel.chunk.id);
          if (selVec) {
            maxSim = Math.max(maxSim, (cosineSimilarity(vec, selVec) + 1) / 2);
          }
        }
      }

      const mmr = lambda * relevance - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

function toTraceCandidates(hits: RagSearchHit[], options: RetrieveOptions) {
  return hits.map((h) => ({
    chunkId: h.chunk.id,
    docId: h.chunk.docId,
    title: h.chunk.title,
    docType: h.chunk.docType,
    headingPath: h.chunk.headingPath,
    finalScore: h.finalScore,
    vectorScore: h.vectorScore,
    keywordScore: h.keywordScore,
    metadataScore: h.metadataScore,
    freshnessScore: h.freshnessScore,
    sourceBoost: options.sourceBoosts?.[h.chunk.docType] ?? 1.0,
    selected: true,
  }));
}

export async function rankRagChunks(
  chunks: RagChunk[],
  embeddings: RagEmbedding[],
  options: RetrieveOptions,
): Promise<RagSearchHit[]> {
  const query = options.query.trim();
  if (!query) return [];

  const tStart = performance.now();
  const queryTokens = tokenizeForEmbedding(query);
  const queryVector = await embedText(query, 'query');
  const embeddingMap = new Map(embeddings.map((item) => [item.id, item.vector]));
  const tEmbed = performance.now();

  // Use dynamic weights if provided, else defaults
  const w = options.weights ?? { vector: 0.6, keyword: 0.15, metadata: 0.1, freshness: 0.15 };
  const totalWeight = w.vector + w.keyword + w.metadata + w.freshness;

  // Sequential filtering: each step filters the remaining pool from the previous step.
  // filterStats values represent the count *after* each filter stage, not independent hits.
  let remaining = chunks;

  let afterDocTypes = remaining.length;
  if (options.docTypes?.length) {
    remaining = remaining.filter((c) => options.docTypes!.includes(c.docType));
    afterDocTypes = remaining.length;
  }

  let afterStocks = remaining.length;
  if (options.stocks?.length) {
    remaining = remaining.filter((c) => options.stocks!.some((stock) => c.stocks?.some((cs) => cs.includes(stock) || stock.includes(cs))));
    afterStocks = remaining.length;
  }

  let afterThemes = remaining.length;
  if (options.themes?.length) {
    remaining = remaining.filter((c) => options.themes!.some((theme) => c.themes?.some((ct) => ct.includes(theme) || theme.includes(ct))));
    afterThemes = remaining.length;
  }

  let afterTags = remaining.length;
  if (options.tags?.length) {
    remaining = remaining.filter((c) => options.tags!.some((tag) => c.tags?.some((ct) => ct.includes(tag))));
    afterTags = remaining.length;
  }

  let afterDateRange = remaining.length;
  if (options.dateFrom || options.dateTo) {
    remaining = remaining.filter((c) => normalizeDateScore(c, options));
    afterDateRange = remaining.length;
  }

  let afterAuthor = remaining.length;
  if (options.author) {
    const authorKw = options.author.toLowerCase();
    remaining = remaining.filter((c) => (c.author || '').toLowerCase().includes(authorKw));
    afterAuthor = remaining.length;
  }

  let afterStance = remaining.length;
  if (options.stance) {
    remaining = remaining.filter((c) => c.stance === options.stance);
    afterStance = remaining.length;
  }

  const filtered = remaining;
  const tFilter = performance.now();

  const scored = filtered
    .map((chunk) => {
      const chunkVector = embeddingMap.get(chunk.id) ?? [];
      const vectorScore = clampScore((cosineSimilarity(queryVector, chunkVector) + 1) / 2);
      const keywordScore = computeKeywordScore(queryTokens, chunk);
      const metadataScore = computeMetadataScore(queryTokens, chunk, options);
      const freshnessScore = computeFreshnessScore(chunk);

      const sourceBoost = options.sourceBoosts?.[chunk.docType] ?? 1.0;

      const finalScore =
        ((vectorScore * w.vector + keywordScore * w.keyword + metadataScore * w.metadata + freshnessScore * w.freshness) / totalWeight)
        * sourceBoost;

      return { chunk, vectorScore, keywordScore, metadataScore, freshnessScore, finalScore };
    })
    .filter((item) => item.finalScore > 0)
    .sort((left, right) => right.finalScore - left.finalScore);
  const tScore = performance.now();

  // Rerank + diversify pipeline
  const topK = options.topK ?? 8;
  let result: RagSearchHit[];
  const enableRerank = options.enableRerank !== false;
  let rerankUsed = false;
  // MMR λ 动态配置：按意图调整多样性
  const MMR_LAMBDA_BY_INTENT: Record<string, number> = {
    chain:       0.5,  // 产业链：侧重多样性，展示不同环节
    stock_deep:  0.8,  // 个股深挖：侧重精确性，减少噪音
    verification: 0.6, // 验证：平衡
    recency:     0.6,  // 时效：平衡
    market_review: 0.7, // 复盘：默认
    general:     0.7,  // 通用：默认
  };
  const enableMmr = options.enableMmr !== false;
  const mmrLambda = options.mmrLambda ?? MMR_LAMBDA_BY_INTENT[options.intent ?? ''] ?? 0.7;
  let mmrUsed = false;
  const rerankChanges: Array<{ chunkId: string; title: string; beforeRank: number; afterRank: number; score: number }> = [];
  let tRerankStart = 0, tRerankEnd = 0, tMmrStart = 0, tMmrEnd = 0, tEnd = 0;

  if (scored.length > topK) {
    const candidateLimit = options.rerankCandidateLimit ?? 30;
    const candidates = scored.slice(0, candidateLimit);
    const beforeRerank = candidates.map((c, i) => ({ id: c.chunk.id, title: c.chunk.title, rank: i + 1 }));

    let reranked = candidates;
    if (enableRerank && candidates.length > 1) {
      const rerankTopK = Math.min(
        options.rerankTopK ?? candidates.length,
        candidates.length,
      );
      tRerankStart = performance.now();
      reranked = await rerankHits(query, candidates, {
        topK: rerankTopK,
        candidateLimit,
      });
      tRerankEnd = performance.now();
      rerankUsed = true;

      for (let i = 0; i < Math.min(reranked.length, 10); i++) {
        const before = beforeRerank.find((b) => b.id === reranked[i].chunk.id);
        if (before && before.rank !== i + 1) {
          rerankChanges.push({ chunkId: reranked[i].chunk.id, title: reranked[i].chunk.title, beforeRank: before.rank, afterRank: i + 1, score: reranked[i].finalScore });
        }
      }
    }

    // 2. MMR diversity (if enabled)
    if (enableMmr && mmrLambda < 1 && reranked.length > topK) {
      tMmrStart = performance.now();
      result = applyMMR(reranked, embeddingMap, mmrLambda!, topK);
      tMmrEnd = performance.now();
      mmrUsed = true;
    } else {
      result = reranked.slice(0, topK);
    }
    tEnd = performance.now();
  } else {
    result = scored;
    tEnd = performance.now();
  }

  // Write retrieval trace
  if (options.traceId) {
    await writeTrace({
      id: options.traceId,
      timestamp: new Date().toISOString(),
      query: options.originalQuery ?? options.query,
      rewrittenQuery: options.rewrittenQuery,
      intent: options.intent,
      routeMethod: options.routeMethod,
      intentScores: options.intentScores,
      weights: w,
      sourceBoosts: options.sourceBoosts as Record<string, number> | undefined,
      expandedQueries: options.expandedQueries,
      fallbackDocTypes: options.fallbackDocTypes,
      retrievalPlan: {
        targetDocTypes: options.traceTargetDocTypes ?? options.docTypes,
        filters: {
          stocks: options.stocks,
          themes: options.themes,
          tags: options.tags,
          dateFrom: options.dateFrom,
          dateTo: options.dateTo,
        },
        topK,
        contextTopK: options.traceContextTopK,
        maxChunksPerDoc: options.traceMaxChunksPerDoc,
        fallbackDocTypes: options.fallbackDocTypes,
      },
      totalCandidates: scored.length,
      latencyMs: {
        filter: Math.round(tFilter - tEmbed),
        vectorScore: Math.round(tScore - tFilter),
        keywordScore: 0,
        rerank: tRerankEnd > 0 ? Math.round(tRerankEnd - tRerankStart) : undefined,
        mmr: tMmrEnd > 0 ? Math.round(tMmrEnd - tMmrStart) : undefined,
        total: Math.round(tEnd - tStart),
      },
      filterStats: {
        total: chunks.length,
        afterDocTypes,
        afterStocks,
        afterThemes,
        afterTags,
        afterDateRange,
        afterAllFilters: filtered.length,
        afterScoreFilter: scored.length,
      },
      rerankChanges: rerankChanges.length > 0 ? rerankChanges : undefined,
      topK: toTraceCandidates(result, options),
      rerankUsed,
      mmrUsed,
      mmrLambda,
      phase: 'main',
    });
  }

  return result;
}

export async function retrieveRelevantChunks(
  options: RetrieveOptions,
): Promise<RagSearchHit[]> {
  const [chunks, embeddings] = await Promise.all([
    readJsonLines<RagChunk>(RAG_FILES.chunks),
    readJsonLines<RagEmbedding>(RAG_FILES.embeddings),
  ]);

  const topK = options.topK ?? 8;

  // 主查询
  const mainHits = await rankRagChunks(chunks, embeddings, options);
  if (mainHits.length === 0) {
  }

  // 构建结果池：主查询 + Multi-Query 扩展合并
  let resultPool: RagSearchHit[];
  let expandedAddedCount = 0;
  let fallbackAddedCount = 0;

  const expanded = options.expandedQueries ?? [];
  if (expanded.length > 0) {
    const expandedHits = await Promise.all(
      expanded.map((eq) =>
        rankRagChunks(chunks, embeddings, { ...options, query: eq, traceId: undefined }),
      ),
    );

    // 合并去重：每个 chunk 取最大分
    const merged = new Map<string, RagSearchHit>();
    for (const hit of mainHits) {
      merged.set(hit.chunk.id, hit);
    }
    for (const hits of expandedHits) {
      for (const hit of hits) {
        const existing = merged.get(hit.chunk.id);
        if (!existing || hit.finalScore > existing.finalScore) {
          if (!existing) expandedAddedCount++;
          merged.set(hit.chunk.id, hit);
        }
      }
    }
    resultPool = Array.from(merged.values())
      .sort((a, b) => b.finalScore - a.finalScore);
  } else {
    resultPool = mainHits;
  }

  // 降级链：当结果不足 topK 且有降级文档类型配置时，执行降级检索
  if (resultPool.length < topK && options.fallbackDocTypes?.length) {
    const currentIds = new Set(resultPool.map(h => h.chunk.id));

    const fallbackOptions: RetrieveOptions = {
      ...options,
      docTypes: options.fallbackDocTypes,
      // 降级检索不使用 Multi-Query 扩展，避免重复
      expandedQueries: undefined,
      // 不使用 trace（避免覆盖主查询的 trace）
      traceId: undefined,
    };
    const fallbackHits = await rankRagChunks(chunks, embeddings, fallbackOptions);

    for (const hit of fallbackHits) {
      if (!currentIds.has(hit.chunk.id)) {
        resultPool.push(hit);
        currentIds.add(hit.chunk.id);
        fallbackAddedCount++;
        if (resultPool.length >= topK) break;
      }
    }
  }

  const finalHits = resultPool.slice(0, topK);

  if (options.traceId) {
    const baseTrace = await readTraceById(options.traceId);
    if (baseTrace) {
      await writeTrace({
        ...baseTrace,
        phase: 'final',
        totalCandidates: resultPool.length,
        topK: toTraceCandidates(finalHits, options),
        expandedAddedCount,
        fallbackAddedCount,
      });
    }
  }

  return finalHits;
}
