import { describe, expect, it } from 'vitest';
import { normalizeAiOutput } from '@/lib/ai/normalize';

describe('normalizeAiOutput', () => {
  // Tests covering normalizeSource() logic via sourced array fields

  describe('normalizeSource — Chinese keywords', () => {
    it('maps "原始" to "original"', () => {
      const result = normalizeAiOutput({
        facts: [{ text: '事实内容', source: '原始资料' }],
      }) as { facts: Array<{ text: string; source: string }> };
      expect(result.facts[0].source).toBe('original');
    });

    it('maps "追加" to "original"', () => {
      const result = normalizeAiOutput({
        facts: [{ text: '补充事实', source: '追加信息' }],
      }) as { facts: Array<{ text: string; source: string }> };
      expect(result.facts[0].source).toBe('original');
    });

    it('maps "资料" to "original"', () => {
      const result = normalizeAiOutput({
        facts: [{ text: '来自资料', source: '资料' }],
      }) as { facts: Array<{ text: string; source: string }> };
      expect(result.facts[0].source).toBe('original');
    });

    it('maps "公告" to "original"', () => {
      const result = normalizeAiOutput({
        facts: [{ text: '公告内容', source: '公司公告' }],
      }) as { facts: Array<{ text: string; source: string }> };
      expect(result.facts[0].source).toBe('original');
    });

    it('maps "新闻" to "original"', () => {
      const result = normalizeAiOutput({
        facts: [{ text: '新闻内容', source: '新闻' }],
      }) as { facts: Array<{ text: string; source: string }> };
      expect(result.facts[0].source).toBe('original');
    });

    it('maps "观点" to "opinion"', () => {
      const result = normalizeAiOutput({
        opinions: [{ text: '我认为', source: '观点' }],
      }) as { opinions: Array<{ text: string; source: string }> };
      expect(result.opinions[0].source).toBe('opinion');
    });

    it('maps "关注人" to "opinion"', () => {
      const result = normalizeAiOutput({
        opinions: [{ text: '关注', source: '关注人观点' }],
      }) as { opinions: Array<{ text: string; source: string }> };
      expect(result.opinions[0].source).toBe('opinion');
    });
  });

  describe('normalizeSource — English keywords', () => {
    it('maps "infer" to "inferred"', () => {
      const result = normalizeAiOutput({
        inferences: [{ text: '推理', source: 'infer from data' }],
      }) as { inferences: Array<{ text: string; source: string }> };
      expect(result.inferences[0].source).toBe('inferred');
    });

    it('maps "market" to "market"', () => {
      const result = normalizeAiOutput({
        reasoning: [{ text: '市场数据', source: 'market data' }],
      }) as { reasoning: Array<{ text: string; source: string }> };
      expect(result.reasoning[0].source).toBe('market');
    });

    it('maps "rag" to "rag"', () => {
      const result = normalizeAiOutput({
        facts: [{ text: '检索结果', source: 'rag' }],
      }) as { facts: Array<{ text: string; source: string }> };
      expect(result.facts[0].source).toBe('rag');
    });
  });

  describe('normalizeSource — no match', () => {
    it('maps unknown keyword to "unknown"', () => {
      const result = normalizeAiOutput({
        opinions: [{ text: '随便', source: '随便说说' }],
      }) as { opinions: Array<{ text: string; source: string }> };
      expect(result.opinions[0].source).toBe('unknown');
    });

    it('maps empty string to "unknown"', () => {
      const result = normalizeAiOutput({
        facts: [{ text: '事实', source: '' }],
      }) as { facts: Array<{ text: string; source: string }> };
      expect(result.facts[0].source).toBe('unknown');
    });

    it('defaults to "unknown" when source is missing', () => {
      const result = normalizeAiOutput({
        facts: [{ text: '只有文本' }],
      }) as { facts: Array<{ text: string; source: string }> };
      expect(result.facts[0].source).toBe('unknown');
    });
  });

  // Tests covering toSourcedItem() logic

  describe('toSourcedItem', () => {
    it('converts plain string in sourced array field to { text, source: "unknown" }', () => {
      const result = normalizeAiOutput({
        opinions: ['这是一个观点'],
      }) as { opinions: Array<{ text: string; source: string }> };
      expect(result.opinions[0]).toEqual({
        text: '这是一个观点',
        source: 'unknown',
      });
    });

    it('preserves source_ref when present', () => {
      const result = normalizeAiOutput({
        facts: [
          { text: '有来源的事实', source: 'rag', source_ref: 'doc-123' },
        ],
      }) as { facts: Array<{ text: string; source: string; source_ref?: string }> };
      expect(result.facts[0].source_ref).toBe('doc-123');
      expect(result.facts[0].text).toBe('有来源的事实');
      expect(result.facts[0].source).toBe('rag');
    });

    it('handles empty object in array as { text: "", source: "unknown" }', () => {
      const result = normalizeAiOutput({
        opinions: [{}],
      }) as { opinions: Array<{ text: string; source: string }> };
      expect(result.opinions[0]).toEqual({
        text: '',
        source: 'unknown',
      });
    });

    it('returns empty array for null value in sourced field', () => {
      const result = normalizeAiOutput({
        // biome-ignore lint/suspicious/noExplicitAny: deliberate edge case
        opinions: null as any,
      }) as { opinions: Array<unknown> };
      expect(result.opinions).toEqual([]);
    });
  });
});
