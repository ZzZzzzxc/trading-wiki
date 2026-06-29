import type { GraphNode } from '../graph';
import { providerRegistry } from '@/lib/ai/provider-registry';
import type { ResearchConfig } from '@/lib/ai/research-protocol';

export interface PlanOutput {
  title: string;
  subQuestions: string[];
}

export const planNode: GraphNode = {
  id: 'plan',
  deps: [],
  execute: async (ctx) => {
    const question = ctx.get('question') as string;
    const config = ctx.get('config') as ResearchConfig;

    if (!question) throw new Error('plan: question 不能为空');

    const provider = providerRegistry.getForTask('structured');
    const depthGuide = config.depth === 'quick' ? '拆解为2-3个子问题' : config.depth === 'deep' ? '拆解为5-7个子问题' : '拆解为4-5个子问题';
    const focusGuide = {
      comprehensive: '全面覆盖技术、产业、公司、催化、风险。',
      technical: '重点覆盖技术路线、设备、材料、工艺、国产替代和客户验证。',
      fundamental: '重点覆盖公司、产能、客户、订单、毛利率、价值量和估值。',
      news: '重点覆盖近期催化、政策、价格、招标、公告和供需变化。',
    }[config.focus];

    const prompt = `你是一个A股投研专家。请分析用户的研究问题，${depthGuide}，每个子问题都必须具体可搜索。

研究聚焦: ${config.focus}
聚焦要求: ${focusGuide}

示例：
问题：光纤光缆行业投资价值分析
输出：{ "title": "光纤光缆行业深度研究", "subQuestions": ["光纤光缆行业供需格局与价格趋势", "主要标的公司业绩与估值对比", "行业催化剂与风险因素"] }

问题：京东方A
输出：{ "title": "京东方A投资价值分析", "subQuestions": ["京东方核心业务与财务表现", "显示面板行业周期位置与供需", "OLED/MLED等新技术布局进展"] }

输出JSON格式：{ "title": "研究标题", "subQuestions": ["子问题1", "子问题2", ...] }
研究问题: ${question}`;

    const schema = { parse: (v: unknown) => v as PlanOutput };
    // 简化：使用 provider 的 chat 方法 + JSON.parse
    const text = await provider.chat('你是一个投研专家。输出JSON。', prompt, { temperature: 0.2 });
    ctx.set('planPrompt', '你是一个投研专家。输出JSON。\n\n' + prompt);
    ctx.set('planResponse', text);
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error('plan: LLM 输出格式错误');
    const plan: PlanOutput = JSON.parse(json);

    ctx.set('subQuestions', plan.subQuestions);
    ctx.set('planTitle', plan.title);
    return plan;
  },
};
