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
import { runRagRetrieval } from '@/lib/rag/pipeline';
import {
  buildCoverageText,
  buildEvidenceBasedFallbackReport,
  buildEvidenceLedgerText,
  buildResearchReportInstruction,
  buildResearchSubQuestions,
  assessResearchQuality,
  confidenceFromScore,
  createInitialCoverage,
  evidenceFromHit,
  FOCUS_GUIDES,
  FOCUS_RAG_OPTIONS,
  getResearchBudget,
  inferReportSection,
  isMeaningfulResearchReport,
  normalizeSnippet,
  repairResearchReport,
  validateResearchReport,
  type ResearchConfig,
  type ResearchEvidenceItem,
  type ResearchPlan,
  type ResearchQualityAssessment,
  type ResearchReportValidation,
  type ResearchTaskCoverage,
} from './research-protocol';

export type {
  ResearchConfig,
  ResearchEvidenceItem,
  ResearchPlan,
  ResearchQualityAssessment,
  ResearchReportContract,
  ResearchReportValidation,
  ResearchTaskCoverage,
} from './research-protocol';

export interface AgentEvent {
  type:
    | 'agent_plan'
    | 'agent_step'
    | 'agent_tool_call'
    | 'agent_tool_result'
    | 'agent_evidence'
    | 'agent_coverage'
    | 'agent_research_summary'
    | 'agent_report_draft'
    | 'agent_report_fallback'
    | 'agent_report_validation'
    | 'agent_report_final'
    | 'agent_quality'
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
  const { depth, focus } = config;
  const debate = depth === 'deep' ? true : config.debate;
  const effectiveConfig: ResearchConfig = { depth, focus, debate };
  const budget = getResearchBudget(depth);
  const recorder = new RunRecorder(question, effectiveConfig);
  const deepseekConfig = getDeepSeekConfig();

  // 阶段1: 使用 Graph 生成研究方案
  const graphCtx = new Map<string, unknown>();
  graphCtx.set('question', question);
  graphCtx.set('config', effectiveConfig);

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
    const plan = {
      title: planResult.title,
      subQuestions: buildResearchSubQuestions(question, planResult.subQuestions ?? [], depth),
      depth,
    } satisfies ResearchPlan;
    yield { type: 'agent_plan', data: plan };

    // 阶段2: 计划驱动的RAG预检索，确保每个子问题至少被检索一次
    const researchStepId = 'research_' + crypto.randomUUID().slice(0, 8);
    recorder.startStep(researchStepId, '多步工具研究', 'tool_call');

    const coverage = createInitialCoverage(plan.subQuestions);
    const evidenceLedger: ResearchEvidenceItem[] = [];
    const seenChunkIds = new Set<string>();
    const ragTraceIds: string[] = [];
    const focusOptions = FOCUS_RAG_OPTIONS[focus];

    for (let i = 0; i < coverage.length; i++) {
      const subQuestion = coverage[i].subQuestion;
      coverage[i] = { ...coverage[i], status: 'searching' };
      const searchingEvent = buildCoverageEvent(coverage[i], coverage);
      recorder.recordResearchEvent(researchStepId, 'agent_coverage', searchingEvent);
      yield { type: 'agent_coverage', data: searchingEvent };

      const traceId = `${recorder.runId}_subq_${i + 1}`;
      try {
        const rag = await runRagRetrieval(subQuestion, {
          traceId,
          topK: budget.presearchTopK,
          contextTopK: budget.presearchTopK,
          maxChunksPerDoc: 2,
          sourceBoosts: focusOptions.sourceBoosts,
          weights: focusOptions.weights,
        });
        ragTraceIds.push(traceId);
        recorder.recordRagRetrieve(researchStepId, subQuestion, rag.contextHits.length, budget.presearchTopK);

        const newEvidence = rag.contextHits
          .filter((hit) => !seenChunkIds.has(hit.chunk.id))
          .slice(0, budget.evidencePerQuestion)
          .map((hit, offset) => evidenceFromHit(hit, evidenceLedger.length + offset + 1, subQuestion));

        for (const item of newEvidence) {
          evidenceLedger.push(item);
          seenChunkIds.add(item.chunkId);
          const evidenceEvent = { evidence: item, subQuestion, traceId };
          recorder.recordResearchEvent(researchStepId, 'agent_evidence', evidenceEvent);
          yield { type: 'agent_evidence', data: evidenceEvent };
        }

        coverage[i] = newEvidence.length
          ? {
              ...coverage[i],
              status: 'evidence_found',
              evidenceIds: newEvidence.map((item) => item.id),
              summary: `命中 ${rag.contextHits.length} 个chunk，纳入 ${newEvidence.length} 条证据。`,
            }
          : {
              ...coverage[i],
              status: 'insufficient',
              evidenceIds: [],
              summary: 'RAG未命中可用证据，报告中相关判断必须标注待验证。',
            };
      } catch (error) {
        coverage[i] = {
          ...coverage[i],
          status: 'insufficient',
          evidenceIds: [],
          summary: error instanceof Error ? `检索失败：${error.message}` : '检索失败。',
        };
      }

      const coverageEvent = buildCoverageEvent(coverage[i], coverage);
      recorder.recordResearchEvent(researchStepId, 'agent_coverage', coverageEvent);
      yield { type: 'agent_coverage', data: coverageEvent };
    }

