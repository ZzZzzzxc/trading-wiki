'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  DailyReviewGenerationResult,
  ReviewContextItem,
  ReviewRagContextItem,
} from '@/lib/types/review';
import { getDocumentTypeBadgeClass, getDocumentTypeLabel, docTypePriority } from '@/lib/utils/display';
import { useStreamAI } from '@/lib/hooks/use-stream-ai';
import { ThinkingPanel } from '@/components/thinking-panel';
import { parseLines, stringifyLines, parseSourcedLines, stringifySourcedLines } from '@/lib/utils/strings';
import { useToast } from '@/components/toast';

interface SaveResponse {
  ok: boolean;
  data?: {
    id: string;
    path: string;
  };
  error?: unknown;
}

interface RagSearchHit {
  chunk: ReviewRagContextItem;
  finalScore: number;
}

interface RagSearchResponse {
  ok: boolean;
  data?: RagSearchHit[];
  error?: unknown;
}

interface ReviewWorkbenchProps {
  viewpoints: ReviewContextItem[];
}

const emptyResult: DailyReviewGenerationResult = {
  date: new Date().toISOString().slice(0, 10),
  market_phase: '未知',
  sentiment_score: 50,
  main_themes: [],
  capital_flow_path: '',
  core_stocks: [],
  extension_stocks: [],
  watchpoints: [],
  risks: [],
  facts: [],
  inferences: [],
  divergence: [],
  conclusion: '',
};

