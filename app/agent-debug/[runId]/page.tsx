'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { ArrowLeft, Clock, CheckCircle, XCircle, Search, FileText, MessageSquare, Brain, ChevronDown } from 'lucide-react';

interface AgentDebugEvent {
  type: string;
  runId: string;
  stepId?: string;
  name?: string;
  latencyMs?: number;
  status?: string;
  prompt?: { system: string; user: string };
  response?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  query?: string;
  resultsCount?: number;
  error?: { type: string; message: string };
  timestamp?: string;
  [key: string]: unknown;
}

interface DebugEvidence {
  id?: string;
  title?: string;
  chunkId?: string;
  snippet?: string;
  score?: number;
  confidence?: string;
  usedInSection?: string;
}

interface DebugCoverage {
  subQuestion?: string;
  status?: string;
  evidenceIds?: string[];
  summary?: string;
}

export default function RunDetailPage() {
  const params = useParams();
  const runId = params.runId as string;
  const [events, setEvents] = useState<AgentDebugEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>('');

  useEffect(() => {
    fetch(`/api/agent-debug/runs/${runId}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) setEvents(d.data.events);
        else setError(d.error || '加载失败');
      })
      .catch(() => setError('加载失败'))
      .finally(() => setLoading(false));
  }, [runId]);

  const startEvent = events.find(e => e.type === 'run_started');
  const finishEvent = events.find(e => e.type === 'run_finished');
  const stepEvents = events.filter(e => e.type === 'step_started' || e.type === 'step_finished');
  const llmCalls = events.filter(e => e.type === 'llm_call');
  const toolCalls = events.filter(e => e.type === 'tool_call');
  const ragRetrieves = events.filter(e => e.type === 'rag_retrieve');
  const evidenceEvents = events.filter(e => e.type === 'agent_evidence');
  const coverageEvents = events.filter(e => e.type === 'agent_coverage');
  const researchSummary = [...events].reverse().find(e => e.type === 'agent_research_summary')?.data as {
    evidenceCount?: number;
    minEvidence?: number;
    coverageDone?: number;
    coverageTotal?: number;
    ragTraceIds?: string[];
    insufficientQuestions?: string[];
    citationCoverage?: string;
  } | undefined;
  const reportValidation = [...events].reverse().find(e => e.type === 'agent_report_validation')?.data as {
    missingSections?: string[];
    citedEvidenceIds?: string[];
    uncitedEvidenceIds?: string[];
    citationCoverageRate?: number;
    warnings?: string[];
    passed?: boolean;
    repaired?: boolean;
    repairNotes?: string[];
    fallbackUsed?: boolean;
    fallbackReason?: string;
  } | undefined;
  const quality = [...events].reverse().find(e => e.type === 'agent_quality')?.data as {
    score?: number;
    grade?: string;
    dimensions?: { coverage?: number; evidence?: number; structure?: number; citation?: number };
    reasons?: string[];
    blockers?: string[];
  } | undefined;

  const latencyMs = finishEvent?.latencyMs as number | undefined;
  const reportDone = events.find(e => e.type === 'report_done');
  const reportContent = ((reportDone?.data as any)?.report || (reportDone as any)?.report || '') as string;

  const eventIcon = (e: AgentDebugEvent) => {
    const name = (e.name || '').toLowerCase();
    if (name.includes('拆解') || name.includes('规划')) return <Brain size={14} style={{ color: '#d4b16a' }} />;
    if (name.includes('辩论')) return <MessageSquare size={14} style={{ color: '#c084fc' }} />;
    if (name.includes('综合') || name.includes('报告')) return <FileText size={14} style={{ color: '#6ed19f' }} />;
    if (e.type === 'tool_call') return <Search size={14} style={{ color: '#7eb8ff' }} />;
    return <Clock size={14} style={{ color: 'var(--muted)' }} />;
  };

  function renderReportPreview(text: string): string {
    if (!text) return '';
    let html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(.+)$/gm, function(m: string) {
        if (m.startsWith('<')) return m;
        if (!m.trim()) return '';
        return m;
      });
    return '<p>' + html + '</p>';
  }

  function estimateTotalTokens(calls: AgentDebugEvent[]): string {
    const total = calls.reduce((sum: number, c: AgentDebugEvent) => {
      const input = (c.prompt?.system?.length || 0) + (c.prompt?.user?.length || 0);
      const output = (c.response?.length || 0);
      return sum + Math.ceil(input / 2) + Math.ceil(output / 2);
    }, 0);
    if (total < 1000) return `${total} tokens`;
    return `${(total / 1000).toFixed(1)}k tokens`;
  }

  const handleFeedback = async (rating: string) => {
    await fetch('/api/agent-debug/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, rating, labels: [], comment: feedback }),
    });
    alert('反馈已提交');
  };

  if (loading) return (
    <AppShell currentPath="/agent-debug">
      <div className="page-stack"><div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>加载中...</div></div>
    </AppShell>
  );

  if (error) return (
    <AppShell currentPath="/agent-debug">
      <div className="page-stack"><div className="status-message status-error">{error}</div></div>
    </AppShell>
  );

  return (
    <AppShell currentPath="/agent-debug">
      <div className="page-stack">
        <Breadcrumb path={`/agent-debug/${runId}`} />

        <Link href="/agent-debug" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)', textDecoration: 'none', marginBottom: 8 }}>
          <ArrowLeft size={14} /> 返回列表
        </Link>

        {/* Run 概览 */}
        <div className="glass-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>用户问题</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{startEvent?.userQuery as string || '未知'}</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
                <span>状态: {finishEvent?.status === 'success' ? '✅ 成功' : finishEvent?.status === 'failed' ? '❌ 失败' : '⏳ 运行中'}</span>
                <span>耗时: {latencyMs ? `${(latencyMs / 1000).toFixed(1)}s` : '-'}</span>
                <span>LLM 调用: {llmCalls.length} 次</span>
                <span>工具调用: {toolCalls.filter(e => e.phase !== 'end').length} 次</span>
                <span>RAG 检索: {ragRetrieves.length} 次</span>
                <span>步骤: {stepEvents.filter(e => e.type === 'step_started').length} 步</span>
                {llmCalls.length > 0 && <span>估算 Token: {estimateTotalTokens(llmCalls)}</span>}
              </div>
            </div>
            <Link href={`/research?question=${encodeURIComponent(startEvent?.userQuery as string || '')}&depth=quick`}
              className="primary-button" style={{ fontSize: 12, padding: '6px 12px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              🔄 重新研究
            </Link>
          </div>
        </div>

        {(researchSummary || evidenceEvents.length > 0 || coverageEvents.length > 0 || reportValidation || quality) && (
          <div className="glass-card" style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>研究证据与覆盖</h3>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
              {quality && <span style={{ color: (quality.score ?? 0) >= 70 ? '#6ed19f' : (quality.score ?? 0) >= 55 ? '#d4b16a' : '#e09090' }}>质量: {quality.grade} · {quality.score}</span>}
              <span>Evidence: {researchSummary?.evidenceCount ?? evidenceEvents.length}{researchSummary?.minEvidence ? ` / ${researchSummary.minEvidence}` : ''}</span>
              {researchSummary?.coverageTotal != null && <span>Coverage: {researchSummary.coverageDone}/{researchSummary.coverageTotal}</span>}
              {researchSummary?.citationCoverage && <span>引用覆盖: {researchSummary.citationCoverage === 'enough' ? '达标' : '不足'}</span>}
              {reportValidation && <span>报告引用: {reportValidation.citedEvidenceIds?.length ?? 0}/{(reportValidation.citedEvidenceIds?.length ?? 0) + (reportValidation.uncitedEvidenceIds?.length ?? 0)}</span>}
              {reportValidation && <span>报告结构: {reportValidation.missingSections?.length ? `缺 ${reportValidation.missingSections.length}` : '完整'}</span>}
              {reportValidation && <span>校验: {reportValidation.passed ? '通过' : '有警告'}</span>}
              {reportValidation?.fallbackUsed && <span>Evidence草稿: 是</span>}
              {reportValidation?.repaired && <span>自动修复: 是</span>}
              {researchSummary?.ragTraceIds?.length ? <span>RAG trace: {researchSummary.ragTraceIds.length}</span> : null}
            </div>
            {quality?.dimensions && (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
                <span>覆盖 {quality.dimensions.coverage ?? 0}</span>
                <span>证据 {quality.dimensions.evidence ?? 0}</span>
                <span>结构 {quality.dimensions.structure ?? 0}</span>
                <span>引用 {quality.dimensions.citation ?? 0}</span>
              </div>
            )}
            {researchSummary?.insufficientQuestions?.length ? (
              <div style={{ marginTop: 10, fontSize: 12, color: '#e09090', lineHeight: 1.7 }}>
                证据不足: {researchSummary.insufficientQuestions.join('；')}
              </div>
            ) : null}
            {researchSummary?.ragTraceIds?.length ? (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all' }}>
                {researchSummary.ragTraceIds.slice(0, 6).join(' · ')}
                {researchSummary.ragTraceIds.length > 6 ? ` · +${researchSummary.ragTraceIds.length - 6}` : ''}
              </div>
            ) : null}
            {quality?.reasons?.length ? (
              <div style={{ marginTop: 10, fontSize: 12, color: '#d4b16a', lineHeight: 1.7 }}>
                质量原因: {quality.reasons.join('；')}
              </div>
            ) : null}
            {quality?.blockers?.length ? (
              <div style={{ marginTop: 10, fontSize: 12, color: '#e09090', lineHeight: 1.7 }}>
                阻断项: {quality.blockers.join('；')}
              </div>
            ) : null}
            {reportValidation?.warnings?.length ? (
              <div style={{ marginTop: 10, fontSize: 12, color: '#d4b16a', lineHeight: 1.7 }}>
                报告校验: {reportValidation.warnings.join('；')}
              </div>
            ) : null}
            {reportValidation?.repairNotes?.length ? (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                自动修复: {reportValidation.repairNotes.join('；')}
              </div>
            ) : null}
            {reportValidation?.fallbackUsed ? (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                回退生成: {reportValidation.fallbackReason || '模型正文不足，已使用Evidence生成草稿'}
              </div>
            ) : null}
          </div>
        )}

        {/* Step 时间线 */}
        <div className="glass-card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Step 时间线</h3>
          <div style={{ display: 'grid', gap: 6 }}>
            {stepEvents.filter(e => e.type === 'step_started').map((event, i) => {
              const finished = stepEvents.find(e => e.type === 'step_finished' && e.stepId === event.stepId);
              const latMs = finished?.latencyMs as number | undefined;
              const stepStatus = finished?.status as string | undefined;
              const isExpanded = expandedStep === event.stepId;
              const stepLlmCalls = llmCalls.filter(c => c.stepId === event.stepId);
              const stepToolCalls = toolCalls.filter(c => c.stepId === event.stepId);
              const stepRagRetrieves = ragRetrieves.filter(c => c.stepId === event.stepId);
              const stepEvidenceEvents = evidenceEvents.filter(c => c.stepId === event.stepId);
              const stepCoverageEvents = coverageEvents.filter(c => c.stepId === event.stepId);
              const stepSummaries = events.filter(c => c.type === 'agent_research_summary' && c.stepId === event.stepId);
              const stepReportEvents = events.filter(c =>
                c.stepId === event.stepId
                && ['agent_report_draft', 'agent_report_fallback', 'agent_report_repair', 'agent_report_validation', 'agent_quality', 'agent_report_final', 'report_done'].includes(c.type)
              );
              const latestCoverageData = [...stepCoverageEvents]
                .reverse()
                .find(c => Array.isArray(((c.data as Record<string, unknown> | undefined)?.coverageAll)))?.data as { coverageAll?: DebugCoverage[] } | undefined;
              const latestSummary = [...stepSummaries].reverse()[0]?.data as {
                evidenceCount?: number;
                minEvidence?: number;
                coverageDone?: number;
                coverageTotal?: number;
                ragTraceIds?: string[];
                insufficientQuestions?: string[];
              } | undefined;
              const hasStepDetails = stepLlmCalls.length > 0
                || stepToolCalls.length > 0
                || stepRagRetrieves.length > 0
                || stepEvidenceEvents.length > 0
                || stepCoverageEvents.length > 0
                || stepSummaries.length > 0
                || stepReportEvents.length > 0;

              return (
                <div key={event.stepId || i} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                  <div
                    onClick={() => setExpandedStep(isExpanded ? null : event.stepId || '')}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: stepStatus === 'failed' ? 'rgba(224,144,144,0.06)' : 'transparent' }}
                  >
                    {eventIcon(event)}
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{event.name as string}</span>
                    {stepStatus === 'success' && <CheckCircle size={14} style={{ color: '#6ed19f' }} />}
                    {stepStatus === 'failed' && <XCircle size={14} style={{ color: '#e09090' }} />}
                    {latMs != null && <span style={{ fontSize: 11, color: latMs > 3000 ? '#e09090' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{latMs > 1000 ? `${(latMs / 1000).toFixed(1)}s` : `${latMs}ms`}</span>}
                    <ChevronDown size={14} style={{ color: 'var(--muted)', transform: isExpanded ? 'rotate(180deg)' : '', transition: 'transform 200ms' }} />
                  </div>
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: 14, fontSize: 12, background: 'rgba(7,12,20,0.4)' }}>
                      {stepLlmCalls.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#7eb8ff' }}>LLM 调用</div>
                          {stepLlmCalls.map((lc, j) => (
                            <div key={j} style={{ background: 'rgba(15,23,34,0.6)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                              <div style={{ color: 'var(--muted)', marginBottom: 4, maxHeight: 200, overflowY: 'auto', fontSize: 11, wordBreak: 'break-all' }}>
                                <span style={{ fontWeight: 600 }}>System:</span> {(lc.prompt?.system || '')}
                              </div>
                              <div style={{ color: 'var(--muted)', marginBottom: 4, maxHeight: 100, overflowY: 'auto', fontSize: 11, wordBreak: 'break-all' }}>
                                <span style={{ fontWeight: 600 }}>User:</span> {(lc.prompt?.user || '')}
                              </div>
                              <div style={{ color: 'var(--muted)', maxHeight: 200, overflowY: 'auto', fontSize: 11, wordBreak: 'break-all' }}>
                                <span style={{ fontWeight: 600 }}>Response:</span> {(lc.response || '')}
                              </div>
                              {lc.latencyMs && <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 11 }}>耗时: {lc.latencyMs}ms</div>}
                            </div>
                          ))}
                        </div>
                      )}
                      {stepRagRetrieves.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#7eb8ff' }}>RAG 检索</div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {stepRagRetrieves.map((rag, j) => (
                              <div key={j} style={{ background: 'rgba(15,23,34,0.6)', borderRadius: 8, padding: 10, fontSize: 11 }}>
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', color: 'var(--muted)', marginBottom: 4 }}>
                                  <span>命中: {String(rag.resultsCount ?? 0)}</span>
                                  <span>TopK: {String(rag.topK ?? '-')}</span>
                                  {rag.timestamp && <span>{String(rag.timestamp).slice(11, 19)}</span>}
                                </div>
                                <div style={{ wordBreak: 'break-all' }}>
                                  <span style={{ color: '#7eb8ff' }}>Query:</span> {String(rag.query || '')}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(latestCoverageData?.coverageAll?.length || stepCoverageEvents.length > 0) && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#d4b16a' }}>子问题覆盖</div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {(latestCoverageData?.coverageAll || stepCoverageEvents.map(e => (e.data as { coverage?: DebugCoverage } | undefined)?.coverage).filter(Boolean) as DebugCoverage[]).map((item, j) => (
                              <div key={j} style={{ background: 'rgba(15,23,34,0.6)', borderRadius: 8, padding: 10, fontSize: 11 }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                                  <span style={{ color: coverageDebugColor(item.status), fontWeight: 600 }}>{coverageDebugLabel(item.status)}</span>
                                  <span style={{ color: 'var(--muted)' }}>{item.evidenceIds?.length || 0} 条证据</span>
                                </div>
                                <div style={{ wordBreak: 'break-all' }}>{item.subQuestion || '-'}</div>
                                {item.summary && <div style={{ marginTop: 4, color: 'var(--muted)', lineHeight: 1.5 }}>{item.summary}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {stepEvidenceEvents.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#6ed19f' }}>Evidence Ledger</div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {stepEvidenceEvents.slice(0, 12).map((ev, j) => {
                              const evidence = ((ev.data as { evidence?: DebugEvidence } | undefined)?.evidence) || {};
                              return (
                                <div key={j} style={{ background: 'rgba(15,23,34,0.6)', borderRadius: 8, padding: 10, fontSize: 11 }}>
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                                    <span style={{ color: '#6ed19f', fontWeight: 700 }}>{evidence.id || `E${j + 1}`}</span>
                                    {evidence.confidence && <span style={{ color: 'var(--muted)' }}>{evidence.confidence}</span>}
                                    {typeof evidence.score === 'number' && <span style={{ color: 'var(--muted)' }}>score {evidence.score.toFixed(2)}</span>}
                                    {evidence.usedInSection && <span style={{ color: 'var(--muted)' }}>{evidence.usedInSection}</span>}
                                  </div>
                                  <div style={{ fontWeight: 600, marginBottom: 4, wordBreak: 'break-all' }}>{evidence.title || evidence.chunkId || '未命名证据'}</div>
                                  {evidence.snippet && <div style={{ color: 'var(--muted)', lineHeight: 1.5, maxHeight: 72, overflow: 'hidden' }}>{evidence.snippet}</div>}
                                </div>
                              );
                            })}
                            {stepEvidenceEvents.length > 12 && (
                              <div style={{ color: 'var(--muted)', fontSize: 11 }}>还有 {stepEvidenceEvents.length - 12} 条 evidence 未展开。</div>
                            )}
                          </div>
                        </div>
                      )}
                      {stepToolCalls.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#6ed19f' }}>工具调用</div>
                          {stepToolCalls.map((tc, j) => (
                            <div key={j} style={{ background: 'rgba(15,23,34,0.6)', borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 11 }}>
                              <div style={{ fontSize: 11, wordBreak: 'break-all' }}>
                                <span style={{ color: '#7eb8ff' }}>{String(tc.toolName || '')}</span>
                                {tc.phase != null ? <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{String(tc.phase)}</span> : null}
                                {tc.args ? <span> {JSON.stringify(tc.args)}</span> : null}
                              </div>
                              {tc.result != null && (
                                <div style={{ color: 'var(--muted)', marginTop: 6, maxHeight: 120, overflow: 'auto', wordBreak: 'break-all' }}>
                                  {JSON.stringify(tc.result).slice(0, 1000)}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {latestSummary && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#c084fc' }}>研究摘要</div>
                          <div style={{ background: 'rgba(15,23,34,0.6)', borderRadius: 8, padding: 10, fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
                            <span>Evidence: {latestSummary.evidenceCount ?? 0}{latestSummary.minEvidence ? ` / ${latestSummary.minEvidence}` : ''}</span>
                            <span style={{ marginLeft: 12 }}>Coverage: {latestSummary.coverageDone ?? 0}/{latestSummary.coverageTotal ?? 0}</span>
                            <span style={{ marginLeft: 12 }}>RAG trace: {latestSummary.ragTraceIds?.length ?? 0}</span>
                            {latestSummary.insufficientQuestions?.length ? (
                              <div style={{ color: '#e09090', marginTop: 4 }}>
                                证据不足: {latestSummary.insufficientQuestions.join('；')}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )}
                      {stepReportEvents.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#6ed19f' }}>报告校验与输出</div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {stepReportEvents.map((ev, j) => (
                              <div key={j} style={{ background: 'rgba(15,23,34,0.6)', borderRadius: 8, padding: 10, fontSize: 11, color: 'var(--muted)' }}>
                                <div style={{ color: '#6ed19f', fontWeight: 600, marginBottom: 4 }}>{reportEventLabel(ev.type)}</div>
                                <div style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap', maxHeight: hasReportText(ev) ? 280 : 120, overflow: 'auto', lineHeight: 1.6 }}>
                                  {summarizeReportEvent(ev)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {!hasStepDetails && (
                        <div style={{ color: 'var(--muted)', fontSize: 12 }}>该步骤暂无可展示的详细事件。</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 最终报告预览 */}
        {reportContent && (
          <div className="glass-card" style={{ padding: 20 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>最终报告</h3>
            <div className="markdown-body" style={{ fontSize: 13, lineHeight: 1.7, maxHeight: 500, overflowY: 'auto' }}
              dangerouslySetInnerHTML={{ __html: renderReportPreview(reportContent) }} />
          </div>
        )}

        {/* 错误诊断 */}
        {events.filter(e => e.type === 'run_error').length > 0 && (
          <div className="glass-card" style={{ padding: 20, borderColor: 'rgba(224,144,144,0.2)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#e09090' }}>错误诊断</h3>
            {events.filter(e => e.type === 'run_error').map((e, i) => (
              <div key={i} style={{ fontSize: 13, lineHeight: 1.6 }}>
                <div><strong>类型:</strong> {(e.error as { type: string })?.type || '未知'}</div>
                <div><strong>消息:</strong> {(e.error as { message: string })?.message}</div>
              </div>
            ))}
          </div>
        )}

        {/* 反馈 */}
        <div className="glass-card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>反馈</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {['good', 'partial', 'bad'].map(r => (
              <button key={r} onClick={() => handleFeedback(r)} type="button"
                className="ghost-button" style={{ fontSize: 12, padding: '6px 12px' }}>
                {r === 'good' ? '👍 准确' : r === 'partial' ? '🤏 部分准确' : '👎 不准确'}
              </button>
            ))}
          </div>
          <textarea value={feedback} onChange={e => setFeedback(e.target.value)}
            placeholder="备注（可选）"
            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(7,12,20,0.88)', color: 'var(--text)', font: 'inherit', fontSize: 13, padding: '10px 12px', resize: 'vertical', minHeight: 60, lineHeight: 1.6 }}
          />
        </div>
      </div>
    </AppShell>
  );
}

function coverageDebugLabel(status?: string): string {
  if (status === 'pending') return '未开始';
  if (status === 'searching') return '检索中';
  if (status === 'evidence_found') return '已获证据';
  if (status === 'summarized') return '已总结';
  if (status === 'insufficient') return '证据不足';
  return status || '未知';
}

function coverageDebugColor(status?: string): string {
  if (status === 'insufficient') return '#e09090';
  if (status === 'pending') return 'var(--muted)';
  if (status === 'searching') return '#7eb8ff';
  return '#6ed19f';
}

function reportEventLabel(type: string): string {
  if (type === 'agent_report_draft') return '报告草稿';
  if (type === 'agent_report_fallback') return 'Evidence 草稿';
  if (type === 'agent_report_repair') return '自动修复';
  if (type === 'agent_report_validation') return '报告校验';
  if (type === 'agent_quality') return '质量评分';
  if (type === 'agent_report_final') return '最终报告';
  if (type === 'report_done') return '最终输出';
  return type;
}

function hasReportText(event: AgentDebugEvent): boolean {
  const data = event.data as Record<string, unknown> | undefined;
  return Boolean(data && typeof data.report === 'string' && data.report.length > 0);
}

function summarizeReportEvent(event: AgentDebugEvent): string {
  const data = event.data as Record<string, unknown> | undefined;
  if (!data) return '';
  if (event.type === 'agent_report_draft') {
    const report = typeof data.report === 'string' ? data.report : '';
    return `草稿 ${String(data.length ?? report.length)} 字\n\n${report}`;
  }
  if (event.type === 'agent_quality') {
    return `质量 ${(data.grade as string | undefined) || '-'} · ${String(data.score ?? '-')}`;
  }
  if (event.type === 'agent_report_validation') {
    const missing = Array.isArray(data.missingSections) ? data.missingSections.length : 0;
    const cited = Array.isArray(data.citedEvidenceIds) ? data.citedEvidenceIds.length : 0;
    const uncited = Array.isArray(data.uncitedEvidenceIds) ? data.uncitedEvidenceIds.length : 0;
    return `结构缺失 ${missing} 项；引用 ${cited}/${cited + uncited}；校验 ${data.passed ? '通过' : '有警告'}`;
  }
  if (event.type === 'agent_report_repair') {
    const report = typeof data.report === 'string' ? data.report : '';
    const notes = Array.isArray(data.repairNotes) ? data.repairNotes.join('；') : '';
    return report ? `修复: ${notes || '-'}\n\n${report}` : notes || JSON.stringify(data);
  }
  if (event.type === 'agent_report_fallback') {
    const report = typeof data.report === 'string' ? data.report : '';
    return report
      ? `原因: ${String(data.reason || '模型正文不足，已用 evidence 生成草稿')}\n\n${report}`
      : String(data.reason || '模型正文不足，已用 evidence 生成草稿');
  }
  if (event.type === 'agent_report_final') {
    const report = typeof data.report === 'string' ? data.report : '';
    return `最终报告 ${String(data.length ?? report.length)} 字${data.repaired ? '；已自动修复' : ''}${data.fallbackUsed ? '；Evidence草稿' : ''}\n\n${report}`;
  }
  if (event.type === 'report_done') {
    const report = typeof data.report === 'string' ? data.report : '';
    const evidence = Array.isArray(data.evidence) ? data.evidence.length : 0;
    return `报告 ${report.length} 字；Evidence ${evidence} 条\n\n${report}`;
  }
  return JSON.stringify(data).slice(0, 1000);
}
