import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { retrieveRelevantChunks } from '@/lib/rag/retrieve';
import { runRagRetrieval } from '@/lib/rag/pipeline';
import { readTraceById } from '@/lib/rag/trace';
import type { SourceRoute } from '@/lib/rag/source-router';
import { getFallbackChain } from '@/lib/rag/fallback-chain';
import { documentTypes, type DocumentType } from '@/lib/types/document';

const requestSchema = z.object({
  query: z.string().min(1, '检索词不能为空'),
  topK: z.number().int().min(1).max(50).optional(),
  docTypes: z.array(z.enum(documentTypes)).optional(),
  themes: z.array(z.string()).optional(),
  stocks: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  /** 是否启用意图识别（默认开启，使用动态权重和源路由） */
  useIntent: z.boolean().optional().default(true),
  // ===== 回放参数（可选，来自 trace） =====
  intent: z.string().optional(),
  weights: z.object({
    vector: z.number(),
    keyword: z.number(),
    metadata: z.number(),
    freshness: z.number(),
  }).optional(),
  expandedQueries: z.array(z.string()).optional(),
  rewrittenQuery: z.string().optional(),
  sourceBoosts: z.record(z.string(), z.number()).optional(),
  fallbackDocTypes: z.array(z.enum(documentTypes)).optional(),
  routeMethod: z.enum(['llm', 'regex', 'none']).optional(),
  intentScores: z.array(z.object({
    intent: z.string(),
    score: z.number(),
    matched: z.array(z.string()),
  })).optional(),
});

type SearchInput = z.infer<typeof requestSchema>;

async function readTraceMeta(traceId: string) {
  try {
    const trace = await readTraceById(traceId);
    return {
      filterStats: trace?.filterStats ?? null,
      rerankChanges: trace?.rerankChanges ?? null,
      retrievalPlan: trace?.retrievalPlan ?? null,
      expandedAddedCount: trace?.expandedAddedCount ?? 0,
      fallbackAddedCount: trace?.fallbackAddedCount ?? 0,
    };
  } catch {
    return {
      filterStats: null,
      rerankChanges: null,
      retrievalPlan: null,
      expandedAddedCount: 0,
      fallbackAddedCount: 0,
    };
  }
}

function buildReplayRoute(input: SearchInput): SourceRoute {
  const intent = input.intent ?? 'general';
  const fallbackChain = getFallbackChain(intent);
  const fallbackDocTypes = input.fallbackDocTypes
    ?? [...fallbackChain.fallback, ...fallbackChain.lastResort];
  const docTypeBoosts = input.sourceBoosts
    ? input.sourceBoosts as Partial<Record<DocumentType, number>>
    : { qa: 0.3 } as Partial<Record<DocumentType, number>>;

  return {
    intent,
    weights: input.weights ?? { vector: 0.6, keyword: 0.15, metadata: 0.1, freshness: 0.15 },
    rewrittenQuery: input.rewrittenQuery,
    expandedQueries: input.expandedQueries,
    docTypeBoosts,
    retrievalPlan: {
      targetDocTypes: input.docTypes ?? [],
      searchMode: 'hybrid',
      topK: input.topK ?? 10,
      contextTopK: input.topK ?? 8,
      maxChunksPerDoc: 2,
      filters: {
        stocks: input.stocks,
        themes: input.themes,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
      },
      answerMode: 'evidence_based_analysis',
      fallbackDocTypes,
    },
    entities: undefined,
    intentScores: input.intentScores,
    recencyFirst: false,
    expandRelated: false,
    method: input.routeMethod ?? 'none',
  };
}

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = requestSchema.parse(json);

    if (input.useIntent) {
      // 走统一意图识别管线；带 intent 时按 trace 参数回放。
      const route = input.intent ? buildReplayRoute(input) : undefined;
      const traceId = randomUUID();

      const rag = await runRagRetrieval(input.query, {
        route,
        topK: input.topK ?? 10,
        docTypes: input.docTypes,
        themes: input.themes,
        stocks: input.stocks,
        tags: input.tags,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        sourceBoosts: input.sourceBoosts as Partial<Record<DocumentType, number>> | undefined,
        weights: input.weights,
        fallbackDocTypes: input.fallbackDocTypes,
        mmrLambda: 0.7,
        traceId,
      });

      const traceMeta = await readTraceMeta(traceId);

      return NextResponse.json({
        ok: true,
        data: rag.hits,
        meta: {
          intent: rag.route.intent,
          rewrittenQuery: rag.route.rewrittenQuery,
          expandedQueries: rag.route.expandedQueries,
          entities: rag.route.entities,
          sourceBoosts: rag.route.docTypeBoosts,
          retrievalPlan: traceMeta.retrievalPlan,
          filterStats: traceMeta.filterStats,
          rerankChanges: traceMeta.rerankChanges,
          expandedAddedCount: traceMeta.expandedAddedCount,
          fallbackAddedCount: traceMeta.fallbackAddedCount,
        },
      });
    }

    // 原始检索（不走意图识别）
    const traceId = randomUUID();
    const result = await retrieveRelevantChunks({ ...input, traceId });
    const traceMeta = await readTraceMeta(traceId);
    return NextResponse.json({
      ok: true,
      data: result,
      meta: {
        filterStats: traceMeta.filterStats,
        rerankChanges: traceMeta.rerankChanges,
        retrievalPlan: traceMeta.retrievalPlan,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.flatten() },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
