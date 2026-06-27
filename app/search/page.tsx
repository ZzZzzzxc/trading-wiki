'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { DocumentType } from '@/lib/types/document';
import type { RagSearchHit } from '@/lib/rag/types';
import { getDocumentTypeBadgeClass, getDocumentTypeLabel, docTypePriority, DOC_TYPE_OPTIONS } from '@/lib/utils/display';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';

/** 文档类型 → 详情页 URL 前缀 */
const docTypeUrlMap: Record<string, string> = {
  material: '/materials',
  viewpoint: '/viewpoints',
  daily_review: '/reviews',
  theme_research: '/themes',
  stock_profile: '/stocks',
  note: '/notes',
};

/** 按文档类型分组展示搜索结果 */
function GroupedSearchResults({ results }: { results: RagSearchHit[] }) {
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null);

  const grouped = results.reduce(
    (acc, item) => {
      const key = item.chunk.docType;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    },
    {} as Record<string, RagSearchHit[]>,
  );

  const sortedGroups = Object.entries(grouped).sort(
    (a, b) => (docTypePriority[a[0]] ?? 99) - (docTypePriority[b[0]] ?? 99),
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {sortedGroups.map(([docType, items]) => (
        <div key={docType}>
          <div className="rag-group-header">
            <span className={`type-badge ${getDocumentTypeBadgeClass(docType)}`}>
              {getDocumentTypeLabel(docType as never)}
            </span>
            <span className="rag-group-count">{items.length} 条</span>
          </div>
          <div className="checkbox-list">
            {items.map((item) => {
              const detailUrl = docTypeUrlMap[item.chunk.docType]
                ? `${docTypeUrlMap[item.chunk.docType]}/${encodeURIComponent(item.chunk.docId)}`
                : null;
              const isExpanded = expandedChunk === item.chunk.id;

              return (
                <article key={item.chunk.id} className="checkbox-item result-card">
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <strong>{item.chunk.title}</strong>
                      <span
                        className="tag"
                        style={{
                          backgroundColor:
                            (item.finalScore * 100) > 70
                              ? 'rgba(111, 210, 169, 0.15)'
                              : (item.finalScore * 100) > 40
                                ? 'rgba(212, 177, 106, 0.12)'
                                : 'rgba(143, 164, 194, 0.1)',
                        }}
                      >
                        相关性 {(item.finalScore * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="text-muted" style={{ marginBottom: 8 }}>
                      {(item.chunk.headingPath.length
                        ? item.chunk.headingPath.join(' > ')
                        : '正文') +
                        (item.chunk.date ? ` · ${item.chunk.date}` : '')}
                      {item.chunk.author ? ` · ${item.chunk.author}` : ''}
                    </div>
                    <p className="result-snippet" style={{ margin: '0 0 8px' }}>
                      {isExpanded ? item.chunk.content : item.chunk.content.slice(0, 300)}
                    </p>

                    {/* 展开/收起 */}
                    {item.chunk.content.length > 300 && (
                      <button
                        className="ghost-button"
                        onClick={() => setExpandedChunk(isExpanded ? null : item.chunk.id)}
                        type="button"
                        style={{ fontSize: 12, marginBottom: 8 }}
                      >
                        {isExpanded ? '收起' : `展开全文（共 ${item.chunk.content.length} 字）`}
                      </button>
                    )}

                    <div className="text-muted" style={{ fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span>文件: {item.chunk.docPath}</span>
                      {item.chunk.themes?.length
                        ? ` · 主题: ${item.chunk.themes.join(', ')}` : ''}
                      {item.chunk.stocks?.length
                        ? ` · 个股: ${item.chunk.stocks.join(', ')}` : ''}
                      {item.chunk.tags?.length
                        ? ` · 标签: ${item.chunk.tags.join(', ')}` : ''}
                      {detailUrl && (
                        <Link
                          href={detailUrl}
                          className="app-nav-link"
                          style={{ fontSize: 12, marginLeft: 'auto' }}
                          target="_blank"
                        >
                          查看原文 →
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

interface RagSearchResponse {
  ok: boolean;
  data?: RagSearchHit[];
  meta?: { intent?: string; rewrittenQuery?: string; entities?: unknown };
  error?: unknown;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [filterTheme, setFilterTheme] = useState('');
  const [filterStock, setFilterStock] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [useIntent, setUseIntent] = useState(true);
  const [results, setResults] = useState<RagSearchHit[]>([]);
  const [meta, setMeta] = useState<RagSearchResponse['meta'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => { document.title = '知识库搜索 - A 股投研助手'; }, []);

  function toggleDocType(type: DocumentType) {
    setDocTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  async function handleSearch() {
    if (!query.trim()) { setError('请输入检索词。'); return; }
    setLoading(true); setError(''); setSearched(true); setMeta(null);

    try {
      const response = await fetch('/api/rag/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          topK: 10,
          useIntent,
          docTypes: docTypes.length ? docTypes : undefined,
          themes: filterTheme.trim() ? filterTheme.split('\n').map(s => s.trim()).filter(Boolean) : undefined,
          stocks: filterStock.trim() ? filterStock.split('\n').map(s => s.trim()).filter(Boolean) : undefined,
          tags: filterTag.trim() ? filterTag.split('\n').map(s => s.trim()).filter(Boolean) : undefined,
          dateFrom: filterDateFrom || undefined,
          dateTo: filterDateTo || undefined,
        }),
      });
      const payload = (await response.json()) as RagSearchResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(typeof payload.error === 'string' ? payload.error : '检索失败');
      }
      setResults(payload.data);
      if (payload.meta) setMeta(payload.meta);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : '检索失败');
    } finally { setLoading(false); }
  }

  const hasAdvancedFilters = filterTheme || filterStock || filterTag || filterDateFrom || filterDateTo;

  return (
    <AppShell currentPath="/search">
      <div className="page-stack">
        <PageHero
          title="知识库搜索"
          description="在本地 Markdown 知识库中搜索历史复盘、观点、主题研究、个股档案和笔记。"
        />

        <section className="glass-card form-card">
          <div className="form-section-title">搜索条件</div>

          <label className="form-field">
            <span>检索词</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              placeholder="输入关键词，如「长川科技 上涨逻辑」「AI算力 产业链」"
            />
          </label>

          <div className="form-field">
            <span>文档类型（不选则搜索全部）</span>
            <div className="checkbox-list">
              {DOC_TYPE_OPTIONS.map((item) => (
                <label key={item.value} className="checkbox-item">
                  <input type="checkbox" checked={docTypes.includes(item.value)} onChange={() => toggleDocType(item.value)} />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 意图识别开关 */}
          <label className="checkbox-item" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={useIntent} onChange={() => setUseIntent((v) => !v)} />
            <span style={{ fontSize: 13 }}>
              启用意图识别
              <span className="text-muted" style={{ marginLeft: 4 }}>
                （开启后使用动态权重和实体扩展，搜索结果更精准）
              </span>
            </span>
          </label>

          {/* 高级筛选 */}
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 14, padding: '4px 0' }}>
              高级筛选{hasAdvancedFilters ? '（已设置）' : ''}
            </summary>
            <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
              <div className="inline-grid">
                <label className="form-field">
                  <span>主题过滤，每行一个</span>
                  <input value={filterTheme} onChange={(e) => setFilterTheme(e.target.value)} placeholder="AI算力" />
                </label>
                <label className="form-field">
                  <span>股票过滤，每行一个</span>
                  <input value={filterStock} onChange={(e) => setFilterStock(e.target.value)} placeholder="300604" />
                </label>
                <label className="form-field">
                  <span>标签过滤，每行一个</span>
                  <input value={filterTag} onChange={(e) => setFilterTag(e.target.value)} placeholder="产业链" />
                </label>
              </div>
              <div className="inline-grid">
                <label className="form-field">
                  <span>起始日期</span>
                  <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
                </label>
                <label className="form-field">
                  <span>结束日期</span>
                  <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
                </label>
              </div>
            </div>
          </details>

          {error ? <div className="status-message status-error">{error}</div> : null}

          <div className="form-actions">
            <button className="primary-button" disabled={loading || !query.trim()} onClick={handleSearch} type="button">
              {loading ? '搜索中...' : '搜索'}
            </button>
          </div>
        </section>

        {meta && (
          <section className="glass-card" style={{ padding: 12 }}>
            <div className="form-section-title" style={{ fontSize: 12 }}>检索信息</div>
            <div style={{ fontSize: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {meta.intent && <span className="meta-pill">意图: {meta.intent}</span>}
              {meta.rewrittenQuery && <span className="tag">改写: {meta.rewrittenQuery}</span>}
              {meta.entities ? <span className="tag">已识别实体</span> : null}
            </div>
          </section>
        )}

        {searched ? (
          <section className="glass-card">
            <div className="form-section-title">
              搜索结果
              {results.length ? (
                <span className="text-muted" style={{ marginLeft: 12, fontSize: 14, fontWeight: 400 }}>
                  共 {results.length} 条
                </span>
              ) : null}
            </div>
            {results.length ? (
              <GroupedSearchResults results={results} />
            ) : (
              <div className="empty-state">
                <strong>未找到匹配结果</strong>
                <span className="text-muted">请尝试调整检索词、放宽文档类型过滤条件或调整高级筛选。</span>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
