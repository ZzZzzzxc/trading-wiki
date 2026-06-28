import { streamText, isStepCount } from 'ai';
import type { ToolSet } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { getDeepSeekConfig } from './model';
import { toolRegistry } from './skills/registry';
import './skills/research';
import crypto from 'node:crypto';
import { RunRecorder } from '@/lib/agent-debug/run-recorder';
import { SimpleGraph } from '@/lib/agents/graph';
import { planNode, type PlanOutput } from '@/lib/agents/nodes/plan-node';
import { createDebateNode, type DebateResult } from '@/lib/agents/nodes/debate-node';
import { synthesizeNode } from '@/lib/agents/nodes/synthesize-node';

export interface ResearchPlan {
  title: string;
  subQuestions: string[];
  depth: 'quick' | 'standard' | 'deep';
}

export interface ResearchConfig {
  depth: 'quick' | 'standard' | 'deep';
  focus: 'comprehensive' | 'technical' | 'fundamental' | 'news';
  debate: boolean; // 是否启用多角色辩论合成
}

export interface AgentEvent {
  type:
    | 'agent_plan'
    | 'agent_step'
    | 'agent_tool_call'
    | 'agent_tool_result'
    | 'agent_evidence'
    | 'agent_debate_start'
    | 'agent_debate_result'
    | 'report_chunk'
    | 'report_done'
    | 'error';
  data: unknown;
}

/**
 * 构建研究 Graph。
 * 始终注册 planNode，若 debate=true 则额外注册 debateNode 和 synthesizeNode。
 * 注意：本图仅供整体注册用；实际执行时因 streamText 穿插其间，
 * 需拆分为规划图（planNode）和辩论合成图（debateNode + synthesizeNode）两阶段。
 */
function buildResearchGraph(config: ResearchConfig): SimpleGraph {
  const graph = new SimpleGraph();
  graph.addNode(planNode);
  if (config.debate) {
    const rounds = config.depth === 'deep' ? 3 : config.depth === 'standard' ? 2 : 1;
    graph.addNode({ ...createDebateNode({ rounds }), deps: [] });
    graph.addNode(synthesizeNode);
  }
  return graph;
}

