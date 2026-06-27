'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StockProfileResult } from '@/lib/types/stock';
import type { DocumentIndexItem } from '@/lib/types/document';
import { useStreamAI } from '@/lib/hooks/use-stream-ai';
import { ThinkingPanel } from '@/components/thinking-panel';
import { getDocumentTypeBadgeClass } from '@/lib/utils/display';
import { parseLines, stringifyLines, parseSourcedLines, stringifySourcedLines } from '@/lib/utils/strings';
import { useToast } from '@/components/toast';

interface SaveResponse {
  ok: boolean;
  data?: { id: string; path: string };
  error?: unknown;
}

interface ViewpointContextItem {
  id: string;
  title: string;
  summary: string;
  author?: string;
  date?: string;
  themes?: string[];
}

interface StockWorkbenchProps {
  /** 所有可用观点（从服务端获取，用于关联） */
  viewpoints?: ViewpointContextItem[];
  /** 可用素材列表（从服务端传入） */
  materials?: DocumentIndexItem[];
}

const emptyResult: StockProfileResult = {
  stock_name: '',
  main_business: '',
  industry_chain_position: '',
  core_upside_logic: '',
  historical_performance: '',
  viewpoint_summary: '',
  catalysts: [],
  valuation_anchor: '',
  risks: [],
  personal_judgment: '',
  follow_up_items: [],
  verifiable_claims: [],
};

interface StockEditData {
  editDocId?: string;
  initialName?: string;
  initialThemes?: string;
  initialObservation?: string;
  initialSelectedViewpointIds?: string[];
}

