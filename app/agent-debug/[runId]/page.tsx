'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { ArrowLeft, Clock, CheckCircle, XCircle, AlertCircle, Search, FileText, MessageSquare, Brain, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown } from 'lucide-react';

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
                <span>工具调用: {toolCalls.length} 次</span>
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
                      {stepToolCalls.length > 0 && (
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: 6, color: '#6ed19f' }}>工具调用</div>
                          {stepToolCalls.map((tc, j) => (
                            <div key={j} style={{ background: 'rgba(15,23,34,0.6)', borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 11 }}>
                              <div style={{ fontSize: 11, wordBreak: 'break-all' }}><span style={{ color: '#7eb8ff' }}>{tc.toolName}</span> {tc.args ? JSON.stringify(tc.args) : ''}</div>
                            </div>
                          ))}
                        </div>
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
