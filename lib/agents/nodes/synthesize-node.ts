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

    const provider = providerRegistry.getForTask('generation');
    const prompt = `基于以下研究报告和多视角辩论结果，撰写综合研究报告。

原始报告:
${report.slice(0, 3000)}

辩论记录:
${debate.rounds.map(r => `第${r.round}轮:
乐观: ${r.bull.conclusion}
悲观: ${r.bear.conclusion}`).join('\n')}

中立关键变量: ${debate.neutral.keyVariables.join(', ')}

请按以下格式输出:
## 核心结论
（综合多视角后的核心判断）

## 证据链
（每个结论对应的来源）

## 多视角分析
### 乐观面
### 悲观面
### 平衡判断

## 关键验证变量
（需要跟踪的条件）

## 交易含义
（对投资决策的影响）`;

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