export function StockWorkbench({ viewpoints = [], materials = [], ...rest }: StockWorkbenchProps & StockEditData) {
  const isEdit = !!rest.editDocId;
  const router = useRouter();
  const [companyName, setCompanyName] = useState(rest.initialName || '');
  const [themes, setThemes] = useState(rest.initialThemes || '');
  const [personalObservation, setPersonalObservation] = useState(rest.initialObservation || '');
  const [result, setResult] = useState<StockProfileResult>(emptyResult);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { showToast } = useToast();

  // 观点关联
  const [selectedViewpointIds, setSelectedViewpointIds] = useState<string[]>(rest.initialSelectedViewpointIds || []);

  const {
    thinking,
    streaming,
    result: streamResult,
    error: streamError,
    startStream,
  } = useStreamAI<StockProfileResult>();

  useEffect(() => {
    if (streamResult) { setResult(streamResult); setMessage('AI 生成完成，当前结果可继续编辑后再保存。'); showToast('AI 个股档案生成完成', 'success'); }
  }, [streamResult]);

  useEffect(() => {
    if (streamError) setError(streamError);
  }, [streamError]);

  const themeList = useMemo(() => parseLines(themes), [themes]);

  // 观点匹配
  const matchedViewpoints = useMemo(() => {
    if ((!companyName.trim() && !themeList.length) || !viewpoints.length) return [];
    const q = companyName.trim().toLowerCase();
    return viewpoints
      .map((v) => {
        let score = 0;
        if (q && (v.title.toLowerCase().includes(q) || (v.summary && v.summary.toLowerCase().includes(q)))) score += 10;
        if (themeList.length && v.themes?.length) {
          score += v.themes.filter((vt) => themeList.some((t) => vt.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(vt.toLowerCase()))).length * 3;
        }
        return { ...v, score };
      })
      .filter((v) => v.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [companyName, viewpoints, themeList]);

  const selectedViewpoints = useMemo(
    () => matchedViewpoints.filter((v) => selectedViewpointIds.includes(v.id)),
    [matchedViewpoints, selectedViewpointIds],
  );

  function toggleViewpoint(id: string) {
    setSelectedViewpointIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  // 素材匹配
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [showAllMaterials, setShowAllMaterials] = useState(false);
  const hasUserToggledMaterial = useRef(false);

  const stockTokens = useMemo(
    () => [...companyName.split(/[,，\s]+/).filter(Boolean), ...themeList].map((t) => t.toLowerCase()),
    [companyName, themeList],
  );

  const matchedMaterials = useMemo(() => {
    if (!materials.length) return [];
    if (!stockTokens.length) return materials.slice(0, 10);
    return materials
      .map((m) => {
        let score = 0;
        for (const token of stockTokens) {
          if (m.title.toLowerCase().includes(token)) score += 3;
          for (const ms of m.stocks) {
            if (ms.toLowerCase().includes(token) || token.includes(ms.toLowerCase())) score += 2;
          }
          for (const mt of m.themes) {
            if (mt.toLowerCase().includes(token) || token.includes(mt.toLowerCase())) score += 2;
          }
        }
        return { item: m, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.item);
  }, [materials, stockTokens]);

  // 自动全选：仅首次匹配时触发，用户手动操作后不再覆盖
  useEffect(() => {
    if (matchedMaterials.length > 0 && !hasUserToggledMaterial.current) {
      setSelectedMaterialIds(matchedMaterials.map((m) => m.id));
    }
  }, [matchedMaterials]);

  function toggleMaterial(id: string) {
    hasUserToggledMaterial.current = true;
    setSelectedMaterialIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const selectedMaterials = useMemo(
    () => matchedMaterials.filter((m) => selectedMaterialIds.includes(m.id)),
    [matchedMaterials, selectedMaterialIds],
  );

  const displayMaterials = useMemo(
    () => showAllMaterials ? matchedMaterials : matchedMaterials.slice(0, 15),
    [matchedMaterials, showAllMaterials],
  );

  const canGenerate = useMemo(
    () => companyName.trim().length > 0 && selectedMaterials.length > 0,
    [companyName, selectedMaterials],
  );

  async function handleGenerate() {
    setError('');
    setMessage('');

    // 按 material_type 分发素材
    const parts = { company: [] as string[], announcement: [] as string[], news: [] as string[] };
    for (const m of selectedMaterials) {
      const tag = m.tags?.[1] || '';
      const entry = `[素材:${m.id}:${m.type}] ${m.title}（${m.date ?? '未知'}）\n${m.summary}`;
      if (tag === 'company_info') parts.company.push(entry);
      else if (tag === 'announcement') parts.announcement.push(entry);
      else parts.news.push(entry);
    }

    await startStream('generate-stock-profile', {
      stockName: companyName,
      themes: parseLines(themes),
      companyInfo: parts.company.join('\n\n'),
      announcements: parts.announcement.join('\n\n'),
      news: parts.news.join('\n\n'),
      personalObservation,
      selectedViewpoints,
    });
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setMessage('');

    const parts = { company: [] as string[], announcement: [] as string[], news: [] as string[] };
    for (const m of selectedMaterials) {
      const tag = m.tags?.[1] || '';
      const entry = `[素材:${m.id}:${m.type}] ${m.title}（${m.date ?? '未知'}）\n${m.summary}`;
      if (tag === 'company_info') parts.company.push(entry);
      else if (tag === 'announcement') parts.announcement.push(entry);
      else parts.news.push(entry);
    }

    try {
      const body = isEdit
        ? { id: rest.editDocId, type: 'stock_profile', stockName: companyName, themes: parseLines(themes), companyInfo: parts.company.join('\n\n'), announcements: parts.announcement.join('\n\n'), news: parts.news.join('\n\n'), personalObservation, selectedViewpoints, generation: result }
        : { type: 'stock_profile', stockName: companyName, themes: parseLines(themes), companyInfo: parts.company.join('\n\n'), announcements: parts.announcement.join('\n\n'), news: parts.news.join('\n\n'), personalObservation, selectedViewpoints, generation: result };

      const response = await fetch('/api/documents', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as SaveResponse;
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(typeof payload.error === 'string' ? payload.error : '保存个股档案失败');
      }
      showToast('个股档案已保存', 'success');
      router.push(`/stocks/${payload.data.id}`);
      router.refresh();
    } catch (saveError) {
      const msg = saveError instanceof Error ? saveError.message : '保存个股档案失败';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  const materialTypeLabel = (tag: string) =>
    ({ announcement: '公告', news: '新闻', research: '研报', company_info: '公司', other: '其他' })[tag] || '';

  return (
    <div className="section-grid columns-3">
      <section className="glass-card form-card">
        <div className="form-section-title">研究输入</div>

        <label className="form-field">
          <span>公司名称</span>
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="例如: 长川科技" />
        </label>

        <label className="form-field">
          <span>产业主题，每行一个</span>
          <input value={themes} onChange={(e) => setThemes(e.target.value)} placeholder="半导体设备、先进封装" />
        </label>

        {/* 匹配素材 */}
        {materials.length > 0 ? (
          <div className="form-field">
            <span>
              引用素材
              {matchedMaterials.length
                ? `（${selectedMaterials.length}/${matchedMaterials.length} 条已选）`
                : stockTokens.length ? '（未匹配到相关素材）' : '（输入公司名称或主题后自动匹配）'}
            </span>
            {matchedMaterials.length > 0 ? (
              <div className="checkbox-list">
                {displayMaterials.map((m) => {
                  const tag = m.tags?.[1] || '';
                  const tl = materialTypeLabel(tag);
                  return (
                    <label key={m.id} className="checkbox-item">
                      <input type="checkbox" checked={selectedMaterialIds.includes(m.id)} onChange={() => toggleMaterial(m.id)} />
                      <span>
                        <strong>{m.title}</strong>
                        {tl ? <span className="type-badge type-badge-stock" style={{ fontSize: 10, marginLeft: 6 }}>{tl}</span> : null}
                        {m.evidence_level ? <span className={getDocumentTypeBadgeClass('material')} style={{ fontSize: 10, marginLeft: 4 }}>{m.evidence_level}级</span> : null}
                        <br />
                        <span className="text-muted">{m.date ?? '未知日期'}{m.stocks.length ? ` · ${m.stocks.slice(0, 3).join(', ')}` : ''}</span>
                        <br />
                        <span className="text-muted">{m.summary.slice(0, 100)}</span>
                      </span>
                    </label>
                  );
                })}
                {matchedMaterials.length > 15 ? (
                  <button
                    className="ghost-button"
                    onClick={() => setShowAllMaterials((v) => !v)}
                    type="button"
                    style={{ marginTop: 6, fontSize: 12 }}
                  >
                    {showAllMaterials ? `收起（只展示 15 条）` : `展开全部（共 ${matchedMaterials.length} 条）`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
            素材库为空，可先去「素材库」录入公告、新闻、研报等原始资料。
          </div>
        )}

        {/* 关联观点 */}
        {viewpoints.length > 0 && companyName.trim() ? (
          <div className="form-field">
            <span>关联观点蒸馏结果{matchedViewpoints.length ? `（匹配到 ${matchedViewpoints.length} 条）` : '（未匹配到相关观点）'}</span>
            {matchedViewpoints.length > 0 ? (
              <div className="checkbox-list">
                {matchedViewpoints.map((v) => (
                  <label key={v.id} className="checkbox-item">
                    <input type="checkbox" checked={selectedViewpointIds.includes(v.id)} onChange={() => toggleViewpoint(v.id)} />
                    <span>
                      <strong>{v.title}</strong>
                      {(v as { score: number }).score >= 10
                        ? <span className="type-badge type-badge-stock" style={{ fontSize: 10, marginLeft: 6 }}>公司</span>
                        : <span className="type-badge type-badge-viewpoint" style={{ fontSize: 10, marginLeft: 6 }}>主题</span>}
                      <br />
                      <span className="text-muted">{v.author ?? '未知'} · {v.date ?? '未知'}</span>
                      <br />
                      <span className="text-muted">{v.summary.slice(0, 100)}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-muted" style={{ fontSize: 13 }}>
            {!viewpoints.length ? '暂无可用观点蒸馏数据。' : '输入公司名称后可自动匹配相关观点。'}
          </div>
        )}

        <label className="form-field">
          <span>个人观察</span>
          <textarea rows={3} value={personalObservation} onChange={(e) => setPersonalObservation(e.target.value)}
            placeholder="个人的判断和验证点" />
        </label>

        <div className="form-actions">
          <button className="primary-button" disabled={!canGenerate || streaming} onClick={handleGenerate} type="button">
            {streaming ? '生成中...' : 'AI 生成个股档案'}
          </button>
          {!canGenerate && companyName.trim() && (
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>请至少选择一条素材</div>
          )}
        </div>
      </section>

      <ThinkingPanel content={thinking} streaming={streaming} label="个股档案生成思考过程" className="workbench-sticky-thinking" />

      <section className="glass-card form-card">
        <div className="form-section-title">结构化结果</div>
        <label className="form-field"><span>公司主营</span>
          <textarea rows={3} value={result.main_business} onChange={(e) => setResult((c) => ({ ...c, main_business: e.target.value }))} />
        </label>
        <label className="form-field"><span>产业链位置</span>
          <textarea rows={3} value={result.industry_chain_position} onChange={(e) => setResult((c) => ({ ...c, industry_chain_position: e.target.value }))} />
        </label>
        <label className="form-field"><span>核心上涨逻辑</span>
          <textarea rows={3} value={result.core_upside_logic} onChange={(e) => setResult((c) => ({ ...c, core_upside_logic: e.target.value }))} />
        </label>
        <label className="form-field"><span>历史行情记录</span>
          <textarea rows={3} value={result.historical_performance} onChange={(e) => setResult((c) => ({ ...c, historical_performance: e.target.value }))} />
        </label>
        <label className="form-field"><span>关注人观点汇总（AI 生成）</span>
          <textarea rows={3} value={result.viewpoint_summary} onChange={(e) => setResult((c) => ({ ...c, viewpoint_summary: e.target.value }))} />
        </label>
        <label className="form-field"><span>催化事件，每行一个</span>
          <textarea rows={3} value={stringifySourcedLines(result.catalysts)} onChange={(e) => setResult((c) => ({ ...c, catalysts: parseSourcedLines(e.target.value) }))} />
        </label>
        <label className="form-field"><span>估值锚</span>
          <textarea rows={3} value={result.valuation_anchor} onChange={(e) => setResult((c) => ({ ...c, valuation_anchor: e.target.value }))} />
        </label>
        <label className="form-field"><span>风险点，每行一个</span>
          <textarea rows={3} value={stringifySourcedLines(result.risks)} onChange={(e) => setResult((c) => ({ ...c, risks: parseSourcedLines(e.target.value) }))} />
        </label>
        <label className="form-field"><span>个人判断</span>
          <textarea rows={3} value={result.personal_judgment} onChange={(e) => setResult((c) => ({ ...c, personal_judgment: e.target.value }))} />
        </label>
        <label className="form-field"><span>后续验证，每行一个</span>
          <textarea rows={3} value={stringifyLines(result.follow_up_items)} onChange={(e) => setResult((c) => ({ ...c, follow_up_items: parseLines(e.target.value) }))} />
        </label>

        {message ? <div className="status-message status-success">{message}</div> : null}
        {error ? <div className="status-message status-error">{error}</div> : null}

        <div className="form-actions">
          <button className="primary-button" disabled={!companyName.trim() || saving} onClick={handleSave} type="button">
            {saving ? '保存中...' : '保存为 Markdown'}
          </button>
        </div>
      </section>
    </div>
  );
}
