'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout';
import { PageHero } from '@/components/documents/page-hero';
import { CheckCircle, XCircle, Clock } from 'lucide-react';

export default function ComparePage() {
  const searchParams = useSearchParams();
  const r1 = searchParams.get('r1');
  const r2 = searchParams.get('r2');
  const [events1, setEvents1] = useState<any[]>([]);
  const [events2, setEvents2] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!r1 || !r2) return;
    Promise.all([
      fetch('/api/agent-debug/runs/' + r1).then(r => r.json()),
      fetch('/api/agent-debug/runs/' + r2).then(r => r.json()),
    ]).then(([d1, d2]) => {
      if (d1.ok) setEvents1(d1.data.events);
      if (d2.ok) setEvents2(d2.data.events);
    }).finally(() => setLoading(false));
  }, [r1, r2]);

  if (!r1 || !r2) return <AppShell currentPath="/agent-debug"><div className="page-stack"><div className="status-message status-error">缺少对比参数</div></div></AppShell>;

  const getStats = (events: any[]) => ({
    steps: events.filter(e => e.type === 'step_started').length,
    llmCalls: events.filter(e => e.type === 'llm_call').length,
    toolCalls: events.filter(e => e.type === 'tool_call').length,
    latency: events.find(e => e.type === 'run_finished')?.latencyMs || 0,
    status: events.find(e => e.type === 'run_finished')?.status || 'unknown',
    query: events.find(e => e.type === 'run_started')?.userQuery || '',
  });

  const s1 = getStats(events1);
  const s2 = getStats(events2);

  return (
    <AppShell currentPath="/agent-debug">
      <div className="page-stack">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <PageHero title="Run 对比" description="并排比较两次 Agent 执行" />
          <a href="/agent-debug" style={{ fontSize: 12, color: 'var(--muted)' }}>← 返回列表</a>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>加载中...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[s1, s2].map((s, i) => (
              <div key={i} className="glass-card" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Run {i + 1}</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{s.query}</div>
                <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>状态</span>
                    <span>{s.status === 'success' ? '✅ 成功' : s.status === 'failed' ? '❌ 失败' : '⏳ 运行中'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>耗时</span>
                    <span>{(s.latency / 1000).toFixed(1)}s</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>LLM 调用</span>
                    <span>{s.llmCalls} 次</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)' }}>工具调用</span>
                    <span>{s.toolCalls} 次</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Step 时间线对比 */}
        {!loading && events1.length > 0 && (
          <div className="glass-card" style={{ padding: 16 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Step 对比</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {[events1, events2].map((events, idx) => (
                <div key={idx}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Run {idx + 1}</div>
                  {events.filter(e => e.type === 'step_started').map((step, i) => {
                    const finished = events.find(e => e.type === 'step_finished' && e.stepId === step.stepId);
                    const latMs = finished?.latencyMs || 0;
                    const status = finished?.status || 'running';
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                        {status === 'success' ? <CheckCircle size={12} style={{ color: '#6ed19f' }} /> : status === 'failed' ? <XCircle size={12} style={{ color: '#e09090' }} /> : <Clock size={12} style={{ color: '#b0c4d8' }} />}
                        <span style={{ flex: 1 }}>{step.name}</span>
                        <span style={{ color: 'var(--muted)' }}>{latMs > 1000 ? (latMs / 1000).toFixed(1) + 's' : latMs + 'ms'}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
