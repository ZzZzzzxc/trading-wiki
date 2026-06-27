'use client';

import { useEffect, useState } from 'react';
import type { VerifiableFact, FactState, FactWindow } from '@/lib/types/fact';
import { factStateLabels } from '@/lib/types/fact';
import { parseLines } from '@/lib/utils/strings';
import { useToast } from '@/components/toast';
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog';

function getSourceHref(docType: string, docId: string): string {
  const typePathMap: Record<string, string> = {
    viewpoint: '/viewpoints',
    daily_review: '/reviews',
    theme_research: '/themes',
    stock_profile: '/stocks',
    note: '/notes',
  };
  return `${typePathMap[docType] ?? '/dashboard'}/${docId}`;
}

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: unknown;
}

const defaultWindows = (): FactWindow[] => {
  const now = new Date();
  return [
    { label: '1日', days: 1 },
    { label: '3日', days: 3 },
    { label: '5日', days: 5 },
    { label: '10日', days: 10 },
    { label: '20日', days: 20 },
    { label: '30日', days: 30 },
    { label: '90日', days: 90 },
    { label: '180日', days: 180 },
  ].map((w) => {
    const due = new Date(now);
    due.setDate(due.getDate() + w.days);
    return {
      label: w.label,
      dueDate: due.toISOString().slice(0, 10),
      result: null as FactState | null,
      note: '',
    };
  });
};