    if (evidenceLedger.length < budget.minEvidence) {
      const traceId = `${recorder.runId}_supplement`;
      try {
        const rag = await runRagRetrieval(question, {
          traceId,
          topK: Math.max(budget.presearchTopK, budget.minEvidence - evidenceLedger.length),
          contextTopK: Math.max(budget.presearchTopK, budget.minEvidence - evidenceLedger.length),
          maxChunksPerDoc: 2,
          sourceBoosts: focusOptions.sourceBoosts,
          weights: focusOptions.weights,
        });
        ragTraceIds.push(traceId);
        recorder.recordRagRetrieve(researchStepId, question, rag.contextHits.length, budget.presearchTopK);

        const remaining = Math.max(0, budget.minEvidence - evidenceLedger.length);
        const supplemental = rag.contextHits
          .filter((hit) => !seenChunkIds.has(hit.chunk.id))
          .slice(0, remaining)
          .map((hit, offset) => evidenceFromHit(hit, evidenceLedger.length + offset + 1, question));

        for (const item of supplemental) {
          evidenceLedger.push(item);
          seenChunkIds.add(item.chunkId);
          const evidenceEvent = { evidence: item, subQuestion: question, traceId };
          recorder.recordResearchEvent(researchStepId, 'agent_evidence', evidenceEvent);
          yield { type: 'agent_evidence', data: evidenceEvent };
        }
      } catch {
        // 补充检索失败不阻断主流程，报告会基于已有证据并标注不足。
      }
    }

    const presearchSummary = buildResearchSummary(coverage, evidenceLedger, ragTraceIds, budget.minEvidence);
    recorder.recordResearchEvent(researchStepId, 'agent_research_summary', presearchSummary);
    yield { type: 'agent_research_summary', data: presearchSummary };

    const coverageText = buildCoverageText(coverage);
    const evidenceText = buildEvidenceLedgerText(evidenceLedger);
    const needsToolResearch = evidenceLedger.length < budget.minEvidence
      || coverage.some((item) => item.status === 'insufficient');

    // 阶段3: Agent 循环研究
    const systemPrompt = `你是一个A股投研深度研究助手。你的任务是基于本地知识库证据完成可验证的多步研究。

研究问题: ${question}

研究深度: ${depth}
研究聚焦: ${focus}
聚焦要求: ${FOCUS_GUIDES[focus]}
证据下限: 至少 ${budget.minEvidence} 条 evidence；当前预检索已有 ${evidenceLedger.length} 条。

研究计划: ${plan.subQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

子问题覆盖状态:
${coverageText}

Evidence Ledger:
${evidenceText}

当前执行策略：
${needsToolResearch
  ? '预检索证据不足。你可以调用工具补充缺口，然后再撰写最终报告。'
  : '预检索证据已达标。禁止继续搜索或请求更多资料，必须直接基于Evidence Ledger撰写最终报告。'}

工作方式：
1. 优先补充 coverage 为 insufficient 或证据较弱的子问题
2. 使用 search_knowledge_base 搜索时传入 focus="${focus}" 和当前 subQuestion
3. 找到相关文档后优先用 read_document 读取 chunkId 或限长内容，不要默认读取全文
4. 如果需要验证某些断言，使用 get_facts
5. 逐步积累证据，完成所有子问题的研究；无证据结论必须标注“待验证”
6. 如果信息不足，自动追加搜索，但不要编造数据、订单、价格或公司映射

${buildResearchReportInstruction()}`;

