import { describe, expect, it } from 'vitest';
import { buildViewpointMarkdown } from '@/lib/viewpoints/markdown';

describe('viewpoint markdown builder', () => {
  it('renders structured extraction into markdown sections', () => {
    const markdown = buildViewpointMarkdown({
      title: '某关注人观点蒸馏',
      rawText: '半导体设备值得继续跟踪。',
      extraction: {
        summary: '偏中短期看多半导体设备。',
        stance: 'bullish',
        time_horizon: 'short',
        mentioned_stocks: ['300604'],
        mentioned_themes: ['半导体设备'],
        facts: [{text: '市场关注度提升', source: 'original'}],
        opinions: [{text: '设备链存在交易机会', source: 'original'}],
        reasoning: [{text: '订单预期改善可能带来估值抬升', source: 'original'}],
        risks: [{text: '订单兑现不及预期', source: 'original'}],
        counter_evidence: [{text: '如果全球半导体周期见顶，设备需求可能放缓', source: 'original'}],
        verifiable_claims: [{claim: '订单预期改善', verify_by: '后续订单公告', suggested_window: '30日'}],
        confidence: 'medium',
      },
    });

    expect(markdown).toContain('# 某关注人观点蒸馏');
    expect(markdown).toContain('## AI 摘要');
    expect(markdown).toContain('- 半导体设备');
    expect(markdown).toContain('- 设备链存在交易机会');
  });
});