/** 按文档类型分组展示 RAG 检索结果 */
function RagResultsGrouped({
  results,
  selectedIds,
  onToggle,
}: {
  results: ReviewRagContextItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, ReviewRagContextItem[]>();
    for (const item of results) {
      const group = map.get(item.docType) ?? [];
      group.push(item);
      map.set(item.docType, group);
    }
    // 按优先级排序
    return [...map.entries()].sort(
      (a, b) => (docTypePriority[a[0]] ?? 99) - (docTypePriority[b[0]] ?? 99),
    );
  }, [results]);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {grouped.map(([docType, items]) => (
        <div key={docType}>
          <div className="rag-group-header">
            <span className={`type-badge ${getDocumentTypeBadgeClass(docType)}`}>
              {getDocumentTypeLabel(docType as never)}
            </span>
            <span className="rag-group-count">{items.length} 条</span>
          </div>
          <div className="checkbox-list">
            {items.map((item) => (
              <label key={item.id} className="checkbox-item">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  onChange={() => onToggle(item.id)}
                />
                <span>
                  <strong>{item.title}</strong>
                  <br />
                  <span className="text-muted">
                    {(item.headingPath.length
                      ? item.headingPath.join(' > ')
                      : '正文') +
                      (typeof item.score === 'number'
                        ? ` · ${(item.score * 100).toFixed(0)}%`
                        : '')}
                  </span>
                  <br />
                  <span className="text-muted">{item.content.slice(0, 120)}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function buildSuggestedRagQuery(params: {
  marketSummary: string;
  sectorPerformance: string;
  newsCatalysts: string;
  personalObservation: string;
  selectedViewpoints: ReviewContextItem[];
}): string {
  return [
    params.marketSummary,
    params.sectorPerformance,
    params.newsCatalysts,
    params.personalObservation,
    ...params.selectedViewpoints.map((item) => `${item.title} ${item.summary}`),
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n');
}

export function ReviewWorkbench({ viewpoints }: ReviewWorkbenchProps) {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [marketSummary, setMarketSummary] = useState('');
  const [sectorPerformance, setSectorPerformance] = useState('');
  const [newsCatalysts, setNewsCatalysts] = useState('');
  const [personalObservation, setPersonalObservation] = useState('');
  const [selectedViewpointIds, setSelectedViewpointIds] = useState<string[]>([]);
  const [ragQuery, setRagQuery] = useState('');
  const [ragResults, setRagResults] = useState<ReviewRagContextItem[]>([]);
  const [selectedRagIds, setSelectedRagIds] = useState<string[]>([]);
  const [result, setResult] = useState<DailyReviewGenerationResult>(emptyResult);
  const [saving, setSaving] = useState(false);
  const [ragLoading, setRagLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { showToast } = useToast();

  const {
    thinking,
    streaming,
    result: streamResult,
    error: streamError,
    startStream,
  } = useStreamAI<DailyReviewGenerationResult>();

  useEffect(() => {
    if (streamResult) {
      setResult(streamResult);
      setMessage('复盘结构化结果已生成，可继续人工编辑后再保存。');
      showToast('AI 复盘生成完成', 'success');
    }
  }, [streamResult]);

  useEffect(() => {
    if (streamError) {
      setError(streamError);
    }
  }, [streamError]);

  const selectedViewpoints = useMemo(
    () => viewpoints.filter((item) => selectedViewpointIds.includes(item.id)),
    [selectedViewpointIds, viewpoints],
  );
  const selectedRagContext = useMemo(
    () => ragResults.filter((item) => selectedRagIds.includes(item.id)),
    [ragResults, selectedRagIds],
  );

  const canGenerate = useMemo(
    () =>
      date.trim() &&
      (marketSummary.trim() ||
        sectorPerformance.trim() ||
        newsCatalysts.trim() ||
        personalObservation.trim()),
    [date, marketSummary, newsCatalysts, personalObservation, sectorPerformance],
  );

  function toggleViewpoint(id: string) {
    setSelectedViewpointIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function toggleRagContext(id: string) {
    setSelectedRagIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function handleRetrieveRag() {
    const query =
      ragQuery.trim() ||
      buildSuggestedRagQuery({
        marketSummary,
        sectorPerformance,
        newsCatalysts,
        personalObservation,
        selectedViewpoints,
      });

    if (!query) {
      setError('请先填写复盘输入，或手动输入检索词。');
      setMessage('');
      return;
    }

    setRagLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch('/api/rag/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          topK: 5,
        }),
      });
      const payload = (await response.json()) as RagSearchResponse;

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : '历史资料检索失败，请稍后重试。',
        );
      }

      const contexts = payload.data.map((item) => ({
        ...item.chunk,
        score: item.finalScore,
      }));

      setRagQuery(query);
      setRagResults(contexts);
      setSelectedRagIds(contexts.map((item) => item.id));
      setMessage(
        contexts.length
          ? `已检索到 ${contexts.length} 条历史资料，可勾选后用于复盘生成。`
          : '未检索到历史资料，可直接生成复盘或调整检索词后重试。',
      );
    } catch (ragError) {
      setError(
        ragError instanceof Error ? ragError.message : '历史资料检索失败，请稍后重试。',
      );
    } finally {
      setRagLoading(false);
    }
  }

  async function handleGenerate() {
    setError('');
    setMessage('');

    await startStream('generate-review', {
      date,
      marketSummary,
      sectorPerformance,
      newsCatalysts,
      personalObservation,
      selectedViewpoints,
      ragQuery,
      ragContext: selectedRagContext,
    });
  }

  async function handleSave() {
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
          type: 'daily_review',
          date,
          marketSummary,
          sectorPerformance,
          newsCatalysts,
          personalObservation,
          selectedViewpoints,
          ragContext: selectedRagContext,
          generation: result,
        }),
      });
      const payload = (await response.json()) as SaveResponse;

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : '保存复盘失败，请稍后重试。',
        );
      }

      showToast('复盘已保存', 'success');
      router.push(`/reviews/${payload.data.id}`);
      router.refresh();
    } catch (saveError) {
      const msg = saveError instanceof Error ? saveError.message : '保存复盘失败，请稍后重试。';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="section-grid columns-3">
      <section className="glass-card form-card">
        <div className="form-section-title">输入与上下文</div>
        <label className="form-field">
          <span>日期</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>市场摘要</span>
          <textarea
            rows={5}
            value={marketSummary}
            onChange={(event) => setMarketSummary(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>板块表现</span>
          <textarea
            rows={5}
            value={sectorPerformance}
            onChange={(event) => setSectorPerformance(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>新闻催化</span>
          <textarea
            rows={5}
            value={newsCatalysts}
            onChange={(event) => setNewsCatalysts(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>个人观察</span>
          <textarea
            rows={5}
            value={personalObservation}
            onChange={(event) => setPersonalObservation(event.target.value)}
          />
        </label>

        <div className="form-field">
          <span>选择关注人观点作为上下文</span>
          <div className="checkbox-list">
            {viewpoints.length ? (
              viewpoints.map((item) => (
                <label key={item.id} className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={selectedViewpointIds.includes(item.id)}
                    onChange={() => toggleViewpoint(item.id)}
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <br />
                    <span className="text-muted">
                      {(item.author ?? '未知作者') +
                        (item.date ? ` · ${item.date}` : '')}
                    </span>
                  </span>
                </label>
              ))
            ) : (
              <div className="text-muted">当前没有可用观点上下文。</div>
            )}
          </div>
        </div>

        <label className="form-field">
          <span>历史资料检索词</span>
          <textarea
            rows={4}
            placeholder="可手动输入检索词；留空时会根据当前复盘输入自动拼接查询。"
            value={ragQuery}
            onChange={(event) => setRagQuery(event.target.value)}
          />
        </label>

        <div className="form-actions">
          <button
            className="primary-button"
            disabled={ragLoading}
            onClick={handleRetrieveRag}
            type="button"
          >
            {ragLoading ? '检索中...' : '检索历史资料'}
          </button>
        </div>

        <div className="form-field">
          <span>勾选纳入复盘生成的历史资料</span>
          {ragResults.length ? (
            <RagResultsGrouped
              results={ragResults}
              selectedIds={selectedRagIds}
              onToggle={toggleRagContext}
            />
          ) : (
            <div className="text-muted">尚未检索历史资料。</div>
          )}
        </div>

        <div className="form-actions">
          <button
            className="primary-button"
            disabled={!canGenerate || streaming}
            onClick={handleGenerate}
            type="button"
          >
            {streaming ? '生成中...' : '生成每日复盘'}
          </button>
        </div>
      </section>

      <ThinkingPanel
        content={thinking}
        streaming={streaming}
        label="复盘生成思考过程"
        className="workbench-sticky-thinking"
      />

      <section className="glass-card form-card">
        <div className="form-section-title">结构化复盘结果</div>
        <div className="inline-grid">
          <label className="form-field">
            <span>市场阶段</span>
            <select
              value={result.market_phase}
              onChange={(event) =>
                setResult((current) => ({
                  ...current,
                  market_phase:
                    event.target.value as DailyReviewGenerationResult['market_phase'],
                }))
              }
            >
              <option value="启动">启动</option>
              <option value="发酵">发酵</option>
              <option value="高潮">高潮</option>
              <option value="分歧">分歧</option>
              <option value="退潮">退潮</option>
              <option value="修复">修复</option>
              <option value="未知">未知</option>
            </select>
          </label>
          <label className="form-field">
            <span>情绪分数</span>
            <input
              type="number"
              min={0}
              max={100}
              value={result.sentiment_score}
              onChange={(event) =>
                setResult((current) => ({
                  ...current,
                  sentiment_score: Number(event.target.value || 0),
                }))
              }
            />
          </label>
        </div>

        <label className="form-field">
          <span>资金流路径</span>
          <textarea
            rows={4}
            value={result.capital_flow_path}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                capital_flow_path: event.target.value,
              }))
            }
          />
        </label>
        <label className="form-field">
          <span>主线板块，每行一个</span>
          <textarea
            rows={4}
            value={stringifyLines(result.main_themes)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                main_themes: parseLines(event.target.value),
              }))
            }
          />
        </label>
        <label className="form-field">
          <span>核心个股，每行一个</span>
          <textarea
            rows={4}
            value={stringifyLines(result.core_stocks)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                core_stocks: parseLines(event.target.value),
              }))
            }
          />
        </label>
        <label className="form-field">
          <span>扩散个股，每行一个</span>
          <textarea
            rows={4}
            value={stringifyLines(result.extension_stocks)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                extension_stocks: parseLines(event.target.value),
              }))
            }
          />
        </label>
        <label className="form-field">
          <span>明日观察点，每行一个</span>
          <textarea
            rows={4}
            value={stringifyLines(result.watchpoints)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                watchpoints: parseLines(event.target.value),
              }))
            }
          />
        </label>
        <label className="form-field">
          <span>风险传导，每行一个</span>
          <textarea
            rows={4}
            value={stringifySourcedLines(result.risks)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                risks: parseSourcedLines(event.target.value),
              }))
            }
          />
        </label>
        <label className="form-field">
          <span>事实，每行一个</span>
          <textarea
            rows={4}
            value={stringifySourcedLines(result.facts)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                facts: parseSourcedLines(event.target.value),
              }))
            }
          />
        </label>
        <label className="form-field">
          <span>推理，每行一个</span>
          <textarea
            rows={4}
            value={stringifySourcedLines(result.inferences)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                inferences: parseSourcedLines(event.target.value),
              }))
            }
          />
        </label>
        <label className="form-field">
          <span>观点分歧，每行一个</span>
          <textarea
            rows={4}
            value={stringifySourcedLines(result.divergence)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                divergence: parseSourcedLines(event.target.value),
              }))
            }
            placeholder="关注人之间对方向、主线、个股的不同判断"
          />
        </label>
        <label className="form-field">
          <span>结论</span>
          <textarea
            rows={4}
            value={result.conclusion}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                conclusion: event.target.value,
              }))
            }
          />
        </label>

        {message ? <div className="status-message status-success">{message}</div> : null}
        {error ? <div className="status-message status-error">{error}</div> : null}

        <div className="form-actions">
          <button
            className="primary-button"
            disabled={!date.trim() || saving}
            onClick={handleSave}
            type="button"
          >
            {saving ? '保存中...' : '保存为 Markdown'}
          </button>
        </div>
      </section>
    </div>
  );
}
