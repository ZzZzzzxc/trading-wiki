'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Brain, Search, BookOpen, CheckCheck, AlertCircle, FlaskConical } from 'lucide-react';
import { AppShell } from '@/components/layout';
import type { ResearchEvidenceItem, ResearchPlan, ResearchQualityAssessment, ResearchReportValidation, ResearchTaskCoverage } from '@/lib/ai/research-agent';

interface ResearchMessage {
  id: string;
  type: 'user' | 'agent_plan' | 'agent_tool_call' | 'agent_tool_result' | 'agent_evidence' | 'agent_coverage' | 'agent_research_summary' | 'agent_report_fallback' | 'agent_report_validation' | 'agent_quality' | 'agent_debate_result' | 'report_chunk' | 'report_done' | 'error';
  data: unknown;
  timestamp: number;
}

interface ResearchSummary {
  evidenceCount: number;
  minEvidence: number;
  coverageDone: number;
  coverageTotal: number;
  coverageRate: number;
  ragTraceIds: string[];
  insufficientQuestions: string[];
  citationCoverage: 'enough' | 'below_minimum';
}

export function ResearchWorkbench() {
  const [question, setQuestion] = useState('');
  const [depth, setDepth] = useState<'quick' | 'standard' | 'deep'>('standard');
  const [focus, setFocus] = useState<'comprehensive' | 'technical' | 'fundamental' | 'news'>('comprehensive');
  const [debate, setDebate] = useState(true);
  const [messages, setMessages] = useState<ResearchMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [currentReport, setCurrentReport] = useState('');
  const [plan, setPlan] = useState<ResearchPlan | null>(null);
  const [debateResult, setDebateResult] = useState<any>(null);
  const [coverage, setCoverage] = useState<ResearchTaskCoverage[]>([]);
  const [evidence, setEvidence] = useState<ResearchEvidenceItem[]>([]);
  const [researchSummary, setResearchSummary] = useState<ResearchSummary | null>(null);
  const [reportValidation, setReportValidation] = useState<ResearchReportValidation | null>(null);
  const [quality, setQuality] = useState<ResearchQualityAssessment | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, currentReport]);

  const handleSubmit = useCallback(async () => {
    if (!question.trim() || streaming) return;
    setStreaming(true);
    setMessages([]);
    setCurrentReport('');
    setPlan(null);
    setCoverage([]);
    setEvidence([]);
    setResearchSummary(null);
    setReportValidation(null);
    setQuality(null);
    setDebateResult(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/ai/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), depth, focus, debate }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error('请求失败');

      const reader = res.body?.getReader();
      if (!reader) throw new Error('无法读取响应');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(trimmed.slice(6));
            const msg: ResearchMessage = { id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), type: event.type, data: event.data, timestamp: Date.now() };

            if (event.type === 'agent_plan') {
              setPlan(event.data as ResearchPlan);
              setMessages(prev => [...prev, msg]);
            } else if (event.type === 'agent_tool_call' || event.type === 'agent_tool_result') {
              setMessages(prev => [...prev, msg]);
            } else if (event.type === 'agent_coverage') {
              const data = event.data as { coverageAll?: ResearchTaskCoverage[] };
              if (data.coverageAll) setCoverage(data.coverageAll);
            } else if (event.type === 'agent_evidence') {
              const data = event.data as { evidence?: ResearchEvidenceItem };
              if (data.evidence) {
                setEvidence(prev => {
                  if (prev.some(item => item.id === data.evidence!.id)) return prev;
                  return [...prev, data.evidence!];
                });
              }
            } else if (event.type === 'agent_research_summary') {
              setResearchSummary(event.data as ResearchSummary);
            } else if (event.type === 'agent_report_validation') {
              setReportValidation(event.data as ResearchReportValidation);
            } else if (event.type === 'agent_quality') {
              setQuality(event.data as ResearchQualityAssessment);
            } else if (event.type === 'report_chunk') {
              setCurrentReport((event.data as { content: string }).content);
            } else if (event.type === 'agent_debate_result') {
              setDebateResult(event.data);
              setMessages(prev => [...prev, msg]);
            } else if (event.type === 'report_done') {
              const data = event.data as { report?: string };
              if (data.report) setCurrentReport(data.report);
              setMessages(prev => [...prev, msg]);
              setStreaming(false);
            } else if (event.type === 'error') {
              setMessages(prev => [...prev, msg]);
              setStreaming(false);
            }
          } catch {}
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => [...prev, { id: Date.now().toString(36), type: 'error', data: { message: '研究中断' }, timestamp: Date.now() }]);
      }
      setStreaming(false);
    }
  }, [question, depth, focus, debate, streaming]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)', maxWidth: 960, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ padding: '16px 0 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <FlaskConical size={20} />
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>深度研究</h2>
              <span className="type-badge type-badge-viewpoint" style={{ fontSize: 10 }}>Agent</span>
            </div>
            <span className="text-muted" style={{ fontSize: 12 }}>多步工具调用 · 交叉验证 · 深度报告</span>
          </div>
        </div>
        {/* 配置面板 */}
        <div style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>深度:</span>
              {(['quick', 'standard', 'deep'] as const).map(d => (
                <button key={d} onClick={() => setDepth(d)} type="button"
                  className={depth === d ? 'primary-button' : 'ghost-button'}
                  style={{ fontSize: 12, padding: '6px 12px' }}>
                  {d === 'quick' ? '⚡快速' : d === 'standard' ? '📊标准' : '🔬深度'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>聚焦:</span>
              {([
                { value: 'comprehensive' as const, label: '全面' },
                { value: 'technical' as const, label: '技术' },
                { value: 'fundamental' as const, label: '基本面' },
                { value: 'news' as const, label: '消息' },
              ].map(f => (
                <button key={f.value} onClick={() => setFocus(f.value)} type="button"
                  className={focus === f.value ? 'primary-button' : 'ghost-button'}
                  style={{ fontSize: 12, padding: '6px 12px' }}>
                  {f.label}
                </button>
              )))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={debate} onChange={e => setDebate(e.target.checked)}
                style={{ accentColor: 'var(--accent)' }} />
              多视角辩论
            </label>
          </div>
        </div>
      </div>

      {/* Agent 对话区 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* 研究方案 */}
        {plan && (
          <div className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Brain size={16} style={{ color: 'var(--accent)' }} />
              <strong style={{ fontSize: 14 }}>研究方案</strong>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{plan.title}</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {plan.subQuestions.map((q, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--muted)' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>{i + 1}.</span>
                  <span>{q}</span>
                  {coverage[i] && (
                    <span style={{
                      marginLeft: 'auto',
                      flexShrink: 0,
                      fontSize: 11,
                      color: coverage[i].status === 'insufficient' ? '#e09090' : coverage[i].status === 'pending' ? 'var(--muted)' : '#6ed19f',
                    }}>
                      {coverageStatusLabel(coverage[i].status)}
                      {coverage[i].evidenceIds.length ? ` · ${coverage[i].evidenceIds.length}` : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {(researchSummary || evidence.length > 0) && (
          <div className="glass-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <CheckCheck size={15} style={{ color: '#6ed19f' }} />
              <strong style={{ fontSize: 13 }}>证据账本</strong>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: 'var(--muted)' }}>
              {quality && <span style={{ color: quality.score >= 70 ? '#6ed19f' : quality.score >= 55 ? '#d4b16a' : '#e09090' }}>质量: {quality.grade} · {quality.score}</span>}
              <span>Evidence: {researchSummary?.evidenceCount ?? evidence.length}{researchSummary ? ` / ${researchSummary.minEvidence}` : ''}</span>
              {researchSummary && <span>Coverage: {researchSummary.coverageDone}/{researchSummary.coverageTotal}</span>}
              {researchSummary && <span>引用覆盖: {researchSummary.citationCoverage === 'enough' ? '达标' : '不足'}</span>}
              {reportValidation && <span>报告引用: {reportValidation.citedEvidenceIds.length}/{reportValidation.citedEvidenceIds.length + reportValidation.uncitedEvidenceIds.length}</span>}
              {reportValidation && <span>结构: {reportValidation.missingSections.length ? `缺 ${reportValidation.missingSections.length}` : '完整'}</span>}
              {reportValidation?.fallbackUsed && <span>Evidence草稿</span>}
              {reportValidation?.repaired && <span>已自动补齐结构</span>}
              {researchSummary?.ragTraceIds?.length ? <span>RAG traces: {researchSummary.ragTraceIds.length}</span> : null}
            </div>
            {researchSummary?.insufficientQuestions?.length ? (
              <div style={{ marginTop: 8, fontSize: 12, color: '#e09090' }}>
                证据不足: {researchSummary.insufficientQuestions.slice(0, 2).join('；')}
                {researchSummary.insufficientQuestions.length > 2 ? ` 等 ${researchSummary.insufficientQuestions.length} 项` : ''}
              </div>
            ) : null}
            {quality?.reasons?.length ? (
              <div style={{ marginTop: 8, fontSize: 12, color: '#d4b16a' }}>
                质量原因: {quality.reasons.slice(0, 2).join('；')}
                {quality.reasons.length > 2 ? ` 等 ${quality.reasons.length} 项` : ''}
              </div>
            ) : null}
            {quality?.blockers?.length ? (
              <div style={{ marginTop: 8, fontSize: 12, color: '#e09090' }}>
                阻断项: {quality.blockers.slice(0, 2).join('；')}
                {quality.blockers.length > 2 ? ` 等 ${quality.blockers.length} 项` : ''}
              </div>
            ) : null}
            {reportValidation?.warnings?.length ? (
              <div style={{ marginTop: 8, fontSize: 12, color: '#d4b16a' }}>
                报告校验: {reportValidation.warnings.slice(0, 2).join('；')}
                {reportValidation.warnings.length > 2 ? ` 等 ${reportValidation.warnings.length} 项` : ''}
              </div>
            ) : null}
            {reportValidation?.repairNotes?.length ? (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                自动修复: {reportValidation.repairNotes.slice(0, 2).join('；')}
                {reportValidation.repairNotes.length > 2 ? ` 等 ${reportValidation.repairNotes.length} 项` : ''}
              </div>
            ) : null}
            {reportValidation?.fallbackUsed ? (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                回退生成: {reportValidation.fallbackReason || '模型正文不足，已使用Evidence生成草稿'}
              </div>
            ) : null}
          </div>
        )}

        {/* 工具调用过程 — 增强版 */}
        {messages.filter(m => m.type === 'agent_tool_call' || m.type === 'agent_tool_result').map(msg => {
          const isCall = msg.type === 'agent_tool_call';
          if (isCall) {
            const data = msg.data as { tool: string; input?: Record<string, unknown>; args?: Record<string, unknown> };
            const tool = data.tool;
            const params = data.input ?? data.args ?? {};
            const paramSummary = Object.entries(params).map(([k, v]) =>
              `${k}=${typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40)}`
            ).join(', ');
            const iconColor = tool.includes('search') ? '#7eb8ff'
              : tool.includes('read_document') ? '#c084fc'
              : tool.includes('get_facts') ? '#6ed19f'
              : '#b0c4d8';
            return (
              <div key={msg.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'rgba(15,23,34,0.6)' }}>
                <Search size={14} style={{ color: iconColor, flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13 }}>
                  <span style={{ color: iconColor, fontWeight: 500 }}>{tool}</span>
                  {paramSummary && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{paramSummary}</span>}
                </div>
              </div>
            );
          } else {
            const data = msg.data as { summary: string };
            return (
              <div key={msg.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'rgba(15,23,34,0.6)' }}>
                <CheckCheck size={14} style={{ color: '#6ed19f', flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {data.summary}
                </div>
              </div>
            );
          }
        })}

        {/* Agent 思考中 */}
        {streaming && !currentReport && !plan && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, fontSize: 13, color: 'var(--muted)' }}>
            <span className="thinking-dot" />
            正在分析...
          </div>
        )}

        {/* 多视角辩论结果 */}
        {debateResult && (() => {
          const dr = debateResult as any;
          const rounds = dr.rounds || [];
          const neutral = dr.neutral || null;
          return (
            <div className="glass-card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Brain size={16} style={{ color: 'var(--accent)' }} />
                <strong style={{ fontSize: 14 }}>多视角辩论（{rounds.length} 轮）</strong>
              </div>
              {rounds.map((r: any, ri: number) => (
                <div key={ri} style={{ marginBottom: ri < rounds.length - 1 ? 16 : 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, fontWeight: 600 }}>第 {ri + 1} 轮</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                    {r.bull && (
                      <div style={{ border: '1px solid rgba(111,210,169,0.2)', borderRadius: 12, padding: 14, background: 'rgba(15,23,34,0.6)' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#6ed19f' }}>📈 乐观视角</div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{r.bull.title}</div>
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                          {(r.bull.points || []).map((pt: string, i: number) => <li key={i}>{pt}</li>)}
                        </ul>
                        <div style={{ fontSize: 12, marginTop: 8, color: 'var(--text)', lineHeight: 1.6 }}>{r.bull.conclusion}</div>
                      </div>
                    )}
                    {r.bear && (
                      <div style={{ border: '1px solid rgba(224,144,144,0.2)', borderRadius: 12, padding: 14, background: 'rgba(15,23,34,0.6)' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#e09090' }}>📉 悲观视角</div>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{r.bear.title}</div>
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                          {(r.bear.points || []).map((pt: string, i: number) => <li key={i}>{pt}</li>)}
                        </ul>
                        <div style={{ fontSize: 12, marginTop: 8, color: 'var(--text)', lineHeight: 1.6 }}>{r.bear.conclusion}</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {neutral && (
                <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'rgba(15,23,34,0.6)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#b0c4d8' }}>⚖️ 平衡判断</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{neutral.title}</div>
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'rgba(15,23,34,0.6)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#b0c4d8' }}>🔑 关键验证变量</div>
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                        {(neutral.keyVariables || []).map((v: string, i: number) => <li key={i}>{v}</li>)}
                      </ul>
                    </div>
                  </div>
                  {(neutral.consensus?.length > 0 || neutral.disagreements?.length > 0) && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 12 }}>
                      {neutral.consensus?.length > 0 && (
                        <div style={{ border: '1px solid rgba(111,210,169,0.2)', borderRadius: 12, padding: 14, background: 'rgba(15,23,34,0.6)' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#6ed19f' }}>✅ 共识点</div>
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                            {(neutral.consensus || []).map((v: string, i: number) => <li key={i}>{v}</li>)}
                          </ul>
                        </div>
                      )}
                      {neutral.disagreements?.length > 0 && (
                        <div style={{ border: '1px solid rgba(224,144,144,0.2)', borderRadius: 12, padding: 14, background: 'rgba(15,23,34,0.6)' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#e09090' }}>⚠️ 核心分歧</div>
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                            {(neutral.disagreements || []).map((v: string, i: number) => <li key={i}>{v}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Streaming 报告 */}
        {currentReport && (
          <div className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <BookOpen size={14} style={{ color: 'var(--accent)' }} />
              <strong style={{ fontSize: 13 }}>研究报告</strong>
              {researchSummary && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {researchSummary.evidenceCount} 条证据 · 覆盖 {researchSummary.coverageDone}/{researchSummary.coverageTotal}
                </span>
              )}
              {reportValidation && (
                <span style={{ fontSize: 11, color: reportValidation.passed ? '#6ed19f' : '#d4b16a' }}>
                  校验{reportValidation.passed ? '通过' : '有警告'}
                </span>
              )}
              {quality && (
                <span style={{ fontSize: 11, color: quality.score >= 70 ? '#6ed19f' : quality.score >= 55 ? '#d4b16a' : '#e09090' }}>
                  质量 {quality.grade}
                </span>
              )}
              {streaming && <span className="thinking-cursor" />}
            </div>
            <div className="markdown-body" style={{ fontSize: 14, lineHeight: 1.8 }}
              dangerouslySetInnerHTML={{ __html: renderResearchMarkdown(currentReport) }} />
          </div>
        )}

        {/* 错误 */}
        {messages.filter(m => m.type === 'error').map(msg => (
          <div key={msg.id} className="status-message status-error" style={{ fontSize: 13 }}>
            <AlertCircle size={14} style={{ marginRight: 6 }} />
            {(msg.data as { message: string }).message}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* 输入区 */}
      <div style={{ flexShrink: 0, padding: '12px 0 20px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="输入研究问题，如「光纤光缆行业的投资价值分析」"
            disabled={streaming}
            style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 16, background: 'rgba(7,12,20,0.88)', color: 'var(--text)', font: 'inherit', fontSize: 14, padding: '12px 16px', resize: 'none', lineHeight: 1.5, minHeight: 44, maxHeight: 120 }}
          />
          <button className="primary-button" onClick={handleSubmit} disabled={!question.trim() || streaming} type="button"
            style={{ padding: '12px 16px', borderRadius: 14, height: 44 }}>
            <Send size={16} />
          </button>
        </div>
        <div className="text-muted" style={{ fontSize: 11, marginTop: 6, textAlign: 'center' }}>
          Agent 会自动搜索知识库、阅读文档、查询断言，生成深度研究报告
        </div>
      </div>
    </div>
  );
}

function coverageStatusLabel(status: ResearchTaskCoverage['status']): string {
  if (status === 'pending') return '待检索';
  if (status === 'searching') return '检索中';
  if (status === 'evidence_found') return '已获证据';
  if (status === 'summarized') return '已总结';
  return '证据不足';
}

function renderResearchMarkdown(text: string): string {
  // 简单的 Markdown 转 HTML
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul class="md-list">$&</ul>')
    .replace(/\n\n/g, '</p><p class="md-paragraph">')
    .replace(/^(.+)$/gm, function(m: string) {
      if (m.startsWith('<')) return m;
      if (!m.trim()) return '';
      return '<p class="md-paragraph">' + m + '</p>';
    });
  return '<div>' + html + '</div>';
}
