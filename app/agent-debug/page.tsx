'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout';
import { PageHero } from '@/components/documents/page-hero';
import { Bug, Clock, CheckCircle, XCircle, AlertCircle, ChevronRight } from 'lucide-react';
import Link from 'next/link';

interface RunSummary {
  runId: string;
  userQuery: string;
  status: string;
  startedAt: string;
  latencyMs?: number;
  config: { depth: string; focus: string; debate: boolean };
  steps: number;
  error?: { type: string; message: string };
}

export default function AgentDebugPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedRuns, setSelectedRuns] = useState<string[]>([]);

  function toggleRun(runId: string) {
    setSelectedRuns(prev =>
      prev.includes(runId) ? prev.filter(id => id !== runId) :
      prev.length < 2 ? [...prev, runId] : [runId]
    );
  }

  useEffect(() => {
    fetch('/api/agent-debug/runs')
      .then(r => r.json())
      .then(d => { if (d.ok) setRuns(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = runs.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (searchQuery && !r.userQuery?.includes(searchQuery)) return false;
    if (dateFrom && r.startedAt && r.startedAt.slice(0, 10) < dateFrom) return false;
    if (dateTo && r.startedAt && r.startedAt.slice(0, 10) > dateTo) return false;
    return true;
  });

  const statusIcon = (s: string) => {
    if (s === 'success') return <CheckCircle size={16} style={{ color: '#6ed19f' }} />;
    if (s === 'failed') return <XCircle size={16} style={{ color: '#e09090' }} />;
    return <Clock size={16} style={{ color: '#b0c4d8' }} />;
  };

  return (
    <AppShell currentPath="/agent-debug">
      <div className="page-stack">
        <PageHero
          title="Agent 调试"
          description="查看 Agent 研究的完整执行链路、耗时、错误和 LLM 调用记录。"
        />

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {['all', 'success', 'failed'].map(f => (
            <button key={f} onClick={() => setFilter(f)} type="button"
              className={filter === f ? 'primary-button' : 'ghost-button'}
              style={{ fontSize: 12, padding: '6px 12px' }}>
              {f === 'all' ? '全部' : f === 'success' ? '成功' : '失败'}
            </button>
          ))}
        </div>

        <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          placeholder="搜索问题关键词..."
          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(7,12,20,0.88)', color: 'var(--text)', font: 'inherit', fontSize: 13, padding: '10px 14px', marginBottom: 8 }}
        />

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(7,12,20,0.88)', color: 'var(--text)', font: 'inherit', fontSize: 12, padding: '8px 12px' }}
          />
          <span style={{ color: 'var(--muted)', alignSelf: 'center' }}>至</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 10, background: 'rgba(7,12,20,0.88)', color: 'var(--text)', font: 'inherit', fontSize: 12, padding: '8px 12px' }}
          />
        </div>

        {filter !== 'all' || searchQuery || dateFrom || dateTo ? (
          <button onClick={() => { setFilter('all'); setSearchQuery(''); setDateFrom(''); setDateTo(''); }}
            className="ghost-button" style={{ fontSize: 12, padding: '6px 12px', marginBottom: 8 }}>
            清除筛选
          </button>
        ) : null}

        {selectedRuns.length === 2 && (
          <Link href={`/agent-debug/compare?r1=${selectedRuns[0]}&r2=${selectedRuns[1]}`}
            className="primary-button" style={{ fontSize: 12, padding: '6px 12px', textDecoration: 'none', marginBottom: 8, display: 'inline-block' }}>
            📊 对比选中的 2 次执行
          </Link>
        )}

        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>加载中...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
            <Bug size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontWeight: 600, fontSize: 15 }}>暂无 Agent 执行记录</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>前往 /research 进行一次深度研究，执行记录将自动显示在此。</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {filtered.map(run => (
              <div key={run.runId} className="document-row" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input type="checkbox" checked={selectedRuns.includes(run.runId)}
                  onChange={() => toggleRun(run.runId)}
                  style={{ accentColor: 'var(--accent)', width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                />
                <Link href={`/agent-debug/${run.runId}`}
                  style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  {statusIcon(run.status)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{run.userQuery}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      {run.startedAt?.slice(0, 16).replace('T', ' ')}
                      {run.latencyMs ? ` · ${(run.latencyMs / 1000).toFixed(0)}s` : ''}
                      {run.steps ? ` · ${run.steps} 步` : ''}
                      {run.error && <span style={{ color: '#e09090', marginLeft: 8 }}>❌ {run.error.message.slice(0, 40)}</span>}
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
