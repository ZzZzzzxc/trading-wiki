'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ThemeResearchResult } from '@/lib/types/theme';
import type { DocumentIndexItem } from '@/lib/types/document';
import { useStreamAI } from '@/lib/hooks/use-stream-ai';
import { ThinkingPanel } from '@/components/thinking-panel';
import { getDocumentTypeBadgeClass, getDocumentTypeLabel } from '@/lib/utils/display';
import { useToast } from '@/components/toast';
import {
  parseLines,
  stringifyLines,
  parseSourcedLines,
  stringifySourcedLines,
  stringifyValueChainLayers,
  parseValueChainLayers,
  stringifyEvidenceTable,
  parseEvidenceTable,
  stringifyScorecard,
  parseScorecard,
} from '@/lib/utils/strings';

interface SaveResponse {
  ok: boolean;
  data?: { id: string; path: string };
  error?: unknown;
}

const emptyResult: ThemeResearchResult = {
  title: '',
  industry_chain_position: '',
  capital_flow: '',
  physical_flow: '',
  profit_flow: '',
  upstream: [],
  midstream: [],
  downstream: [],
  bottlenecks: [],
  core_companies: [],
  catalysts: [],
  risks: [],
  personal_judgment: '',
  verifiable_claims: [],
  value_chain_layers: [],
  evidence_table: [],
  failure_conditions: [],
  next_steps: [],
  scorecard: undefined,
};

interface ThemeWorkbenchProps {
  editDocId?: string;
  initialThemeName?: string;
  initialObservation?: string;
  /** 可用素材列表（从服务端传入） */
  materials?: DocumentIndexItem[];
}

