/**
 * 研究 Graph 编排函数。
 *
 * 职责范围：
 * - planNode: 生成研究方案
 * - debateNode（可选）: 多角色辩论
 * - synthesizeNode（可选）: 综合报告
 *
 * 注意：streamText 流式研究循环保留在 research-agent.ts 中，不在 Graph 内执行。
 * 调用方可先执行 runResearchGraph 获取规划结果，待研究完成后
 * 再调用 runDebateAndSynthesis 执行辩论与合成。
 */

import { SimpleGraph } from './graph';
import { planNode } from './nodes/plan-node';
import { createDebateNode, type DebateResult } from './nodes/debate-node';
import { synthesizeNode } from './nodes/synthesize-node';
import type { AgentEvent } from '@/lib/ai/research-agent';

/**
 * 执行研究流程的规划阶段。
 *
 * 1. 构建 Graph（注册 planNode + debateNode + synthesizeNode）
 * 2. 执行 planNode → 输出研究方案 → emit agent_plan
 * 3. 返回 ctx，调用方可继续注入 report 后执行辩论与合成
 */
export async function runResearchGraph(
  question: string,
  config: { depth: string; debate: boolean; focus: string },
  emit: (event: AgentEvent) => void,
): Promise<Map<string, unknown>> {
  const ctx = new Map<string, unknown>();
  ctx.set('question', question);
  ctx.set('config', config);

  // 执行规划（使用 Graph execute）
  const planGraph = new SimpleGraph();
  planGraph.addNode(planNode);
  const planCtx = await planGraph.execute(Object.fromEntries(ctx));
  // 合并结果回 ctx
  for (const [key, value] of planCtx) {
    ctx.set(key, value);
  }
  const planOutput = planCtx.get('plan');
  emit({ type: 'agent_plan', data: planOutput });

  return ctx;
}

/**
 * 在研究完成后执行辩论和合成阶段。
 *
 * 1. 将完整报告注入 ctx
 * 2. 执行 debateNode → emit agent_debate_start / agent_debate_result
 * 3. 执行 synthesizeNode → emit report_chunk / report_done
 * 4. 返回最终综合报告
 */
export async function runDebateAndSynthesis(
  ctx: Map<string, unknown>,
  fullReport: string,
  config: { depth: string; debate: boolean },
  emit: (event: AgentEvent) => void,
): Promise<string> {
  if (!config.debate || !fullReport) {
    return fullReport;
  }

  ctx.set('report', fullReport);

  emit({ type: 'agent_debate_start', data: { perspectives: ['乐观', '悲观', '中立'] } });

  const debateRounds = config.depth === 'deep' ? 3 : config.depth === 'standard' ? 2 : 1;

  // 使用 Graph execute 执行辩论和合成
  const debateGraph = new SimpleGraph();
  debateGraph.addNode({ ...createDebateNode({ rounds: debateRounds }), deps: [] });
  debateGraph.addNode(synthesizeNode);
  const resultCtx = await debateGraph.execute(Object.fromEntries(ctx));

  // 合并结果回 ctx
  for (const [key, value] of resultCtx) {
    ctx.set(key, value);
  }

  const debateResult = resultCtx.get('debate') as DebateResult;
  emit({ type: 'agent_debate_result', data: debateResult });

  const synthResult = resultCtx.get('synthesize') as { report: string };
  const finalReport = synthResult.report;

  emit({ type: 'report_chunk', data: { delta: '', content: finalReport } });
  emit({ type: 'report_done', data: { report: finalReport, debate: debateResult } });

  return finalReport;
}
