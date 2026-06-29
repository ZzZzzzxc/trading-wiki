import { describe, expect, it } from 'vitest';
import { embedText } from '@/lib/rag/embed';
import { rankRagChunks } from '@/lib/rag/retrieve';
import type { RagChunk, RagEmbedding } from '@/lib/rag/types';

describe('rank rag chunks', () => {
  it('ranks semantically closer chunks higher', async () => {
    const chunks: RagChunk[] = [
      {
        id: 'c1',
        docId: 'd1',
        docPath: 'data/stocks/changchuan.md',
        docType: 'stock_profile',
        title: '长川科技个股档案',
        headingPath: ['三、核心上涨逻辑'],
        content: '长川科技受益于半导体设备与先进封装景气度提升。',
        stocks: ['300604'],
        themes: ['半导体设备'],
        tags: ['个股档案'],
      },
      {
        id: 'c2',
        docId: 'd2',
        docPath: 'data/notes/bank.md',
        docType: 'note',
        title: '银行板块观察',
        headingPath: ['一、行业观点'],
        content: '银行板块关注分红和估值修复。',
        stocks: ['600000'],
        themes: ['银行'],
        tags: ['笔记'],
      },
    ];
    const embeddings: RagEmbedding[] = await Promise.all(
      chunks.map(async (chunk) => ({
        id: chunk.id,
        vector: await embedText(`${chunk.title} ${chunk.headingPath.join(' ')} ${chunk.content}`),
      })),
    );

    const results = await rankRagChunks(chunks, embeddings, {
      query: '长川科技上涨逻辑',
      topK: 2,
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.chunk.id).toBe('c1');
    expect(results[0]?.finalScore).toBeGreaterThan(results[1]?.finalScore ?? 0);
  });
});