    const deepseekProvider = createOpenAICompatible({
      baseURL: deepseekConfig.baseUrl,
      name: 'deepseek',
      apiKey: deepseekConfig.apiKey,
    });

    const model = deepseekProvider.languageModel(deepseekConfig.model);
    const maxSteps = budget.maxSteps;

    const result = streamText({
      model,
      messages: [
        {
          role: 'user' as const,
          content: needsToolResearch
            ? `开始研究: ${question}

请按计划补充证据缺口，最终撰写完整报告。`
            : `开始撰写: ${question}

请直接基于已提供的Coverage和Evidence Ledger撰写完整报告，不要调用工具，不要输出研究过程。`,
        },
      ],
      system: systemPrompt,
      tools: needsToolResearch
        ? toolRegistry.toAISdkTools({ question, depth, focus, runId: recorder.runId }) as ToolSet
        : undefined,
      stopWhen: isStepCount(maxSteps),
      timeout: { totalMs: 120000 }, // 2 分钟超时防止卡死
    });

    // 阶段4: 流式输出
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
        const toolEvidence = appendToolEvidence(event.output, evidenceLedger, seenChunkIds);
        for (const item of toolEvidence.items) {
          const evidenceEvent = { evidence: item, subQuestion: toolEvidence.subQuestion, traceId: toolEvidence.traceId };
          recorder.recordResearchEvent(researchStepId, 'agent_evidence', evidenceEvent);
          yield { type: 'agent_evidence', data: evidenceEvent };
        }
        if (toolEvidence.traceId) ragTraceIds.push(toolEvidence.traceId);
        if (toolEvidence.items.length && toolEvidence.subQuestion) {
          const matched = coverage.findIndex((item) => item.subQuestion === toolEvidence.subQuestion);
          if (matched >= 0) {
            coverage[matched] = {
              ...coverage[matched],
              status: 'evidence_found',
              evidenceIds: Array.from(new Set([...coverage[matched].evidenceIds, ...toolEvidence.items.map((item) => item.id)])),
              summary: `工具补充 ${toolEvidence.items.length} 条证据。`,
            };
            const coverageEvent = buildCoverageEvent(coverage[matched], coverage);
            recorder.recordResearchEvent(researchStepId, 'agent_coverage', coverageEvent);
            yield { type: 'agent_coverage', data: coverageEvent };
          }
        }
        yield {
          type: 'agent_tool_result',
          data: { tool: event.toolName, summary: getResultSummary(event.output) },
        };
      }
    }
    if (fullReport) {
      recorder.recordResearchEvent(researchStepId, 'agent_report_draft', {
        source: 'streamText',
        length: fullReport.length,
        report: fullReport,
      });
    }

    for (let i = 0; i < coverage.length; i++) {
      if (coverage[i].status === 'evidence_found') {
        coverage[i] = { ...coverage[i], status: 'summarized', summary: coverage[i].summary || '已纳入最终报告上下文。' };
        const coverageEvent = buildCoverageEvent(coverage[i], coverage);
        recorder.recordResearchEvent(researchStepId, 'agent_coverage', coverageEvent);
        yield { type: 'agent_coverage', data: coverageEvent };
      }
    }

    const finalResearchSummary = buildResearchSummary(coverage, evidenceLedger, ragTraceIds, budget.minEvidence);
    recorder.recordResearchEvent(researchStepId, 'agent_research_summary', finalResearchSummary);
    yield { type: 'agent_research_summary', data: finalResearchSummary };

    recorder.finishStep(researchStepId, fullReport ? 'success' : 'failed');

    // 阶段5: 多角色辩论合成（使用 Graph execute）
    if (debate && fullReport) {
      graphCtx.set('report', fullReport);
      graphCtx.set('coverage', buildCoverageText(coverage));
      graphCtx.set('evidenceLedger', buildEvidenceLedgerText(evidenceLedger));
      graphCtx.set('reportInstruction', buildResearchReportInstruction());

      yield { type: 'agent_debate_start', data: { perspectives: ['乐观', '悲观', '中立'] } };

      const debateRounds = budget.debateRounds;

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
        const finishedReport = yield* emitReportDone({
          report: finalReport,
          question,
          planTitle: plan.title,
          debate: debateResult,
          evidence: evidenceLedger,
          coverage,
          researchSummary: finalResearchSummary,
          recorder,
          stepId: researchStepId,
        });
        await recorder.finish(finishedReport);
      } catch (err) {
        // 辩论失败，回退到原始报告
        const finishedReport = yield* emitReportDone({
          report: fullReport,
          question,
          planTitle: plan.title,
          evidence: evidenceLedger,
          coverage,
          researchSummary: finalResearchSummary,
          recorder,
          stepId: researchStepId,
        });
        await recorder.finish(finishedReport);
      }
    } else {
      const finishedReport = yield* emitReportDone({
        report: fullReport,
        question,
        planTitle: plan.title,
        evidence: evidenceLedger,
        coverage,
        researchSummary: finalResearchSummary,
        recorder,
        stepId: researchStepId,
      });
      await recorder.finish(finishedReport);
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
  if (isSearchToolOutput(result)) {
    const topScore = result.hits[0]?.score;
    const scoreText = typeof topScore === 'number' ? `，最高分 ${topScore.toFixed(2)}` : '';
    const traceText = result.traceId ? `，trace ${result.traceId}` : '';
    const errorText = result.error ? `，错误: ${result.error}` : '';
    return `找到 ${result.hits.length} 条RAG结果${scoreText}${traceText}${errorText}`;
  }
  if (typeof result === 'object' && 'content' in (result as Record<string, unknown>))
    return (result as { truncated?: boolean }).truncated ? '已限长读取文档' : '已读取文档';
  if (typeof result === 'object' && 'error' in (result as Record<string, unknown>))
    return `查询失败: ${(result as Record<string, string>).error}`;
  const str = JSON.stringify(result);
  return str ? str.slice(0, 100) : '无结果';
}

