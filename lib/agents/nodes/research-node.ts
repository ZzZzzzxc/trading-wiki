import type { GraphNode } from '../graph';
import { toolRegistry } from '@/lib/ai/skills/registry';

export const researchNode: GraphNode = {
  id: 'research',
  deps: ['plan'],
  execute: async (ctx) => {
    const question = ctx.get('question') as string;
    const subQuestions = ctx.get('subQuestions') as string[];
    const config = ctx.get('config') as { depth?: string; debate?: boolean; focus?: string };

    // 返回研究上下文供 debate 和 synthesize 使用
    return { subQuestions, status: 'ready' };
  },
};