export async function* researchAgent(
  question: string,
  config: ResearchConfig = { depth: 'standard', focus: 'comprehensive', debate: true },
): AsyncGenerator<AgentEvent> {
  const { depth, focus, debate } = config;
  const recorder = new RunRecorder(question, { depth, focus, debate });
  const deepseekConfig = getDeepSeekConfig();

  // 阶段1: 使用 Graph 生成研究方案
  const graphCtx = new Map<string, unknown>();
  graphCtx.set('question', question);
  graphCtx.set('config', config);

  try {
    // 阶段1: 使用 Graph execute 执行规划节点
    const planStepId = crypto.randomUUID();
    const planCtx = await recorder.step('拆解研究方案', 'planning', async () => {
      const planGraph = new SimpleGraph();
      planGraph.addNode(planNode);
      return planGraph.execute(Object.fromEntries(graphCtx));
    }, planStepId);
    // 将 graph 输出合并回 graphCtx
    for (const [key, value] of planCtx) {
      graphCtx.set(key, value);
    }
    const planResult = planCtx.get('plan') as PlanOutput;
    if (graphCtx.has('planPrompt') && graphCtx.has('planResponse')) {
      recorder.recordLlmCall(planStepId, {
        system: graphCtx.get('planPrompt') as string,
        user: '研究问题: ' + question,
      }, graphCtx.get('planResponse') as string, 0);
    }
    yield { type: 'agent_plan', data: planResult };
    const plan = {
      ...(planResult as { title: string; subQuestions: string[] }),
      depth,
    } satisfies ResearchPlan;

    // 阶段2: Agent 循环研究
    const systemPrompt = `你是一个A股投研深度研究助手。你的任务是通过工具调用进行多步研究。

研究问题: ${question}

研究计划: ${plan.subQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

工作方式：
1. 每次选择一个子问题，使用 search_knowledge_base 搜索相关资料
2. 找到相关文档后用 read_document 阅读全文
3. 如果需要验证某些断言，使用 get_facts
4. 逐步积累证据，完成所有子问题的研究
5. 如果信息不足，自动追加搜索

当你完成所有研究后，撰写一份完整的研究报告。
报告格式：
## 结论
（核心判断）

## 证据链
（每个结论对应的来源）

## 分歧与反证
（相反观点和证据）

## 后续验证
（需要跟踪的条件）

## 交易含义
（对投资决策的影响）

## 引用来源
（完整来源列表）`;

    const deepseekProvider = createOpenAICompatible({
      baseURL: deepseekConfig.baseUrl,
      name: 'deepseek',
      apiKey: deepseekConfig.apiKey,
    });

    const model = deepseekProvider.languageModel(deepseekConfig.model);
    const maxSteps = depth === 'quick' ? 3 : depth === 'deep' ? 10 : 6;

    const result = streamText({
      model,
      messages: [
        {
          role: 'user' as const,
          content: `开始研究: ${question}

请按计划逐步研究，最终撰写完整报告。`,
        },
      ],
      system: systemPrompt,
      tools: toolRegistry.toAISdkTools({ question }) as ToolSet,
      stopWhen: isStepCount(maxSteps),
      timeout: { totalMs: 120000 }, // 2 分钟超时防止卡死
    });

    // Agent Debug: 研究阶段
    const researchStepId = 'research_' + crypto.randomUUID().slice(0, 8);
    recorder.startStep(researchStepId, '多步工具研究', 'tool_call');

    // 阶段3: 流式输出
    let fullReport = '';
    for await (const event of result.fullStream) {
      if (event.type === 'text-delta') {
        fullReport += event.text;
        yield { type: 'report_chunk', data: { delta: event.text, content: fullReport } };
      } else if (event.type === 'tool-call') {
        recorder.recordToolCallStart(researchStepId, event.toolName, event.input as Record<string, unknown>);
        yield {
          type: 'agent_tool_call',
          data: { tool: event.toolName, input: event.input },
        };
      } else if (event.type === 'tool-result') {
        recorder.recordToolCallEnd(researchStepId, event.toolName, event.output);
        yield {
          type: 'agent_tool_result',
          data: { tool: event.toolName, summary: getResultSummary(event.output) },
        };
      }
    }

    recorder.finishStep(researchStepId, fullReport ? 'success' : 'failed');

    // 阶段3: 多角色辩论合成（使用 Graph execute）
    if (debate && fullReport) {
      graphCtx.set('report', fullReport);

      yield { type: 'agent_debate_start', data: { perspectives: ['乐观', '悲观', '中立'] } };

      const debateRounds = depth === 'deep' ? 3 : depth === 'standard' ? 2 : 1;

      try {
        const debateStepId = crypto.randomUUID();
        const debateCtx = await recorder.step('多角色辩论与合成', 'debate', async () => {
          const debateGraph = new SimpleGraph();
          debateGraph.addNode({ ...createDebateNode({ rounds: debateRounds }), deps: [] });
          debateGraph.addNode(synthesizeNode);
          return debateGraph.execute(Object.fromEntries(graphCtx));
        }, debateStepId);

        // 记录 debate 中各 LLM 调用的 prompt/response/tokens
        for (let r = 0; r < debateRounds; r++) {
          const bullPrompt = debateCtx.get('debate_bull_prompt_' + r) as string | undefined;
          const bullResponse = debateCtx.get('debate_bull_response_' + r) as string | undefined;
          if (bullPrompt && bullResponse) {
            recorder.recordLlmCall(debateStepId, { system: '', user: bullPrompt.slice(0, 500) }, bullResponse, 0, {
              input: estimateTokens(bullPrompt),
              output: estimateTokens(bullResponse),
            });
          }
          const bearPrompt = debateCtx.get('debate_bear_prompt_' + r) as string | undefined;
          const bearResponse = debateCtx.get('debate_bear_response_' + r) as string | undefined;
          if (bearPrompt && bearResponse) {
            recorder.recordLlmCall(debateStepId, { system: '', user: bearPrompt.slice(0, 500) }, bearResponse, 0, {
              input: estimateTokens(bearPrompt),
              output: estimateTokens(bearResponse),
            });
          }
        }
        // 记录 neutral 调用
        const neutralPrompt = debateCtx.get('debate_neutral_prompt') as string | undefined;
        const neutralResponse = debateCtx.get('debate_neutral_response') as string | undefined;
        if (neutralPrompt && neutralResponse) {
          recorder.recordLlmCall(debateStepId, { system: '', user: neutralPrompt.slice(0, 500) }, neutralResponse, 0, {
            input: estimateTokens(neutralPrompt),
            output: estimateTokens(neutralResponse),
          });
        }
        // 记录 synthesize 调用
        const synthPrompt = debateCtx.get('synthesize_prompt') as string | undefined;
        const synthResponse = debateCtx.get('synthesize_response') as string | undefined;
        if (synthPrompt && synthResponse) {
          recorder.recordLlmCall(debateStepId, { system: '', user: synthPrompt.slice(0, 500) }, synthResponse, 0, {
            input: estimateTokens(synthPrompt),
            output: estimateTokens(synthResponse),
          });
        }

        const debateResult = debateCtx.get('debate') as DebateResult;
        yield { type: 'agent_debate_result', data: debateResult };

        const synthResult = debateCtx.get('synthesize') as { report: string };
        const finalReport = synthResult.report;

        yield { type: 'report_chunk', data: { delta: '', content: finalReport } };
        yield { type: 'report_done', data: { report: finalReport, debate: debateResult } };
        await recorder.finish(finalReport);
      } catch (err) {
        // 辩论失败，回退到原始报告
        yield { type: 'report_done', data: { report: fullReport } };
        await recorder.finish(fullReport);
      }
    } else {
      yield { type: 'report_done', data: { report: fullReport } };
      await recorder.finish(fullReport);
    }
  } catch (err) {
    await recorder.finish(undefined, {
      type: 'unknown',
      message: err instanceof Error ? err.message : '研究过程出错',
    });
    yield {
      type: 'error',
      data: { message: err instanceof Error ? err.message : '研究过程出错' },
    };
  }
}