interface SearchToolHit {
  chunkId?: string;
  id?: string;
  docId?: string;
  title?: string;
  heading?: string;
  score?: number;
  snippet?: string;
  content?: string;
}

interface SearchToolOutput {
  traceId?: string;
  subQuestion?: string;
  searchQuery?: string;
  hits: SearchToolHit[];
  error?: string;
}

function isSearchToolOutput(value: unknown): value is SearchToolOutput {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as { hits?: unknown }).hits));
}

function appendToolEvidence(
  output: unknown,
  evidenceLedger: ResearchEvidenceItem[],
  seenChunkIds: Set<string>,
): { items: ResearchEvidenceItem[]; subQuestion?: string; traceId?: string } {
  if (!isSearchToolOutput(output)) return { items: [] };

  const subQuestion = output.subQuestion || output.searchQuery || '工具补充检索';
  const items: ResearchEvidenceItem[] = [];

  for (const hit of output.hits) {
    const chunkId = hit.chunkId || hit.id;
    const docId = hit.docId;
    if (!chunkId || !docId || seenChunkIds.has(chunkId)) continue;

    const score = typeof hit.score === 'number' ? hit.score : 0;
    const evidence: ResearchEvidenceItem = {
      id: `E${String(evidenceLedger.length + items.length + 1).padStart(2, '0')}`,
      claim: `${subQuestion} | ${hit.title || '未命名资料'} / ${hit.heading || '正文'}`,
      sourceDocId: docId,
      chunkId,
      title: hit.title || '未命名资料',
      snippet: normalizeSnippet(hit.snippet || hit.content || ''),
      score,
      confidence: confidenceFromScore(score),
      usedInSection: inferReportSection(`${subQuestion} ${hit.title || ''} ${hit.heading || ''}`),
      needsCheck: score < 0.48,
    };

    items.push(evidence);
    seenChunkIds.add(chunkId);
  }

  evidenceLedger.push(...items);
  return { items, subQuestion, traceId: output.traceId };
}

