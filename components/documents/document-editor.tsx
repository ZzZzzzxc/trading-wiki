'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DocumentFrontmatter } from '@/lib/types/document';
import { parseLines } from '@/lib/utils/strings';
import { useToast } from '@/components/toast';
import { useUnsavedChangesWarning } from '@/lib/hooks/use-unsaved-changes';

interface FrontmatterFieldOption {
  value: string;
  label: string;
}

interface FrontmatterField {
  key: string;
  label: string;
  value: string;
  type?: 'text' | 'textarea' | 'select';
  options?: FrontmatterFieldOption[];
}

interface DocumentEditorProps {
  documentId: string;
  documentType: string;
  initialFrontmatter: DocumentFrontmatter;
  initialContent: string;
  /** 额外的 frontmatter 编辑字段 */
  frontmatterFields?: FrontmatterField[];
}

interface ApiResponse {
  ok: boolean;
  data?: { id: string; path: string };
  error?: unknown;
}

export function DocumentEditor({
  documentId,
  documentType,
  initialFrontmatter,
  initialContent,
  frontmatterFields = [],
}: DocumentEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialFrontmatter.title ?? '');
  const [date, setDate] = useState(initialFrontmatter.date ?? '');
  const [themes, setThemes] = useState(
    (initialFrontmatter.themes ?? []).join('\n'),
  );
  const [stocks, setStocks] = useState(
    (initialFrontmatter.stocks ?? []).join('\n'),
  );
  const [tags, setTags] = useState(
    (initialFrontmatter.tags ?? []).join('\n'),
  );
  const [content, setContent] = useState(initialContent);

  // Track editable frontmatter field values (3b)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(frontmatterFields.map((f) => [f.key, f.value])),
  );

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Dirty state for unsaved changes protection (3a)
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesWarning(dirty);

  const { showToast } = useToast();

  function handleFieldChange(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const body: Record<string, unknown> = {
        id: documentId,
        type: documentType,
        title,
        date: date || undefined,
        themes: parseLines(themes),
        stocks: parseLines(stocks),
        tags: parseLines(tags),
        content: content.trim(),
        // type-specific frontmatter fields: use edited value or fall back to initial
        author: fieldValues['author'] ?? initialFrontmatter.author,
        platform: fieldValues['platform'] ?? initialFrontmatter.platform,
        stance: fieldValues['stance'] ?? initialFrontmatter.stance,
        time_horizon:
          fieldValues['time_horizon'] ?? initialFrontmatter.time_horizon,
        confidence:
          fieldValues['confidence'] ?? initialFrontmatter.confidence,
        market_phase:
          fieldValues['market_phase'] ?? initialFrontmatter.market_phase,
        stock_code:
          fieldValues['stock_code'] ?? initialFrontmatter.stock_code,
        mentioned_stocks: initialFrontmatter.mentioned_stocks,
        mentioned_themes: initialFrontmatter.mentioned_themes,
        core_stocks: initialFrontmatter.core_stocks,
        source: fieldValues['source'] ?? initialFrontmatter.source,
        rawText: undefined,
        extraction: undefined,
        generation: undefined,
        rawMaterials: undefined,
        personalObservation: undefined,
        selectedViewpoints: undefined,
        ragContext: undefined,
        marketSummary: undefined,
        sectorPerformance: undefined,
        newsCatalysts: undefined,
        companyInfo: undefined,
        announcements: undefined,
        news: undefined,
        viewpointSummary: undefined,
        stockName: undefined,
        themeName: undefined,
      };

      const response = await fetch('/api/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as ApiResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(
          typeof payload.error === 'string' ? payload.error : '更新失败',
        );
      }

      setMessage('文档已更新');
      setDirty(false);
      showToast('文档已更新', 'success');
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新失败';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch('/api/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: documentId }),
      });
      const payload = (await response.json()) as ApiResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(
          typeof payload.error === 'string' ? payload.error : '删除失败',
        );
      }

      showToast('文档已删除', 'success');

      // 根据类型跳转回列表页
      const listRoutes: Record<string, string> = {
        viewpoint: '/viewpoints',
        daily_review: '/reviews',
        theme_research: '/themes',
        stock_profile: '/stocks',
        note: '/notes',
      };
      router.push(listRoutes[documentType] ?? '/dashboard');
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      setError(msg);
      showToast(msg, 'error');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  return (
    <section className="glass-card form-card">
      <div className="form-section-title">编辑文档</div>

      <label className="form-field">
        <span>标题</span>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
        />
      </label>

      <div className="inline-grid">
        <label className="form-field">
          <span>日期</span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        {frontmatterFields.map((field) => (
          <label key={field.key} className="form-field">
            <span>{field.label}</span>
            {field.key === 'type' ? (
              // type 字段始终只读
              <input value={field.value} readOnly />
            ) : field.type === 'select' && field.options ? (
              <select
                value={fieldValues[field.key] ?? field.value}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
              >
                {field.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'textarea' ? (
              <textarea
                rows={2}
                value={fieldValues[field.key] ?? field.value}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
              />
            ) : (
              <input
                value={fieldValues[field.key] ?? field.value}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>

      <label className="form-field">
        <span>主题，每行一个</span>
        <textarea
          rows={2}
          value={themes}
          onChange={(e) => {
            setThemes(e.target.value);
            setDirty(true);
          }}
        />
      </label>

      <label className="form-field">
        <span>相关股票，每行一个</span>
        <textarea
          rows={2}
          value={stocks}
          onChange={(e) => {
            setStocks(e.target.value);
            setDirty(true);
          }}
        />
      </label>

      <label className="form-field">
        <span>标签，每行一个</span>
        <textarea
          rows={2}
          value={tags}
          onChange={(e) => {
            setTags(e.target.value);
            setDirty(true);
          }}
        />
      </label>

      <label className="form-field">
        <span>Markdown 正文</span>
        <textarea
          rows={20}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.7 }}
        />
      </label>

      {message ? (
        <div className="status-message status-success">{message}</div>
      ) : null}
      {error ? (
        <div className="status-message status-error">{error}</div>
      ) : null}

      <div className="form-actions" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            className="primary-button"
            disabled={!title.trim() || saving}
            onClick={handleSave}
            type="button"
          >
            {saving ? '保存中...' : '保存修改'}
          </button>
        </div>

        {showDeleteConfirm ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              确认删除？
            </span>
            <button
              className="primary-button"
              style={{
                borderColor: 'rgba(255, 143, 143, 0.3)',
                background: 'rgba(255, 143, 143, 0.15)',
              }}
              disabled={deleting}
              onClick={handleDelete}
              type="button"
            >
              {deleting ? '删除中...' : '确认'}
            </button>
            <button
              className="primary-button"
              disabled={deleting}
              onClick={() => setShowDeleteConfirm(false)}
              type="button"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            className="primary-button"
            style={{
              borderColor: 'rgba(255, 143, 143, 0.2)',
              background: 'rgba(255, 143, 143, 0.08)',
            }}
            onClick={() => setShowDeleteConfirm(true)}
            type="button"
          >
            删除文档
          </button>
        )}
      </div>
    </section>
  );
}
