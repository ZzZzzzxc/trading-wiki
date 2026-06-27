import { describe, expect, it } from 'vitest';
import { computeBm25Score, tokenize as bm25Tokenize } from '@/lib/rag/bm25';
import type { RagChunk } from '@/lib/rag/types';

/**
 * 模拟 computeKeywordScore（retrieve.ts 内部函数）的关键词评分逻辑：
 *   title × 0.45 + heading × 0.20 + content × 0.35
 */
function keywordScore(queryTokens: string[], chunk: RagChunk): number {
  if (!queryTokens.length) return 0;
  const titleScore = computeBm25Score(queryTokens, bm25Tokenize(chunk.title), 50) * 0.45;
  const headingScore = computeBm25Score(queryTokens, bm25Tokenize(chunk.headingPath.join(' ')), 50) * 0.20;
  const contentScore = computeBm25Score(queryTokens, bm25Tokenize(chunk.content.slice(0, 1200)), 300) * 0.35;
  return Math.min(titleScore + headingScore + contentScore, 1);
}

const baseChunk: RagChunk = {
  id: 'test-chunk',
  docId: 'test-doc',
  docPath: 'data/test.md',
  docType: 'note',
  title: '',
  headingPath: [],
  content: '',
  stocks: [],
  themes: [],
  tags: [],
};

describe('BM25 keyword scoring integration', () => {
  it('title containing query token yields higher score than title without', () => {
    const query = bm25Tokenize('长川科技');

    const chunkWithTitle: RagChunk = {
      ...baseChunk,
      title: '长川科技深度分析',
      headingPath: [],
      content: '半导体设备行业景气度提升。',
    };

    const chunkWithoutTitle: RagChunk = {
      ...baseChunk,
      title: '半导体行业观察',
      headingPath: [],
      content: '长川科技受益于半导体设备需求增长。',
    };

    const scoreWith = keywordScore(query, chunkWithTitle);
    const scoreWithout = keywordScore(query, chunkWithoutTitle);

    // Title match gives a bonus, so score should be higher
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it('heading containing query token contributes to score', () => {
    const query = bm25Tokenize('上涨逻辑');

    const chunkWithHeading: RagChunk = {
      ...baseChunk,
      title: '长川科技档案',
      headingPath: ['三、核心上涨逻辑'],
      content: '受益于先进封装需求增长。',
    };

    const chunkWithoutHeading: RagChunk = {
      ...baseChunk,
      title: '长川科技档案',
      headingPath: ['一、公司概况'],
      content: '受益于先进封装需求增长。',
    };

    const scoreWith = keywordScore(query, chunkWithHeading);
    const scoreWithout = keywordScore(query, chunkWithoutHeading);

    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it('higher token overlap in content yields higher score', () => {
    const query = bm25Tokenize('半导体设备先进封装');

    const chunkHighOverlap: RagChunk = {
      ...baseChunk,
      title: '行业研究',
      headingPath: [],
      content: '半导体设备与先进封装是当前投资热点。半导体设备国产化加速，先进封装需求旺盛。',
    };

    const chunkLowOverlap: RagChunk = {
      ...baseChunk,
      title: '行业研究',
      headingPath: [],
      content: '市场整体呈现震荡格局，关注低估值板块。',
    };

    const scoreHigh = keywordScore(query, chunkHighOverlap);
    const scoreLow = keywordScore(query, chunkLowOverlap);

    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });

  it('returns 0 for completely unrelated query and chunk', () => {
    const query = bm25Tokenize('银行保险股息');
    const chunk: RagChunk = {
      ...baseChunk,
      title: '半导体设备',
      headingPath: ['技术路线'],
      content: '光刻机、刻蚀设备是核心。',
    };

    const score = keywordScore(query, chunk);
    expect(score).toBe(0);
  });
});
