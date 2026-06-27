import { describe, expect, it } from 'vitest';
import { tokenize, computeBm25Score, estimateAvgDocLength } from '@/lib/rag/bm25';

describe('tokenize', () => {
  it('returns array for pure Chinese sentence', () => {
    const result = tokenize('今日大盘震荡上行');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // Should include bigrams (each adjacent pair)
    expect(result).toContain('今日');
    expect(result).toContain('日大');
    expect(result).toContain('大盘');
    expect(result).toContain('盘震');
    expect(result).toContain('震荡');
    expect(result).toContain('上行');
  });

  it('tokenizes Chinese-English mix: English lowercased, Chinese segmented', () => {
    const result = tokenize('AI算力需求增长 GPU紧缺');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // English segments should be lowercased
    expect(result).toContain('ai');
    expect(result).toContain('gpu');
    // Chinese should have unigrams and bigrams
    const chineseTokens = result.filter((t) => /[一-鿿]/.test(t));
    expect(chineseTokens.length).toBeGreaterThan(0);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(tokenize('   ')).toEqual([]);
  });

  it('preserves investment term "光纤光缆" as a complete dictionary word', () => {
    const result = tokenize('光纤光缆');
    // Dictionary matching should keep it as a complete term
    expect(result).toContain('光纤光缆');
    // Bigrams are also added (光纤, 纤光, 光缆) but the full word must be there
    expect(result.filter((t) => t === '光纤光缆').length).toBeGreaterThanOrEqual(1);
  });

  it('tokenizes "半导体设备" with dictionary match of "半导体"', () => {
    const result = tokenize('半导体设备');
    expect(result).toContain('半导体');
    // "设备" is 2 chars and the bigram loop also produces it
    const bigramIndex = result.indexOf('设备');
    expect(bigramIndex).toBeGreaterThanOrEqual(0);
  });

  it('splits mixed alphanumeric identifiers correctly', () => {
    const result = tokenize('300604长川科技');
    expect(result).toContain('300604');
  });
});

describe('computeBm25Score', () => {
  it('returns 0 for empty query', () => {
    const score = computeBm25Score([], ['a', 'b'], 50);
    expect(score).toBe(0);
  });

  it('returns 0 for empty document', () => {
    const score = computeBm25Score(['a', 'b'], [], 50);
    expect(score).toBe(0);
  });

  it('returns > 0 when query fully matches document', () => {
    const query = ['长川', '科技', '上涨', '逻辑'];
    const doc = ['长川', '科技', '上涨', '逻辑'];
    const score = computeBm25Score(query, doc, 50);
    expect(score).toBeGreaterThan(0.5);
  });

  it('returns 0 when query does not match document at all', () => {
    const query = ['xyz', 'abc'];
    const doc = ['长川', '科技'];
    const score = computeBm25Score(query, doc, 50);
    expect(score).toBe(0);
  });

  it('returns higher score when more query tokens match', () => {
    // Build a long query so avg doesn't saturate at 1.0
    const longQuery = [
      'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
      'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
      'u', 'v', 'w', 'x', 'y', 'z',
    ];
    const docTwoMatch = ['a', 'b'];
    const docOneMatch = ['a'];
    // Use tokens NOT present in the query to get score 0
    const docNoMatch = ['zzz', 'yyy'];

    const scoreTwo = computeBm25Score(longQuery, docTwoMatch, 5);
    const scoreOne = computeBm25Score(longQuery, docOneMatch, 5);
    const scoreZero = computeBm25Score(longQuery, docNoMatch, 5);

    expect(scoreTwo).toBeGreaterThan(scoreOne);
    expect(scoreOne).toBeGreaterThan(scoreZero);
    expect(scoreZero).toBe(0);
  });

  it('respects custom BM25 k1 and b parameters', () => {
    // Use many query tokens but only 1 doc match to avoid score saturation
    const query = ['test', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const doc = ['test'];
    const scoreDefault = computeBm25Score(query, doc, 100);
    const scoreHighK1 = computeBm25Score(query, doc, 100, { k1: 3.0, b: 0.75 });
    // Higher k1 adjusts term frequency saturation → scores should differ
    expect(scoreHighK1).not.toBe(scoreDefault);
  });

  it('handles repeated terms in query without double-counting', () => {
    const query = ['a', 'a', 'a'];
    const doc = ['a'];
    const score = computeBm25Score(query, doc, 50);
    // Without dedup in query, the score would be 3x higher
    // With dedup (which the code does via `seen` Set), should be same as single 'a'
    const scoreSingle = computeBm25Score(['a'], doc, 50);
    expect(score).toBe(scoreSingle);
  });
});

describe('estimateAvgDocLength', () => {
  it('returns 200 for empty chunk list', () => {
    expect(estimateAvgDocLength([])).toBe(200);
  });

  it('computes average token length for given chunks', () => {
    const chunks = [
      { content: '长川科技半导体设备' },
      { content: '大盘震荡上行' },
    ];
    const avg = estimateAvgDocLength(chunks);
    expect(avg).toBeGreaterThanOrEqual(50);
  });
});
