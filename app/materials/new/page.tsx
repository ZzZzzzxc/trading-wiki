'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHero } from '@/components/documents/page-hero';
import { MarkdownPreview } from '@/components/documents/markdown-preview';
import { AppShell } from '@/components/layout';
import { FileUpload } from '@/components/documents/file-upload';
import { materialTypes, materialTypeLabels } from '@/lib/types/material';
import { evidenceLevels, evidenceLevelLabels } from '@/lib/types/fact';
import { useToast } from '@/components/toast';

interface SaveResponse {
  ok: boolean;
  data?: { id: string; path: string };
  error?: unknown;
}

export default function NewMaterialPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [materialType, setMaterialType] = useState<string>('news');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [stocksText, setStocksText] = useState('');
  const [themesText, setThemesText] = useState('');
  const [evidenceLevel, setEvidenceLevel] = useState<string>('C');
  const [sourceUrl, setSourceUrl] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { showToast } = useToast();

  useEffect(() => { document.title = '新建素材 - A 股投研助手'; }, []);

  async function handleExtract() {
    if (!content.trim()) { setError('请先填写素材内容再提取'); return; }
    setExtracting(true);
    setError('');
    try {
      const res = await fetch('/api/ai/extract-material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() }),
      });
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || '提取失败');
      const { title: t, stocks, themes, materialType: mt, evidenceLevel: el } = payload.data;
      if (t) setTitle(t);
      if (stocks?.length) setStocksText(stocks.join('\n'));
      if (themes?.length) setThemesText(themes.join('\n'));
      if (mt) setMaterialType(mt);
      if (el) setEvidenceLevel(el);
      setMessage('AI 提取完成，请核对信息后保存。');
      showToast('AI 提取完成', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : '提取失败');
    } finally {
      setExtracting(false);
    }
  }

  async function handleSave() {
    setError('');
    setMessage('');
    if (!title.trim()) { setError('请输入素材标题'); return; }
    if (!content.trim()) { setError('请输入素材内容'); return; }

    setSaving(true);
    try {
      const stocks = stocksText.split(/[,，\n]+/).map((s) => s.trim()).filter(Boolean);
      const themes = themesText.split(/[,，\n]+/).map((s) => s.trim()).filter(Boolean);

      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'material',
          title: title.trim(),
          date,
          stocks,
          themes,
          content: content.trim(),
          record: {
            materialType,
            stocks,
            themes,
            evidenceLevel,
            sourceUrl: sourceUrl.trim() || undefined,
          },
        }),
      });

      const payload = (await res.json()) as SaveResponse;
      if (!res.ok || !payload.ok || !payload.data) {
        throw new Error(typeof payload.error === 'string' ? payload.error : '保存素材失败');
      }
      showToast('素材已保存', 'success');
      router.push(`/materials/${payload.data.id}`);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存失败';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  // 生成实时预览的 Markdown
  const previewMd = [
    `# ${title.trim() || '素材标题'}`,
    '',
    '## 来源信息',
    '',
    `- 类型：${materialTypeLabels[materialType as keyof typeof materialTypeLabels] ?? materialType}`,
    `- 日期：${date}`,
    `- 证据强度：${evidenceLevel}级 — ${evidenceLevelLabels[evidenceLevel as keyof typeof evidenceLevelLabels] ?? evidenceLevel}`,
    sourceUrl.trim() ? `- 原始链接：${sourceUrl.trim()}` : '',
    '',
    '## 原始内容',
    '',
    content.trim() || '（在此粘贴素材内容）',
  ].join('\n');

  return (
    <AppShell currentPath="/materials">
      <div className="page-stack-fluid">
        <PageHero
          title="录入素材"
          description="素材创建后不可编辑，保护原始证据不被事后修改。公告、新闻、研报、公司资料均可录入，后续研究文档会自动匹配。"
        />

        <div className="section-grid columns-2">
          {/* 左栏：表单 */}
          <section className="glass-card form-card">
            <div className="form-section-title">素材信息</div>

            <label className="form-field">
              <span>标题</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="如：京东方与康宁签订玻璃基板备忘录"
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="form-field">
                <span>素材类型</span>
                <select value={materialType} onChange={(e) => setMaterialType(e.target.value)}>
                  {materialTypes.map((t) => (
                    <option key={t} value={t}>{materialTypeLabels[t]}</option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>证据强度</span>
                <select value={evidenceLevel} onChange={(e) => setEvidenceLevel(e.target.value)}>
                  {evidenceLevels.map((l) => (
                    <option key={l} value={l}>
                      {l}级 — {evidenceLevelLabels[l]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="form-field">
              <span>日期</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>

            <label className="form-field">
              <span>原始链接（可选）</span>
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
              />
            </label>

            <label className="form-field">
              <span>相关股票，每行一个</span>
              <textarea
                rows={3}
                value={stocksText}
                onChange={(e) => setStocksText(e.target.value)}
                placeholder="京东方&#10;TCL科技"
              />
            </label>

            <label className="form-field">
              <span>相关主题，每行一个</span>
              <textarea
                rows={3}
                value={themesText}
                onChange={(e) => setThemesText(e.target.value)}
                placeholder="玻璃基板&#10;显示面板"
              />
            </label>

            <div className="form-section-title">素材正文</div>

            <label className="form-field">
              <span>原始内容</span>
              <div style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className="primary-button"
                  style={{ padding: '6px 14px', fontSize: 12 }}
                  disabled={!content.trim() || extracting}
                  onClick={handleExtract}
                >
                  {extracting ? '提取中...' : '🤖 AI 提取标题、股票、主题、证据强度'}
                </button>
              </div>
              <textarea
                rows={14}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="粘贴公告原文、新闻内容、研报摘要..."
                style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.7 }}
              />
              <FileUpload
                onTextExtracted={(text) =>
                  setContent((prev) => (prev ? prev + '\n\n' + text : text))
                }
              />
            </label>

            {message ? <div className="status-message status-success">{message}</div> : null}
            {error ? <div className="status-message status-error">{error}</div> : null}

            <div className="form-actions">
              <button
                type="button"
                className="primary-button"
                disabled={!title.trim() || saving}
                onClick={handleSave}
              >
                {saving ? '保存中...' : '录入素材'}
              </button>
            </div>
          </section>

          {/* 右栏：实时预览 */}
          <section className="glass-card form-card">
            <div className="form-section-title">预览</div>
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
              {content.trim() || title.trim() ? (
                <MarkdownPreview content={previewMd} />
              ) : (
                <div className="empty-state" style={{ minHeight: 300 }}>
                  <span className="text-muted">
                    左侧填写素材信息后，此处实时展示保存后的渲染效果。
                  </span>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