/**
 * 使用 SimpleGraph 编排的研究流程（基于 Graph 节点：plan → streamText → debate → synthesize）。
 * 与 researchAgent 功能一致，明确标识使用 Graph 进行规划、辩论和合成。
 * Graph 管理 plan / debate / synthesize 三个纯 LLM 调用节点，
 * streamText 流式研究循环保持原有逻辑。
 */
export async function* researchWithGraph(
  question: string,
  config: ResearchConfig = { depth: 'standard', focus: 'comprehensive', debate: true },
): AsyncGenerator<AgentEvent> {
  yield* researchAgent(question, config);
}

function getResultSummary(result: unknown): string {
  if (result == null) return '无结果';
  if (Array.isArray(result)) return `找到 ${result.length} 条结果`;
  if (typeof result === 'object' && 'content' in (result as Record<string, unknown>))
    return '已读取文档';
  if (typeof result === 'object' && 'error' in (result as Record<string, unknown>))
    return `查询失败: ${(result as Record<string, string>).error}`;
  const str = JSON.stringify(result);
  return str ? str.slice(0, 100) : '无结果';
}

/**
 * 粗略估算文本的 token 数。
 * 用于 Agent 调试模块的 LLM 调用埋点，非精确计费用途。
 * 中文约 1.5-2 chars/token，英文约 4 chars/token，
 * 对中英混搭的投研内容取约 2 chars/token 为折中估算。
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 2));
}
