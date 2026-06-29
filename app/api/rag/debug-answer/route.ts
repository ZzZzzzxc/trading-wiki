/**
 * 答案调试 API：生成带引用的回答，并分析哪些结论有证据支撑。
 *
 * 流程：
 * 1. 完整检索管线 → topK chunks
 * 2. DeepSeek 生成带引用的回答 [citation:N]
 * 3. 解析引用 → 映射到 chunk
 * 4. 检查无引用的声明
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runRagRetrieval } from '@/lib/rag/pipeline';
import { getDeepSeekConfig } from '@/lib/ai/model';

const requestSchema = z.object({
  query: z.string().min(1),
  topK: z.number().min(1).max(10).default(5),
});

export async function POST(request: Request) {
  try {
    const { query, topK } = requestSchema.parse(await request.json());

    // 1. 统一检索管线（复用 QA route plan）
    const rag = await runRagRetrieval(query, {
      topK,
      contextTopK: topK,
      mmrLambda: 0.7,
    });

    // 2. 组装 context + 生成答案
    const contextChunks = rag.contextHits.map((hit, i) => {
      const heading = hit.chunk.headingPath.join(' > ') || '正文';
      return {
        rank: i + 1,
        chunkId: hit.chunk.id,
        title: hit.chunk.title,
        heading,
        snippet: hit.chunk.content.slice(0, 300),
      };
    });

    const contextText = contextChunks
      .map((c) => `[citation:${c.rank}] ${c.title}\n${c.snippet}`)
      .join('\n\n');

    const config = getDeepSeekConfig();
    const answerRes = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content: [
              '你是 A 股投研助理。请基于参考资料回答问题。',
              '要求：',
              '- 每个关键结论必须在末尾标注 [citation:N] 引用资料编号',
              '- 如果资料不足，在相应位置注明「资料未提及」',
              '- 区分事实和推断，推断标注「(推断)」',
              '- 不编造未在资料中出现的信息',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `参考资料:\n${contextText}\n\n问题: ${query}`,
          },
        ],
      }),
    });

    if (!answerRes.ok) {
      throw new Error(`AI 请求失败: ${answerRes.status}`);
    }

    const answerData = (await answerRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const answerText: string = answerData?.choices?.[0]?.message?.content ?? '';

    // 3. 解析引用
    const citationPattern = /\[citation:(\d+)\]/g;
    const usedCitations = new Set<number>();
    let match;
    while ((match = citationPattern.exec(answerText)) !== null) {
      usedCitations.add(parseInt(match[1]));
    }

    const citations = contextChunks
      .filter((c) => usedCitations.has(c.rank))
      .map((c) => ({
        rank: c.rank,
        chunkId: c.chunkId,
        title: c.title,
        heading: c.heading,
      }));

    const unusedChunks = contextChunks.filter((c) => !usedCitations.has(c.rank));

    // 4. 检查可能的未支撑声明（引用了但未匹配到任何 chunk）
    const allClaims = answerText
      .split(/[。\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10 && !s.includes('[citation:'));

    const unsupportedClaims = allClaims.filter((claim: string) => {
      // 排除明显非结论的句子
      if (claim.startsWith('参考资料') || claim.startsWith('问题')) return false;
      if (claim.startsWith('##') || claim.startsWith('---')) return false;
      return true;
    });

    return NextResponse.json({
      ok: true,
      data: {
        query,
        rewrittenQuery: rag.searchQuery,
        intent: rag.route.intent,
        answer: answerText,
        contextChunks,
        citations,
        unusedChunks,
        unsupportedClaims: unsupportedClaims.slice(0, 10),
        stats: {
          totalChunks: contextChunks.length,
          citedChunks: citations.length,
          uncitedChunks: unusedChunks.length,
          estimatedUnsupported: unsupportedClaims.length,
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
