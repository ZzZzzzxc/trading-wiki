import type { GraphNode } from '../graph';
import { providerRegistry } from '@/lib/ai/provider-registry';

export interface DebateConfig {
  rounds: number;  // 1-3
}

export interface DebateResult {
  rounds: Array<{
    round: number;
    bull: { title: string; points: string[]; conclusion: string };
    bear: { title: string; points: string[]; conclusion: string };
  }>;
  neutral: { title: string; consensus?: string[]; disagreements?: string[]; keyVariables: string[] };
}

export function createDebateNode(config: DebateConfig): GraphNode {
  return {
    id: 'debate',
    deps: ['research'],
    execute: async (ctx): Promise<DebateResult> => {
      const report = ctx.get('report') as string;
      if (!report) throw new Error('debate: 缺少研究报告');
      const evidenceLedger = (ctx.get('evidenceLedger') as string | undefined) || '暂无结构化证据。';
      const coverage = (ctx.get('coverage') as string | undefined) || '暂无子问题覆盖状态。';

      const provider = providerRegistry.getForTask('generation');
      const rounds = Math.min(Math.max(config.rounds, 1), 3);
      const debateRounds: DebateResult['rounds'] = [];
      let bullContext = '';
      let bearContext = '';

      for (let r = 0; r < rounds; r++) {
        // Bull 发言
        const bullPrompt = `你是拥有15年行业经验的乐观派投研分析师。你的风格是积极但不盲目，每个观点必须引用报告或Evidence Ledger中的具体证据编号作为支撑。

基于以下研究报告，从乐观视角分析。

研究报告:
${report.slice(0, 3000)}

子问题覆盖状态:
${coverage.slice(0, 2000)}

Evidence Ledger:
${evidenceLedger.slice(0, 5000)}

${bullContext ? `上轮看空方的论点：
${bearContext}` : ''}

要求：
1. 每个观点必须引用报告中的具体数据、事实或Evidence编号
2. 如果上轮有看空方的论点，必须逐一回应
3. 明确指出你认为看空方忽略了哪些关键因素

请输出乐观分析JSON:
{ "title": "标题", "points": ["观点1（数据支撑）","观点2（数据支撑）","观点3（数据支撑）"], "conclusion": "总结" }`;

        const bullText = await provider.chat('你是一个乐观的投研分析师。输出JSON。', bullPrompt, { temperature: 0.7 });
        ctx.set('debate_bull_prompt_' + r, bullPrompt);
        ctx.set('debate_bull_response_' + r, bullText);
        const bullJson = JSON.parse(bullText.match(/\{[\s\S]*\}/)?.[0] || '{}');

        // Bear 发言（基于 Bull 的观点反驳）
        const bearPrompt = `你是拥有15年行业经验的悲观派投研分析师。你擅长发现乐观逻辑中的漏洞、证据缺口和被误炒的方向。

基于以下研究报告，从悲观视角分析。请针对乐观方的观点提出逐一反驳。

研究报告:
${report.slice(0, 3000)}

子问题覆盖状态:
${coverage.slice(0, 2000)}

Evidence Ledger:
${evidenceLedger.slice(0, 5000)}

乐观方的观点:
${JSON.stringify(bullJson)}

要求：
1. 逐条反驳乐观方的每个观点，指出其忽略的风险或假设
2. 每个反驳必须引用报告中的反例、风险因素或指出Evidence缺口
3. 明确指出乐观方的逻辑漏洞
4. 必须覆盖：证据不足结论、产业链传导不成立处、可能被误炒方向、已充分定价方向

请输出悲观分析JSON:
{ "title": "标题", "points": ["反驳1（数据支撑）","反驳2（数据支撑）","反驳3（数据支撑）"], "conclusion": "总结" }`;

        const bearText = await provider.chat('你是一个悲观的投研分析师。输出JSON。', bearPrompt, { temperature: 0.7 });
        ctx.set('debate_bear_prompt_' + r, bearPrompt);
        ctx.set('debate_bear_response_' + r, bearText);
        const bearJson = JSON.parse(bearText.match(/\{[\s\S]*\}/)?.[0] || '{}');

        debateRounds.push({
          round: r + 1,
          bull: { title: bullJson.title || '', points: bullJson.points || [], conclusion: bullJson.conclusion || '' },
          bear: { title: bearJson.title || '', points: bearJson.points || [], conclusion: bearJson.conclusion || '' },
        });

        bullContext = JSON.stringify(bullJson);
        bearContext = JSON.stringify(bearJson);
      }

      // 中立综合
      const neutralPrompt = `基于以下多轮辩论记录，给出中立平衡判断。

${debateRounds.map(r => `第${r.round}轮:
乐观: ${r.bull.conclusion}
悲观: ${r.bear.conclusion}`).join('\n\n')}

输出JSON: { "title": "平衡判断", "keyVariables": ["关键变量1","关键变量2"] }`;

      const neutralText = await provider.chat('你是一个中立的投研分析师。输出JSON。', neutralPrompt, { temperature: 0.3 });
      ctx.set('debate_neutral_prompt', neutralPrompt);
      ctx.set('debate_neutral_response', neutralText);
      const neutralJson = JSON.parse(neutralText.match(/\{[\s\S]*\}/)?.[0] || '{}');

      return {
        rounds: debateRounds,
        neutral: {
          title: neutralJson.title || '平衡判断',
          consensus: neutralJson.consensus || [],
          disagreements: neutralJson.disagreements || [],
          keyVariables: neutralJson.keyVariables || [],
        },
      };
    },
  };
}