export function FactWorkbench() {
  const [facts, setFacts] = useState<VerifiableFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  // 新增表单
  const [claim, setClaim] = useState('');
  const [stocksText, setStocksText] = useState('');
  const [themesText, setThemesText] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // 筛选
  const [filter, setFilter] = useState('');

  // 编辑中的窗口
  const [editingWindows, setEditingWindows] = useState<Record<string, FactWindow[]>>({});

  // 正在操作中的断言 ID（用于禁用按钮）
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // 删除确认对话框
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // 按 claim / stocks / themes 筛选
  const filteredFacts = filter.trim()
    ? facts.filter((f) =>
        f.claim.toLowerCase().includes(filter.toLowerCase()) ||
        f.stocks.some((s) => s.toLowerCase().includes(filter.toLowerCase())) ||
        f.themes.some((t) => t.toLowerCase().includes(filter.toLowerCase())),
      )
    : facts;

  useEffect(() => {
    loadFacts();
  }, []);

  async function loadFacts() {
    setLoading(true);
    try {
      const res = await fetch('/api/facts');
      const payload = (await res.json()) as ApiResponse<VerifiableFact[]>;
      if (payload.ok && payload.data) {
        setFacts(payload.data);
      }
    } catch {
      setError('加载断言失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!claim.trim()) return;
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/facts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim: claim.trim(),
          stocks: parseLines(stocksText),
          themes: parseLines(themesText),
          notes: notes.trim(),
        }),
      });
      const payload = (await res.json()) as ApiResponse<VerifiableFact>;
      if (!res.ok || !payload.ok) throw new Error('创建失败');

      setClaim('');
      setStocksText('');
      setThemesText('');
      setNotes('');
      showToast('断言已创建', 'success');
      await loadFacts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建失败';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateState(id: string, state: FactState) {
    setUpdatingId(id);
    try {
      const res = await fetch('/api/facts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, state }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) throw new Error('更新失败');
      showToast('状态已更新', 'success');
      await loadFacts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新失败';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleUpdateWindows(id: string) {
    const windows = editingWindows[id];
    if (!windows) return;
    setUpdatingId(id);
    try {
      const res = await fetch('/api/facts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, windows }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) throw new Error('更新失败');
      const newEditing = { ...editingWindows };
      delete newEditing[id];
      setEditingWindows(newEditing);
      showToast('验证结果已保存', 'success');
      await loadFacts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新失败';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDelete(id: string) {
    setUpdatingId(id);
    try {
      const res = await fetch('/api/facts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) throw new Error('删除失败');
      showToast('断言已删除', 'success');
      await loadFacts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setUpdatingId(null);
      setDeleteConfirmId(null);
    }
  }

  function startEditWindows(fact: VerifiableFact) {
    setEditingWindows((prev) => ({
      ...prev,
      [fact.id]: fact.windows.length > 0
        ? fact.windows.map((w) => ({ ...w }))
        : defaultWindows(),
    }));
  }

  const stateBadgeColors: Record<string, string> = {
    pending: 'type-badge-note',
    confirmed: 'type-badge-stock',
    falsified: 'type-badge-raw',
    insufficient: 'type-badge-note',
  };

  const stats = {
    total: facts.length,
    pending: facts.filter((f) => f.state === 'pending').length,
    confirmed: facts.filter((f) => f.state === 'confirmed').length,
    falsified: facts.filter((f) => f.state === 'falsified').length,
  };

  return (
    <div className="section-grid columns-2">
      {/* 新建断言 */}
      <section className="glass-card form-card">
        <div className="form-section-title">新建可验证断言</div>
        <label className="form-field">
          <span>断言内容</span>
          <textarea
            rows={3}
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            placeholder="如：长川科技预计Q3量产新一代测试设备"
          />
        </label>
        <label className="form-field">
          <span>相关股票，每行一个</span>
          <input
            value={stocksText}
            onChange={(e) => setStocksText(e.target.value)}
            placeholder="300604"
          />
        </label>
        <label className="form-field">
          <span>相关主题，每行一个</span>
          <input
            value={themesText}
            onChange={(e) => setThemesText(e.target.value)}
            placeholder="半导体设备"
          />
        </label>
        <label className="form-field">
          <span>备注</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="断言来源、背景信息等"
          />
        </label>

        {error ? <div className="status-message status-error">{error}</div> : null}

        <div className="form-actions">
          <button
            className="primary-button"
            disabled={!claim.trim() || saving}
            onClick={handleCreate}
            type="button"
          >
            {saving ? '创建中...' : '创建断言'}
          </button>
        </div>
      </section>

      {/* 统计面板 */}
      <section className="glass-card form-card">
        <div className="form-section-title">验证统计</div>
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="stat-card">
            <span className="stat-card-label">全部断言</span>
            <span className="stat-card-value" style={{ fontSize: 24 }}>{stats.total}</span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label">待验证</span>
            <span className="stat-card-value" style={{ fontSize: 24, color: 'var(--muted)' }}>{stats.pending}</span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label">已确认</span>
            <span className="stat-card-value" style={{ fontSize: 24, color: '#8cd8b0' }}>{stats.confirmed}</span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label">已证伪</span>
            <span className="stat-card-value" style={{ fontSize: 24, color: '#e09090' }}>{stats.falsified}</span>
          </div>
        </div>

        {/* 准确率进度条 */}
        {stats.total > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              已完成验证的准确率: {stats.confirmed + stats.falsified > 0
                ? Math.round(stats.confirmed / (stats.confirmed + stats.falsified) * 100)
                : 0}%
            </div>
            <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: 'rgba(143,164,194,0.08)' }}>
              {stats.confirmed > 0 ? (
                <div style={{ width: `${(stats.confirmed / stats.total) * 100}%`, background: '#8cd8b0', transition: 'width 400ms' }} />
              ) : null}
              {stats.falsified > 0 ? (
                <div style={{ width: `${(stats.falsified / stats.total) * 100}%`, background: '#e09090' }} />
              ) : null}
              {stats.pending > 0 ? (
                <div style={{ width: `${(stats.pending / stats.total) * 100}%`, background: 'rgba(143,164,194,0.2)' }} />
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>
              <span>🟢 确认 {stats.confirmed}</span>
              <span>🔴 证伪 {stats.falsified}</span>
              <span>⚪ 待验证 {stats.pending}</span>
            </div>
          </div>
        ) : null}

        {loading ? <div className="text-muted">加载中...</div> : null}
      </section>

      {/* 断言列表 */}
      <section className="glass-card" style={{ gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div className="form-section-title" style={{ margin: 0 }}>
            断言列表（{facts.length} 条）
          </div>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索断言内容 / 股票 / 主题..."
            style={{
              flex: 1, minWidth: 200, maxWidth: 320,
              border: '1px solid var(--border)', borderRadius: 10,
              background: 'rgba(7, 12, 20, 0.88)', color: 'var(--text)',
              font: 'inherit', fontSize: 13, padding: '6px 12px',
            }}
          />
          {filter.trim() && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              筛选结果: {filteredFacts.length} / {facts.length}
            </span>
          )}
        </div>

        {loading ? (
          <div className="text-muted">加载中...</div>
        ) : filteredFacts.length ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {filteredFacts.map((fact) => (
              <article
                key={fact.id}
                className="checkbox-item result-card"
                style={{ alignItems: 'stretch' }}
              >
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontSize: 15 }}>{fact.claim}</strong>
                      <div className="text-muted" style={{ marginTop: 4 }}>
                        创建: {fact.createdAt.slice(0, 10)}
                        {fact.stocks.length ? ` · 股票: ${fact.stocks.join(', ')}` : ''}
                        {fact.themes.length ? ` · 主题: ${fact.themes.join(', ')}` : ''}
                        {fact.sourceDocId ? (
                          <span>
                            {' · 来源: '}
                            <a
                              href={getSourceHref(fact.sourceDocType, fact.sourceDocId)}
                              style={{ color: '#7eb8ff', textDecoration: 'underline' }}
                            >
                              {fact.sourceTitle || fact.sourceDocId}
                            </a>
                          </span>
                        ) : null}
                        {fact.notes && !fact.sourceDocId ? ` · 备注: ${fact.notes}` : null}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className={`type-badge ${stateBadgeColors[fact.state]}`}>
                        {factStateLabels[fact.state]}
                      </span>
                      <select
                        value={fact.state}
                        onChange={(e) => handleUpdateState(fact.id, e.target.value as FactState)}
                        disabled={updatingId === fact.id}
                        style={{
                          fontSize: 12,
                          padding: '4px 8px',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          background: 'rgba(7, 12, 20, 0.88)',
                          color: 'var(--text)',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="pending">待验证</option>
                        <option value="confirmed">已确认</option>
                        <option value="falsified">已证伪</option>
                        <option value="insufficient">证据不足</option>
                      </select>
                    </div>
                  </div>

                  {/* 多窗口验证 */}
                  <div style={{ marginTop: 10 }}>
                    {editingWindows[fact.id] ? (
                      <div style={{ display: 'grid', gap: 8 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {editingWindows[fact.id].map((w, i) => (
                            <div
                              key={w.label}
                              style={{
                                border: '1px solid var(--border)',
                                borderRadius: 10,
                                padding: '8px 12px',
                                fontSize: 12,
                                minWidth: 100,
                              }}
                            >
                              <div style={{ fontWeight: 600, marginBottom: 4 }}>{w.label} ({w.dueDate})</div>
                              <select
                                value={w.result ?? ''}
                                onChange={(e) => {
                                  const updated = [...editingWindows[fact.id]];
                                  updated[i] = { ...updated[i], result: (e.target.value || null) as FactState | null };
                                  setEditingWindows({ ...editingWindows, [fact.id]: updated });
                                }}
                                style={{
                                  width: '100%',
                                  fontSize: 11,
                                  padding: '2px 6px',
                                  border: '1px solid var(--border)',
                                  borderRadius: 4,
                                  background: 'rgba(7, 12, 20, 0.88)',
                                  color: 'var(--text)',
                                  marginBottom: 4,
                                }}
                              >
                                <option value="">未验证</option>
                                <option value="confirmed">✅ 确认</option>
                                <option value="falsified">❌ 证伪</option>
                                <option value="insufficient">❓ 不足</option>
                              </select>
                              <input
                                placeholder="备注"
                                value={w.note}
                                onChange={(e) => {
                                  const updated = [...editingWindows[fact.id]];
                                  updated[i] = { ...updated[i], note: e.target.value };
                                  setEditingWindows({ ...editingWindows, [fact.id]: updated });
                                }}
                                style={{
                                  width: '100%',
                                  fontSize: 11,
                                  padding: '2px 6px',
                                  border: '1px solid var(--border)',
                                  borderRadius: 4,
                                  background: 'rgba(7, 12, 20, 0.88)',
                                  color: 'var(--text)',
                                }}
                              />
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="primary-button"
                            style={{ fontSize: 12, padding: '4px 12px' }}
                            disabled={updatingId === fact.id}
                            onClick={() => handleUpdateWindows(fact.id)}
                            type="button"
                          >
                            {updatingId === fact.id ? '保存中...' : '保存验证'}
                          </button>
                          <button
                            className="primary-button"
                            style={{
                              fontSize: 12,
                              padding: '4px 12px',
                              background: 'rgba(143, 164, 194, 0.06)',
                            }}
                            disabled={updatingId === fact.id}
                            onClick={() => {
                              const newEditing = { ...editingWindows };
                              delete newEditing[fact.id];
                              setEditingWindows(newEditing);
                            }}
                            type="button"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                        {fact.windows.length > 0 ? (
                          <div className="quick-actions">
                            {fact.windows.map((w) => (
                              <span key={w.label} className="meta-pill" style={{ fontSize: 11 }}>
                                {w.label}: {w.result ? factStateLabels[w.result as FactState] : '—'}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <button
                          className="primary-button"
                          style={{
                            fontSize: 11,
                            padding: '3px 10px',
                            background: 'rgba(143, 164, 194, 0.06)',
                          }}
                          disabled={updatingId === fact.id}
                          onClick={() => startEditWindows(fact)}
                          type="button"
                        >
                          多窗口验证
                        </button>
                        <button
                          className="primary-button"
                          style={{
                            fontSize: 11,
                            padding: '3px 10px',
                            background: 'rgba(255, 143, 143, 0.06)',
                            borderColor: 'rgba(255, 143, 143, 0.15)',
                          }}
                          disabled={updatingId === deleteConfirmId}
                          onClick={() => setDeleteConfirmId(fact.id)}
                          type="button"
                        >
                          {updatingId === deleteConfirmId ? '删除中...' : '删除'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state" style={{ minHeight: 120 }}>
            <strong>还没有断言</strong>
            <span className="text-muted">在左侧创建第一条可验证断言，跟踪预测准确性。</span>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteConfirmId !== null}
        title="确认删除"
        message="确认删除该断言？此操作不可恢复。"
        variant="danger"
        confirmLabel="删除"
        loading={updatingId === deleteConfirmId}
        onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
}
