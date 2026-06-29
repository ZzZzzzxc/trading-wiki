import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runRagRetrieval } from '@/lib/rag/pipeline';

const requestSchema = z.object({
  query: z.string().min(1),
  topK: z.number().min(1).max(20).default(8),
});

export async function POST(request: Request) {
  try {
    const { query, topK } = requestSchema.parse(await request.json());

    // 走统一检索管线（同 QA 系统，包含 route plan 过滤和上下文组装）
    const rag = await runRagRetrieval(query, {
      topK,
      contextTopK: topK,
      mmrLambda: 0.7,
    });

    // 统计信息
    const totalChars = rag.contextText.length;
    const estimatedTokens = Math.round(totalChars * 0.4); // 中文估算

    return NextResponse.json({
      ok: true,
      data: {
        query,
        rewrittenQuery: rag.searchQuery,
        intent: rag.route.intent,
        totalCandidates: rag.hits.length,
        contextChunks: rag.contextChunks,
        contextText: rag.contextText,
        stats: {
          totalChars,
          estimatedTokens,
          chunkCount: rag.contextChunks.length,
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