function buildResearchSummary(
  coverage: ResearchTaskCoverage[],
  evidence: ResearchEvidenceItem[],
  ragTraceIds: string[],
  minEvidence: number,
) {
  const covered = coverage.filter((item) => item.status === 'evidence_found' || item.status === 'summarized').length;
  const insufficient = coverage.filter((item) => item.status === 'insufficient').map((item) => item.subQuestion);
  const uniqueTraceIds = Array.from(new Set(ragTraceIds.filter(Boolean)));

  return {
    evidenceCount: evidence.length,
    minEvidence,
    coverageDone: covered,
    coverageTotal: coverage.length,
    coverageRate: coverage.length ? covered / coverage.length : 0,
    ragTraceIds: uniqueTraceIds,
    insufficientQuestions: insufficient,
    citationCoverage: evidence.length >= minEvidence ? 'enough' : 'below_minimum',
  };
}

function cloneCoverage(item: ResearchTaskCoverage): ResearchTaskCoverage {
  return { ...item, evidenceIds: [...item.evidenceIds] };
}

function buildCoverageEvent(coverage: ResearchTaskCoverage, coverageAll: ResearchTaskCoverage[]) {
  return {
    coverage: cloneCoverage(coverage),
    coverageAll: coverageAll.map(cloneCoverage),
  };
}

function* emitReportDone(params: {
  report: string;
  question: string;
  planTitle?: string;
  debate?: DebateResult;
  evidence: ResearchEvidenceItem[];
  coverage: ResearchTaskCoverage[];
  researchSummary: ReturnType<typeof buildResearchSummary>;
  recorder: RunRecorder;
  stepId: string;
}): Generator<AgentEvent, string> {
  const fallback = isMeaningfulResearchReport(params.report)
    ? { report: params.report, used: false, reason: undefined }
    : buildEvidenceBasedFallbackReport({
        question: params.question,
        title: params.planTitle,
        evidence: params.evidence,
        coverage: params.coverage,
      });
  if (fallback.used) {
    params.recorder.recordResearchEvent(params.stepId, 'agent_report_fallback', {
      reason: fallback.reason,
      length: fallback.report.length,
      report: fallback.report,
    });
    yield { type: 'report_chunk', data: { delta: '', content: fallback.report } };
  }

  const repair = repairResearchReport(fallback.report, params.evidence, params.coverage);
  if (repair.repaired) {
    params.recorder.recordResearchEvent(params.stepId, 'agent_report_repair', {
      repairNotes: repair.repairNotes,
      length: repair.report.length,
      report: repair.report,
    });
    yield { type: 'report_chunk', data: { delta: '', content: repair.report } };
  }

  const reportValidation: ResearchReportValidation = {
    ...validateResearchReport(repair.report, params.evidence, params.coverage),
    repaired: repair.repaired,
    repairNotes: repair.repairNotes,
    fallbackUsed: fallback.used,
    fallbackReason: fallback.reason,
  };
  params.recorder.recordResearchEvent(params.stepId, 'agent_report_validation', reportValidation);
  yield { type: 'agent_report_validation', data: reportValidation };

  const quality = assessResearchQuality({
    evidence: params.evidence,
    coverage: params.coverage,
    validation: reportValidation,
    minEvidence: params.researchSummary.minEvidence,
  });
  params.recorder.recordResearchEvent(params.stepId, 'agent_quality', quality);
  yield { type: 'agent_quality', data: quality };

  const doneEvent = {
    report: repair.report,
    debate: params.debate,
    evidence: params.evidence,
    coverage: params.coverage,
    researchSummary: params.researchSummary,
    reportValidation,
    quality,
  };
  params.recorder.recordResearchEvent(params.stepId, 'agent_report_final', {
    length: repair.report.length,
    report: repair.report,
    repaired: repair.repaired,
    fallbackUsed: fallback.used,
  });
  params.recorder.recordResearchEvent(params.stepId, 'report_done', doneEvent);
  yield { type: 'report_done', data: doneEvent };
  return repair.report;
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
