import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { retrieveRelevantChunks } from '@/lib/rag/retrieve';
import { readTraceById } from '@/lib/rag/trace';
import { routeQuerySource } from '@/lib/rag/source-router';
import { documentTypes } from '@/lib/types/document';

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
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = requestSchema.parse(json);

    if (input.useIntent) {
      // 走完整意图识别管线
      const route = await routeQuerySource(input.query);
      const searchQuery = route.rewrittenQuery || input.query;
      const traceId = randomUUID();

      const result = await retrieveRelevantChunks({
        query: searchQuery,
        topK: input.topK ?? 10,
        docTypes: input.docTypes,
        themes: input.themes,
        stocks: input.stocks,
        tags: input.tags,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        sourceBoosts: Object.keys(route.docTypeBoosts).length > 0
          ? route.docTypeBoosts
          : undefined,
        weights: route.weights,
        mmrLambda: 0.7,
        traceId,
      });

      // 从 trace 中读取 filterStats 和 rerankChanges
      let filterStats = null;
      let rerankChanges = null;
      try {
        const trace = await readTraceById(traceId);
        if (trace) {
          filterStats = trace.filterStats ?? null;
          rerankChanges = trace.rerankChanges ?? null;
        }
      } catch {
        // trace 读取失败不影响搜索结果
      }

      return NextResponse.json({
        ok: true,
        data: result,
        meta: {
          intent: route.intent,
          rewrittenQuery: route.rewrittenQuery,
          expandedQueries: route.expandedQueries,
          entities: route.entities,
          filterStats,
          rerankChanges,
        },
      });
    }

    // 原始检索（不走意图识别）
    const traceId = randomUUID();
    const result = await retrieveRelevantChunks({ ...input, traceId });
    let filterStats = null;
    let rerankChanges = null;
    try {
      const trace = await readTraceById(traceId);
      if (trace) {
        filterStats = trace.filterStats ?? null;
        rerankChanges = trace.rerankChanges ?? null;
      }
    } catch {
      // trace 读取失败不影响搜索结果
    }
    return NextResponse.json({ ok: true, data: result, meta: { filterStats, rerankChanges } });
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
