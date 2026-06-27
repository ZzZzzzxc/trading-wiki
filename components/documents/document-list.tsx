import Link from 'next/link';
import { FileText } from 'lucide-react';
import type { ComponentProps } from 'react';
import type { DocumentIndexItem } from '@/lib/types/document';
import { getDocumentTypeLabel, getDocumentTypeBadgeClass, getViewpointStanceLabel, getViewpointConfidenceLabel, getViewpointTimeHorizonLabel, relativeTime } from '@/lib/utils/display';

export interface DocumentListProps {
  items: DocumentIndexItem[];
  emptyTitle?: string;
  emptyDescription?: string;
  getItemHref?: (item: DocumentIndexItem) => ComponentProps<typeof Link>['href'] | undefined;
}

const stanceColors: Record<string, { bg: string; text: string }> = {
  bullish: { bg: 'rgba(224,144,144,0.1)', text: '#e09090' },
  bearish: { bg: 'rgba(140,216,176,0.1)', text: '#8cd8b0' },
  neutral: { bg: 'rgba(176,196,216,0.1)', text: '#b0c4d8' },
  watch: { bg: 'rgba(212,177,106,0.1)', text: '#d4b16a' },
};

function StanceBadge({ stance }: { stance: string }) {
  const c = stanceColors[stance] ?? stanceColors.watch;
  return (
    <span style={{
      display: 'inline-block', borderRadius: 5, padding: '2px 7px', fontSize: 10,
      fontWeight: 600, background: c.bg, color: c.text, border: `1px solid ${c.text}22`,
    }}>
      {getViewpointStanceLabel(stance as 'bullish' | 'bearish' | 'neutral' | 'watch')}
    </span>
  );
}

const confidenceColors: Record<string, { bg: string; text: string }> = {
  high: { bg: 'rgba(34,197,94,0.1)', text: '#22c55e' },
  medium: { bg: 'rgba(245,158,11,0.1)', text: '#f59e0b' },
  low: { bg: 'rgba(107,114,128,0.1)', text: '#6b7280' },
};

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const c = confidenceColors[confidence] ?? confidenceColors.low;
  return (
    <span style={{
      display: 'inline-block', borderRadius: 5, padding: '2px 7px', fontSize: 10,
      fontWeight: 600, background: c.bg, color: c.text, border: `1px solid ${c.text}22`,
    }}>
      {getViewpointConfidenceLabel(confidence as 'low' | 'medium' | 'high')}
    </span>
  );
}

const evidenceColors: Record<string, { bg: string; text: string }> = {
  a: { bg: 'rgba(34,197,94,0.1)', text: '#22c55e' },
  b: { bg: 'rgba(59,130,246,0.1)', text: '#3b82f6' },
  c: { bg: 'rgba(245,158,11,0.1)', text: '#f59e0b' },
  d: { bg: 'rgba(156,163,175,0.1)', text: '#9ca3af' },
};

function EvidenceBadge({ level }: { level: string }) {
  const key = level.toLowerCase();
  const c = evidenceColors[key] ?? { bg: 'rgba(107,114,128,0.1)', text: '#6b7280' };
  const label: Record<string, string> = {
    a: 'A-公告',
    b: 'B-研报',
    c: 'C-会议',
    d: 'D-传闻',
  };
  return (
    <span style={{
      display: 'inline-block', borderRadius: 5, padding: '2px 7px', fontSize: 10,
      fontWeight: 600, background: c.bg, color: c.text, border: `1px solid ${c.text}22`,
    }}>
      {label[key] ?? level}
    </span>
  );
}

export function DocumentList({
  items,
  emptyTitle = '还没有文档',
  emptyDescription = '先运行示例数据脚本，或开始创建第一篇本地 Markdown 文档。',
  getItemHref,
}: DocumentListProps) {
  if (!items.length) {
    return (
      <div className="glass-card empty-state">
        <FileText size={36} style={{ opacity: 0.2 }} />
        <strong>{emptyTitle}</strong>
        <span className="text-muted">{emptyDescription}</span>
      </div>
    );
  }

  return (
    <div className="document-list">
      {items.map((item) => {
        const href = getItemHref?.(item);
        const content = (
          <>
            <div className="document-row-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className={`type-badge ${getDocumentTypeBadgeClass(item.type)}`}>
                  {getDocumentTypeLabel(item.type)}
                </span>
                {item.stance ? <StanceBadge stance={item.stance} /> : null}
                {item.author ? (
                  <span className="meta-pill">{item.author}</span>
                ) : null}
                {item.date ? (
                  <span className="meta-pill" title={item.date}>{relativeTime(item.date)}</span>
                ) : null}
              </div>
            </div>
            <div className="document-row-title" style={{ fontSize: 15, marginTop: 2 }}>
              {item.title}
            </div>
            {item.summary ? (
              <div className="document-row-summary">
                {item.summary.slice(0, 180).replace(/\n/g, ' ')}{item.summary.length > 180 ? '...' : ''}
              </div>
            ) : null}
            {item.themes.length > 0 ? (
              <div className="tag-list">
                {item.themes.slice(0, 6).map((theme) => (
                  <span className="tag" key={`${item.id}-th-${theme}`}>{theme}</span>
                ))}
                {item.themes.length > 6 ? (
                  <span className="meta-pill">+{item.themes.length - 6}</span>
                ) : null}
              </div>
            ) : null}
            {item.stocks.length > 0 ? (
              <div className="tag-list" style={{ marginTop: item.themes.length > 0 ? 0 : undefined }}>
                {item.stocks.slice(0, 3).map((stock) => (
                  <span className="tag" key={`${item.id}-st-${stock}`}>{stock}</span>
                ))}
                {item.stocks.length > 3 ? (
                  <span className="meta-pill">+{item.stocks.length - 3}</span>
                ) : null}
              </div>
            ) : null}
            {item.type === 'viewpoint' && (item.confidence || item.time_horizon) ? (
              <div className="tag-list">
                {item.confidence ? <ConfidenceBadge confidence={item.confidence} /> : null}
                {item.time_horizon ? (
                  <span className="meta-pill">{getViewpointTimeHorizonLabel(item.time_horizon as 'intraday' | 'short' | 'mid' | 'long' | 'unknown')}</span>
                ) : null}
              </div>
            ) : null}
            {item.type === 'material' && item.evidence_level ? (
              <div className="tag-list">
                <EvidenceBadge level={item.evidence_level} />
              </div>
            ) : null}
          </>
        );

        if (href) {
          return (
            <Link key={item.id} href={href} className="document-row">
              {content}
            </Link>
          );
        }
        return (
          <article key={item.id} className="document-row">
            {content}
          </article>
        );
      })}
    </div>
  );
}
