import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { DeleteButton } from '@/components/documents/delete-button';
import { ExportButton } from '@/components/documents/export-button';
import { MarkdownPreview } from '@/components/documents/markdown-preview';
import { RelatedDocuments } from '@/components/documents/related-documents';
import { getDocumentById, getRelatedDocuments } from '@/lib/server/documents';
import {
  getViewpointConfidenceLabel,
  getViewpointStanceLabel,
  getViewpointTimeHorizonLabel,
} from '@/lib/utils/display';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<{ title: string }> {
  try {
    const { id } = await params;
    const document = await getDocumentById(decodeURIComponent(id));
    if (document) return { title: `${document.title} - 观点 - A 股投研助手` };
  } catch {}
  return { title: '观点 - A 股投研助手' };
}

interface ViewpointDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ViewpointDetailPage({
  params,
}: ViewpointDetailPageProps) {
  const { id } = await params;
  const document = await getDocumentById(decodeURIComponent(id));

  if (!document || document.frontmatter.type !== 'viewpoint') {
    notFound();
  }

  const related = await getRelatedDocuments(
    document.id,
    document.frontmatter.mentioned_stocks ?? [],
    document.frontmatter.mentioned_themes ?? [],
  );

  return (
    <AppShell currentPath="/viewpoints">
      <div className="page-stack">
        <PageHero
          title={document.title}
          description="以下内容来自本地 Markdown 文件。"
          extra={
            <>
              <ExportButton filename={document.title} content={document.content} />
              <Link
                href={`/viewpoints/${encodeURIComponent(document.id)}/edit`}
                className="app-nav-link app-nav-link-active"
              >
                编辑文档
              </Link>
              <DeleteButton documentId={document.id} redirectTo="/viewpoints" />
              <Link href="/viewpoints" className="app-nav-link">
                返回列表
              </Link>
            </>
          }
        />

        <section className="glass-card detail-card">
          <div className="document-meta">
            {document.frontmatter.date ? (
              <span className="meta-pill">📅 {document.frontmatter.date}</span>
            ) : null}
            {document.frontmatter.author ? (
              <span className="meta-pill">👤 {document.frontmatter.author}</span>
            ) : null}
            {document.frontmatter.platform ? (
              <span className="meta-pill">📡 {document.frontmatter.platform}</span>
            ) : null}
            {document.frontmatter.stance ? (
              <span
                className="type-badge"
                style={{
                  background: document.frontmatter.stance === 'bullish' ? 'rgba(224,144,144,0.12)' :
                    document.frontmatter.stance === 'bearish' ? 'rgba(140,216,176,0.12)' :
                    document.frontmatter.stance === 'neutral' ? 'rgba(176,196,216,0.12)' :
                    'rgba(212,177,106,0.12)',
                  color: document.frontmatter.stance === 'bullish' ? '#e09090' :
                    document.frontmatter.stance === 'bearish' ? '#8cd8b0' :
                    document.frontmatter.stance === 'neutral' ? '#b0c4d8' : '#d4b16a',
                  border: '1px solid',
                  borderColor: document.frontmatter.stance === 'bullish' ? 'rgba(224,144,144,0.2)' :
                    document.frontmatter.stance === 'bearish' ? 'rgba(140,216,176,0.2)' :
                    document.frontmatter.stance === 'neutral' ? 'rgba(176,196,216,0.2)' :
                    'rgba(212,177,106,0.2)',
                }}
              >
                {getViewpointStanceLabel(document.frontmatter.stance as 'bullish' | 'bearish' | 'neutral' | 'watch')}
              </span>
            ) : null}
            {document.frontmatter.time_horizon && document.frontmatter.time_horizon !== 'unknown' ? (
              <span className="type-badge type-badge-note">
                {getViewpointTimeHorizonLabel(document.frontmatter.time_horizon as 'intraday' | 'short' | 'mid' | 'long' | 'unknown')}
              </span>
            ) : null}
            {document.frontmatter.confidence ? (
              <span
                className="type-badge"
                style={{
                  background: document.frontmatter.confidence === 'high' ? 'rgba(140,216,176,0.12)' :
                    document.frontmatter.confidence === 'medium' ? 'rgba(212,177,106,0.12)' :
                    'rgba(143,164,194,0.1)',
                  color: document.frontmatter.confidence === 'high' ? '#8cd8b0' :
                    document.frontmatter.confidence === 'medium' ? '#d4b16a' : '#b0c4d8',
                }}
              >
                置信度: {getViewpointConfidenceLabel(document.frontmatter.confidence as 'low' | 'medium' | 'high')}
              </span>
            ) : null}
          </div>
          <MarkdownPreview content={document.content} />
        </section>

        <RelatedDocuments
          groups={[
            { label: '相关个股', items: related.byStock },
            { label: '相关主题', items: related.byTheme },
          ]}
        />
      </div>
    </AppShell>
  );
}
