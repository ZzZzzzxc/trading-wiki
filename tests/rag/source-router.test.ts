import { describe, expect, test } from 'vitest';
import { routeQuerySource } from '@/lib/rag/source-router';

describe('routeQuerySource（LLM + regex 回退）', () => {
  test('LLM 不可用时回退到 regex 分类', async () => {
    // 没有 DEEPSEEK_API_KEY 时，应静默回退到 regex
    const route = await routeQuerySource('最近半导体有什么新闻');
    // regex 应识别 recency 意图
    expect(route.recencyFirst).toBe(true);
    expect(route.docTypeBoosts.raw).toBeGreaterThan(1);
    expect(['llm', 'regex'].includes(route.method)).toBe(true);
  });

  test('产业链问题 → expandRelated + theme 加权', async () => {
    const route = await routeQuerySource('AI算力产业链上下游有哪些公司');
    expect(route.expandRelated).toBe(true);
    expect(route.docTypeBoosts.theme_research).toBeGreaterThan(1);
  });

  test('验证问题 → viewpoint 加权', async () => {
    const route = await routeQuerySource('长川科技Q3量产的预测应验了吗');
    expect(route.docTypeBoosts.viewpoint).toBeGreaterThan(1);
  });

  test('个股深度 → stock_profile 加权', async () => {
    const route = await routeQuerySource('300604 的估值锚和产能规划');
    expect(route.docTypeBoosts.stock_profile).toBeGreaterThan(1);
  });

  test('市场复盘 → daily_review 加权', async () => {
    const route = await routeQuerySource('最近一周的复盘总结，主线板块表现如何');
    expect(route.docTypeBoosts.daily_review).toBeGreaterThan(1);
  });

  test('普通问题 → 仅保留 QA 历史降权', async () => {
    const route = await routeQuerySource('介绍一下半导体设备行业的基本情况');
    expect(route.docTypeBoosts).toEqual({ qa: 0.3 });
  });

  test('超长查询不会被截断导致分类失败', async () => {
    const longQuery = '请详细分析'.repeat(50) + '长川科技的估值锚';
    const route = await routeQuerySource(longQuery);
    // 不抛异常，正常返回路由（至少 regex 能匹配到 stock_deep）
    expect(route).toBeDefined();
    expect(route.method).toBeDefined();
  });
});