export function ThemeWorkbench(props: ThemeWorkbenchProps = {}) {
  const isEdit = !!props.editDocId;
  const { materials = [] } = props;
  const router = useRouter();
  const [themeName, setThemeName] = useState(props.initialThemeName || '');
  const [personalObservation, setPersonalObservation] = useState(props.initialObservation || '');
  const [result, setResult] = useState<ThemeResearchResult>(emptyResult);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { showToast } = useToast();

  const {
    thinking,
    streaming,
    result: streamResult,
    error: streamError,
    startStream,
  } = useStreamAI<ThemeResearchResult>();

  useEffect(() => {
    if (streamResult) {
      setResult(streamResult);
      setMessage('AI 生成完成，当前结果可继续编辑后再保存。');
      showToast('AI 产业链研究生成完成', 'success');
    }
  }, [streamResult]);

  useEffect(() => {
    if (streamError) setError(streamError);
  }, [streamError]);

  // 素材匹配
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [showAllMaterials, setShowAllMaterials] = useState(false);
  const hasUserToggledMaterial = useRef(false);

  const themeTokens = useMemo(
    () => themeName.split(/[,，\s]+/).filter(Boolean).map((t) => t.toLowerCase()),
    [themeName],
  );

  const matchedMaterials = useMemo(() => {
    if (!materials.length) return [];
    if (!themeTokens.length) return materials.slice(0, 10);
    return materials
      .map((m) => {
        let score = 0;
        for (const token of themeTokens) {
          if (m.title.toLowerCase().includes(token)) score += 3;
          for (const ts of m.themes) {
            if (ts.toLowerCase().includes(token) || token.includes(ts.toLowerCase())) score += 2;
          }
        }
        return { item: m, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.item);
  }, [materials, themeTokens]);

  // 自动全选：仅首次匹配时触发，用户手动操作后不再覆盖
  useEffect(() => {
    if (matchedMaterials.length > 0 && !hasUserToggledMaterial.current) {
      setSelectedMaterialIds(matchedMaterials.map((m) => m.id));
    }
  }, [matchedMaterials]);

  function toggleMaterial(id: string) {
    hasUserToggledMaterial.current = true;
    setSelectedMaterialIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
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
    () => themeName.trim() && selectedMaterials.length > 0,
    [themeName, selectedMaterials],
  );

  async function handleGenerate() {
    setError('');
    setMessage('');

    const materialContext = selectedMaterials.map((m, i) =>
      `[素材:${m.id}:${m.type}] ${m.title}（${getDocumentTypeLabel(m.type)} · ${m.date ?? '未知日期'}）\n${m.summary}`
    ).join('\n\n');

    await startStream('generate-theme-research', {
      themeName,
      rawMaterials: materialContext,
      personalObservation,
    });
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setMessage('');

    // 构建引用素材摘要
    const materialContext = selectedMaterials.map((m, i) =>
      `[素材:${m.id}:${m.type}] ${m.title}（${getDocumentTypeLabel(m.type)} · ${m.date ?? '未知日期'}）\n${m.summary}`
    ).join('\n\n');

    try {
      const body = isEdit
        ? { id: props.editDocId, type: 'theme_research', themeName, rawMaterials: materialContext, personalObservation, generation: result }
        : { type: 'theme_research', themeName, rawMaterials: materialContext, personalObservation, generation: result };

      const response = await fetch('/api/documents', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as SaveResponse;

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(typeof payload.error === 'string' ? payload.error : '保存失败');
      }

      showToast('产业链研究已保存', 'success');
      router.push(`/themes/${payload.data.id}`);
      router.refresh();
    } catch (saveError) {
      const msg = saveError instanceof Error ? saveError.message : '保存失败';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="section-grid columns-3">
      <section className="glass-card form-card">
        <div className="form-section-title">研究输入</div>

        <label className="form-field">
          <span>主题名称</span>
          <input
            value={themeName}
            onChange={(event) => setThemeName(event.target.value)}
            placeholder="例如: AI算力、半导体设备、先进封装"
          />
        </label>

        {/* 匹配素材 */}
        {materials.length > 0 ? (
          <div className="form-field">
            <span>
              引用素材
              {matchedMaterials.length
                ? `（${selectedMaterials.length}/${matchedMaterials.length} 条已选）`
                : themeTokens.length ? '（未匹配到相关素材）' : '（输入主题名称后自动匹配）'}
            </span>
            {matchedMaterials.length > 0 ? (
              <div className="checkbox-list">
                {displayMaterials.map((m) => (
                  <label key={m.id} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectedMaterialIds.includes(m.id)}
                      onChange={() => toggleMaterial(m.id)}
                    />
                    <span>
                      <strong>{m.title}</strong>
                      <span className={getDocumentTypeBadgeClass('material')} style={{ fontSize: 10, marginLeft: 6 }}>
                        {m.evidence_level ? `${m.evidence_level}级` : '素材'}
                      </span>
                      <br />
                      <span className="text-muted">
                        {m.date ?? '未知日期'}
                        {m.stocks.length ? ` · ${m.stocks.slice(0, 3).join(', ')}` : ''}
                        {m.themes.length ? ` · ${m.themes.slice(0, 3).join(', ')}` : ''}
                      </span>
                      <br />
                      <span className="text-muted">{m.summary.slice(0, 120)}</span>
                    </span>
                  </label>
                ))}
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

        <label className="form-field">
          <span>个人观察</span>
          <textarea
            rows={6}
            value={personalObservation}
            onChange={(event) => setPersonalObservation(event.target.value)}
            placeholder="个人的产业判断、疑问和验证点"
          />
        </label>

        <div className="form-actions">
          <button
            className="primary-button"
            disabled={!canGenerate || streaming}
            onClick={handleGenerate}
            type="button"
          >
            {streaming ? '生成中...' : 'AI 生成研究'}
          </button>
          {!canGenerate && themeName.trim() && (
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>请至少选择一条素材</div>
          )}
        </div>
      </section>

      <ThinkingPanel
        content={thinking}
        streaming={streaming}
        label="主题研究思考过程"
        className="workbench-sticky-thinking"
      />

      <section className="glass-card form-card">
        <div className="form-section-title">结构化结果</div>

        {/* 现有字段 */}
        <label className="form-field">
          <span>产业链位置</span>
          <textarea rows={3} value={result.industry_chain_position}
            onChange={(e) => setResult((c) => ({ ...c, industry_chain_position: e.target.value }))} />
        </label>
        <label className="form-field">
          <span>资金流</span>
          <textarea rows={3} value={result.capital_flow}
            onChange={(e) => setResult((c) => ({ ...c, capital_flow: e.target.value }))} />
        </label>
        <label className="form-field">
          <span>实物流</span>
          <textarea rows={3} value={result.physical_flow}
            onChange={(e) => setResult((c) => ({ ...c, physical_flow: e.target.value }))} />
        </label>
        <label className="form-field">
          <span>利润流</span>
          <textarea rows={3} value={result.profit_flow}
            onChange={(e) => setResult((c) => ({ ...c, profit_flow: e.target.value }))} />
        </label>
        <label className="form-field">
          <span>上游，每行一个</span>
          <textarea rows={3} value={stringifyLines(result.upstream)}
            onChange={(e) => setResult((c) => ({ ...c, upstream: parseLines(e.target.value) }))} />
        </label>
        <label className="form-field">
          <span>中游，每行一个</span>
          <textarea rows={3} value={stringifyLines(result.midstream)}
            onChange={(e) => setResult((c) => ({ ...c, midstream: parseLines(e.target.value) }))} />
        </label>
        <label className="form-field">
          <span>下游，每行一个</span>
          <textarea rows={3} value={stringifyLines(result.downstream)}
            onChange={(e) => setResult((c) => ({ ...c, downstream: parseLines(e.target.value) }))} />
        </label>
        <label className="form-field">
          <span>当前卡点，每行一个</span>
          <textarea rows={3} value={stringifySourcedLines(result.bottlenecks)}
            onChange={(e) => setResult((c) => ({ ...c, bottlenecks: parseSourcedLines(e.target.value) }))} />
        </label>
        <label className="form-field">
          <span>核心公司，每行一个</span>
          <textarea rows={3} value={stringifyLines(result.core_companies)}
            onChange={(e) => setResult((c) => ({ ...c, core_companies: parseLines(e.target.value) }))} />
        </label>
        <label className="form-field">
          <span>催化日历，每行一个</span>
          <textarea rows={3} value={stringifySourcedLines(result.catalysts)}
            onChange={(e) => setResult((c) => ({ ...c, catalysts: parseSourcedLines(e.target.value) }))} />
        </label>
        <label className="form-field">
          <span>风险传导，每行一个</span>
          <textarea rows={3} value={stringifySourcedLines(result.risks)}
            onChange={(e) => setResult((c) => ({ ...c, risks: parseSourcedLines(e.target.value) }))} />
        </label>

        {/* ===== 新增折叠面板（AI 生成后有内容时自动展开） ===== */}
        <details
          style={{ marginTop: 16 }}
          open={(result.value_chain_layers?.length ?? 0) > 0}
        >
          <summary className="form-section-title" style={{ cursor: 'pointer' }}>🔗 价值链全图</summary>
          <div style={{ marginTop: 8 }}>
            <label className="form-field">
              <span>每层用 ## 层名 分隔，依次为：层名、描述、公司、卡点</span>
              <textarea rows={6} value={stringifyValueChainLayers(result.value_chain_layers ?? [])}
                onChange={(e) => setResult((c) => ({ ...c, value_chain_layers: parseValueChainLayers(e.target.value) }))}
                style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </label>
          </div>
        </details>

        <details
          style={{ marginTop: 8 }}
          open={(result.evidence_table?.length ?? 0) > 0}
        >
          <summary className="form-section-title" style={{ cursor: 'pointer' }}>📋 证据表</summary>
          <div style={{ marginTop: 8 }}>
            <label className="form-field">
              <span>每条一行：声明 [strong/medium/weak] | 支持依据 | 需核: 待核查内容</span>
              <textarea rows={5} value={stringifyEvidenceTable(result.evidence_table ?? [])}
                onChange={(e) => setResult((c) => ({ ...c, evidence_table: parseEvidenceTable(e.target.value) }))}
                style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </label>
          </div>
        </details>

        <details
          style={{ marginTop: 8 }}
          open={(result.failure_conditions?.length ?? 0) > 0}
        >
          <summary className="form-section-title" style={{ cursor: 'pointer' }}>⚠️ 证伪条件</summary>
          <div style={{ marginTop: 8 }}>
            <label className="form-field">
              <span>每行一个：哪些情况说明这个判断错了</span>
              <textarea rows={4} value={stringifyLines(result.failure_conditions ?? [])}
                onChange={(e) => setResult((c) => ({ ...c, failure_conditions: parseLines(e.target.value) }))} />
            </label>
          </div>
        </details>

        <details
          style={{ marginTop: 8 }}
          open={(result.next_steps?.length ?? 0) > 0}
        >
          <summary className="form-section-title" style={{ cursor: 'pointer' }}>📌 下一步研究</summary>
          <div style={{ marginTop: 8 }}>
            <label className="form-field">
              <span>每行一个：下一步验证行动</span>
              <textarea rows={4} value={stringifyLines(result.next_steps ?? [])}
                onChange={(e) => setResult((c) => ({ ...c, next_steps: parseLines(e.target.value) }))} />
            </label>
          </div>
        </details>

        <details
          style={{ marginTop: 8 }}
          open={!!result.scorecard}
        >
          <summary className="form-section-title" style={{ cursor: 'pointer' }}>📊 评分卡</summary>
          <div style={{ marginTop: 8 }}>
            <label className="form-field">
              <span>格式：--- 正面因素 --- 和 --- 负面因素 --- 分隔，每行：因子 | 说明 | 权重</span>
              <textarea rows={5} value={stringifyScorecard(result.scorecard)}
                onChange={(e) => setResult((c) => ({ ...c, scorecard: parseScorecard(e.target.value) }))}
                style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </label>
          </div>
        </details>

        <label className="form-field" style={{ marginTop: 12 }}>
          <span>个人判断</span>
          <textarea rows={4} value={result.personal_judgment}
            onChange={(e) => setResult((c) => ({ ...c, personal_judgment: e.target.value }))} />
        </label>

        {message ? <div className="status-message status-success">{message}</div> : null}
        {error ? <div className="status-message status-error">{error}</div> : null}

        <div className="form-actions">
          <button className="primary-button" disabled={!themeName.trim() || saving}
            onClick={handleSave} type="button">
            {saving ? '保存中...' : '保存为 Markdown'}
          </button>
        </div>
      </section>
    </div>
  );
}
