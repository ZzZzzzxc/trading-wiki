import type { GraphNode } from '../graph';
import { providerRegistry } from '@/lib/ai/provider-registry';
import type { DebateResult } from './debate-node';

export const synthesizeNode: GraphNode = {
  id: 'synthesize',
  deps: ['debate'],
  execute: async (ctx) => {
    const report = ctx.get('report') as string;
    const debate = ctx.get('debate') as DebateResult;
    if (!report) throw new Error('synthesize: 缺少研究报告');
    const evidenceLedger = (ctx.get('evidenceLedger') as string | undefined) || '暂无结构化证据。';
    const coverage = (ctx.get('coverage') as string | undefined) || '暂无子问题覆盖状态。';
    const reportInstruction = (ctx.get('reportInstruction') as string | undefined) || '';

    const provider = providerRegistry.getForTask('generation');
    const prompt = `基于以下研究报告和多视角辩论结果，撰写综合研究报告。

原始报告:
${report.slice(0, 3000)}

子问题覆盖状态:
${coverage.slice(0, 2000)}

Evidence Ledger:
${evidenceLedger.slice(0, 5000)}

辩论记录:
${debate.rounds.map(r => `第${r.round}轮:
乐观: ${r.bull.conclusion}
悲观: ${r.bear.conclusion}`).join('\n')}

中立关键变量: ${debate.neutral.keyVariables.join(', ')}

要求：
1. 根据悲观方意见降级或删除证据不足的结论
2. 低置信度或无证据结论必须标注“待验证”
3. 保持“需求变化 -> 产业瓶颈 -> 供需错配 -> 公司映射 -> 股价预期差”的逻辑

${reportInstruction}`;

    const finalReport = await provider.chat(
      '你是一个投研报告撰写专家。输出Markdown格式。',
      prompt,
      { temperature: 0.3 },
    );
    ctx.set('synthesize_prompt', prompt);
    ctx.set('synthesize_response', finalReport);

    return { report: finalReport };
  },
};
