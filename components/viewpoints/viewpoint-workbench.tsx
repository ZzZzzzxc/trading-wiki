'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  viewpointPlatforms,
  type ViewpointExtractionResult,
  type ViewpointPlatform,
} from '@/lib/types/viewpoint';
import {
  getViewpointConfidenceLabel,
  getViewpointStanceLabel,
  getViewpointTimeHorizonLabel,
} from '@/lib/utils/display';
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

const emptyResult: ViewpointExtractionResult = {
  summary: '',
  stance: 'watch',
  time_horizon: 'unknown',
  mentioned_stocks: [],
  mentioned_themes: [],
  facts: [],
  opinions: [],
  reasoning: [],
  risks: [],
  counter_evidence: [],
  confidence: 'low',
  verifiable_claims: [],
};

export function ViewpointWorkbench() {
  const router = useRouter();
  const [author, setAuthor] = useState('');
  const [platform, setPlatform] = useState<ViewpointPlatform>('雪球');
  const [source, setSource] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rawText, setRawText] = useState('');
  const [result, setResult] = useState<ViewpointExtractionResult>(emptyResult);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string>('');
  const { showToast } = useToast();

  const {
    thinking,
    streaming,
    result: streamResult,
    error: streamError,
    startStream,
  } = useStreamAI<ViewpointExtractionResult>();

  // 流式完成时，将结果填入表单
  useEffect(() => {
    if (streamResult) {
      setResult(streamResult);
      setMessage('AI 蒸馏完成，当前结果可继续编辑后再保存。');
      showToast('AI 观点蒸馏完成', 'success');

      // 自动创建可验证断言
      const claims = (streamResult as ViewpointExtractionResult).verifiable_claims;
      if (claims && claims.length > 0) {
        createAssertions(claims, streamResult);
      }
    }
  }, [streamResult]);

  async function createAssertions(
    claims: Array<{ claim: string; verify_by: string; suggested_window: string }>,
    extraction: ViewpointExtractionResult,
  ) {
    for (const c of claims) {
      try {
        await fetch('/api/facts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            claim: c.claim,
            stocks: extraction.mentioned_stocks,
            themes: extraction.mentioned_themes,
            notes: `验证依据: ${c.verify_by}\n窗口: ${c.suggested_window}`,
          }),
        });
      } catch {
        // 静默失败，不打断用户
      }
    }
    setMessage((prev) => `${prev} 已自动创建 ${claims.length} 条可验证断言。`);
  }

  // 流式错误同步到本地 error 状态
  useEffect(() => {
    if (streamError) {
      setError(streamError);
    }
  }, [streamError]);

  const canExtract = useMemo(
    () => rawText.trim() && author.trim() && platform.trim() && date.trim(),
    [author, date, platform, rawText],
  );

  async function handleExtract() {
    setError('');
    setMessage('');

    await startStream('extract-viewpoint', {
      rawText,
      author,
      platform,
      date,
      source: source.trim() || undefined,
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
          type: 'viewpoint',
          author,
          platform,
          date,
          source: source.trim() || undefined,
          rawText,
          extraction: result,
        }),
      });
      const payload = (await response.json()) as SaveResponse;

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : '保存观点失败，请稍后重试。',
        );
      }

      showToast('观点已保存', 'success');
      router.push(`/viewpoints/${payload.data.id}`);
      router.refresh();
    } catch (saveError) {
      const msg = saveError instanceof Error
        ? saveError.message
        : '保存观点失败，请稍后重试。';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="section-grid columns-3">
      <section className="glass-card form-card">
        <div className="form-section-title">原始输入</div>
        <label className="form-field">
          <span>作者</span>
          <input value={author} onChange={(event) => setAuthor(event.target.value)} />
        </label>
        <label className="form-field">
          <span>平台</span>
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value as ViewpointPlatform)}
          >
            {viewpointPlatforms.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>来源</span>
          <input
            placeholder="可选，例如公众号名、UP 主名、群组名"
            value={source}
            onChange={(event) => setSource(event.target.value)}
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
          <span>原始发言</span>
          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            rows={16}
          />
        </label>

        <div className="form-actions">
          <button
            className="primary-button"
            disabled={!canExtract || streaming}
            onClick={handleExtract}
            type="button"
          >
            {streaming ? '蒸馏中...' : 'AI 蒸馏观点'}
          </button>
        </div>
      </section>

      <ThinkingPanel
        content={thinking}
        streaming={streaming}
        label="AI 蒸馏思考过程"
        className="workbench-sticky-thinking"
      />

      <section className="glass-card form-card">
        <div className="form-section-title">结构化结果</div>
        <label className="form-field">
          <span>摘要</span>
          <textarea
            rows={4}
            value={result.summary}
            onChange={(event) =>
              setResult((current) => ({ ...current, summary: event.target.value }))
            }
          />
        </label>

        <div className="inline-grid">
          <label className="form-field">
            <span>立场</span>
            <select
              value={result.stance}
              onChange={(event) =>
                setResult((current) => ({
                  ...current,
                  stance: event.target.value as ViewpointExtractionResult['stance'],
                }))
              }
            >
              <option value="bullish">{getViewpointStanceLabel('bullish')}</option>
              <option value="bearish">{getViewpointStanceLabel('bearish')}</option>
              <option value="neutral">{getViewpointStanceLabel('neutral')}</option>
              <option value="watch">{getViewpointStanceLabel('watch')}</option>
            </select>
          </label>
          <label className="form-field">
            <span>时间周期</span>
            <select
              value={result.time_horizon}
              onChange={(event) =>
                setResult((current) => ({
                  ...current,
                  time_horizon:
                    event.target.value as ViewpointExtractionResult['time_horizon'],
                }))
              }
            >
              <option value="intraday">{getViewpointTimeHorizonLabel('intraday')}</option>
              <option value="short">{getViewpointTimeHorizonLabel('short')}</option>
              <option value="mid">{getViewpointTimeHorizonLabel('mid')}</option>
              <option value="long">{getViewpointTimeHorizonLabel('long')}</option>
              <option value="unknown">{getViewpointTimeHorizonLabel('unknown')}</option>
            </select>
          </label>
          <label className="form-field">
            <span>置信度</span>
            <select
              value={result.confidence}
              onChange={(event) =>
                setResult((current) => ({
                  ...current,
                  confidence:
                    event.target.value as ViewpointExtractionResult['confidence'],
                }))
              }
            >
              <option value="low">{getViewpointConfidenceLabel('low')}</option>
              <option value="medium">{getViewpointConfidenceLabel('medium')}</option>
              <option value="high">{getViewpointConfidenceLabel('high')}</option>
            </select>
          </label>
        </div>

        <label className="form-field">
          <span>涉及个股，每行一个</span>
          <textarea
            rows={3}
            value={stringifyLines(result.mentioned_stocks)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                mentioned_stocks: parseLines(event.target.value),
              }))
            }
          />
        </label>
        <label className="form-field">
          <span>涉及主题，每行一个</span>
          <textarea
            rows={3}
            value={stringifyLines(result.mentioned_themes)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                mentioned_themes: parseLines(event.target.value),
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
          <span>观点，每行一个</span>
          <textarea
            rows={4}
            value={stringifySourcedLines(result.opinions)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                opinions: parseSourcedLines(event.target.value),
              }))
            }
          />
        </label>
        <label className="form-field">
          <span>推理，每行一个</span>
          <textarea
            rows={4}
            value={stringifySourcedLines(result.reasoning)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                reasoning: parseSourcedLines(event.target.value),
              }))
            }
          />
        </label>
        <label className="form-field">
          <span>风险，每行一个</span>
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
          <span>反证与警惕，每行一个</span>
          <textarea
            rows={4}
            value={stringifySourcedLines(result.counter_evidence)}
            onChange={(event) =>
              setResult((current) => ({
                ...current,
                counter_evidence: parseSourcedLines(event.target.value),
              }))
            }
            placeholder="哪些证据可能推翻上述观点？需要警惕什么场景？"
          />
        </label>

        {message ? <div className="status-message status-success">{message}</div> : null}
        {error ? <div className="status-message status-error">{error}</div> : null}

        <div className="form-actions">
          <button
            className="primary-button"
            disabled={!rawText.trim() || !author.trim() || saving}
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
