'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHero } from '@/components/documents/page-hero';
import { MarkdownPreview } from '@/components/documents/markdown-preview';
import { AppShell } from '@/components/layout';
import { parseLines } from '@/lib/utils/strings';
import { useToast } from '@/components/toast';

interface SaveResponse {
  ok: boolean;
  data?: {
    id: string;
    path: string;
  };
  error?: unknown;
}

export default function NewNotePage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [themesText, setThemesText] = useState('');
  const [stocksText, setStocksText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { showToast } = useToast();

  useEffect(() => { document.title = '新建笔记 - A 股投研助手'; }, []);

  async function handleSave() {
    if (!title.trim()) {
      setError('标题不能为空。');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'note',
          title: title.trim(),
          date: date || undefined,
          themes: parseLines(themesText),
          stocks: parseLines(stocksText),
          tags: parseLines(tagsText),
          content,
        }),
      });
      const payload = (await response.json()) as SaveResponse;

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : '保存笔记失败，请稍后重试。',
        );
      }

      showToast('笔记已保存', 'success');
      router.push(`/notes/${payload.data.id}`);
      router.refresh();
    } catch (saveError) {
      const msg = saveError instanceof Error
        ? saveError.message
        : '保存笔记失败，请稍后重试。';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell currentPath="/notes">
      <div className="page-stack-fluid">
        <PageHero
          title="新建笔记"
          description="直接编写 Markdown 笔记，支持主题、个股和标签归档。"
        />
        <div className="section-grid columns-2">
          <section className="glass-card form-card">
            <div className="form-section-title">笔记信息</div>
            <label className="form-field">
              <span>标题</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="笔记标题"
              />
            </label>
            <label className="form-field">
              <span>日期</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>主题，每行一个</span>
              <textarea
                rows={3}
                value={themesText}
                onChange={(event) => setThemesText(event.target.value)}
                placeholder="半导体设备&#10;AI算力"
              />
            </label>
            <label className="form-field">
              <span>个股，每行一个</span>
              <textarea
                rows={3}
                value={stocksText}
                onChange={(event) => setStocksText(event.target.value)}
                placeholder="300604&#10;000988"
              />
            </label>
            <label className="form-field">
              <span>标签，每行一个</span>
              <textarea
                rows={3}
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="周度观察&#10;半导体设备"
              />
            </label>

            <div className="form-section-title">Markdown 正文</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                className="primary-button"
                style={{
                  padding: '6px 14px',
                  fontSize: 13,
                  background: !showPreview ? 'rgba(212, 177, 106, 0.16)' : 'rgba(143, 164, 194, 0.06)',
                  borderColor: !showPreview ? 'rgba(212, 177, 106, 0.24)' : 'var(--border)',
                }}
                onClick={() => setShowPreview(false)}
              >
                编辑
              </button>
              <button
                type="button"
                className="primary-button"
                style={{
                  padding: '6px 14px',
                  fontSize: 13,
                  background: showPreview ? 'rgba(212, 177, 106, 0.16)' : 'rgba(143, 164, 194, 0.06)',
                  borderColor: showPreview ? 'rgba(212, 177, 106, 0.24)' : 'var(--border)',
                }}
                onClick={() => setShowPreview(true)}
              >
                预览
              </button>
            </div>

            {showPreview ? (
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  background: 'rgba(7, 12, 20, 0.88)',
                  padding: '16px 18px',
                  minHeight: 300,
                  maxHeight: 500,
                  overflowY: 'auto',
                }}
              >
                {content.trim() ? (
                  <MarkdownPreview content={content} />
                ) : (
                  <span className="text-muted">在编辑标签中输入内容后，在此预览渲染效果。</span>
                )}
              </div>
            ) : (
              <textarea
                rows={20}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="在此编写 Markdown 正文..."
                style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.7 }}
              />
            )}

            {message ? <div className="status-message status-success">{message}</div> : null}
            {error ? <div className="status-message status-error">{error}</div> : null}

            <div className="form-actions">
              <button
                className="primary-button"
                disabled={!title.trim() || saving}
                onClick={handleSave}
                type="button"
              >
                {saving ? '保存中...' : '保存为 Markdown'}
              </button>
            </div>
          </section>

          {/* 始终可见的预览面板 */}
          <section className="glass-card form-card">
            <div className="form-section-title">实时预览</div>
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 14,
                background: 'rgba(7, 12, 20, 0.88)',
                padding: '20px 22px',
                minHeight: 520,
                maxHeight: 'calc(100vh - 280px)',
                overflowY: 'auto',
              }}
            >
              {content.trim() ? (
                <MarkdownPreview content={content} />
              ) : (
                <div className="empty-state" style={{ minHeight: 300 }}>
                  <span className="text-muted">左侧输入 Markdown 内容后，此处实时展示渲染效果。</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
