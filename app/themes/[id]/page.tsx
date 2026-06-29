import Link from 'next/link';
import { notFound } from 'next/navigation';
import React from 'react';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { DeleteButton } from '@/components/documents/delete-button';
import { ExportButton } from '@/components/documents/export-button';
import { MarkdownPreview } from '@/components/documents/markdown-preview';
import { getDocumentById, getRelatedDocuments } from '@/lib/server/documents';
import { RelatedDocuments } from '@/components/documents/related-documents';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<{ title: string }> {
  try {
    const { id } = await params;
    const document = await getDocumentById(decodeURIComponent(id));
    if (document) return { title: `${document.title} - 产业链研究 - A 股投研助手` };
  } catch {}
  return { title: '产业链研究 - A 股投研助手' };
}

interface ThemeDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ThemeDetailPage({ params }: ThemeDetailPageProps) {
  const { id } = await params;
  const document = await getDocumentById(decodeURIComponent(id));

  if (!document || document.frontmatter.type !== 'theme_research') {
    notFound();
  }

  const related = await getRelatedDocuments(
    document.id,
    [],
    document.frontmatter.themes ?? [],
  );

  return (
    <AppShell currentPath="/themes">
      <div className="page-stack">
        <PageHero
          title={document.title}
          description="以下内容来自本地 Markdown 文件。"
          extra={
            <>
              <ExportButton filename={document.title} content={document.content} />
              <Link
                href={`/themes/${encodeURIComponent(document.id)}/edit`}
                className="app-nav-link app-nav-link-active"
              >
                编辑文档
              </Link>
              <DeleteButton documentId={document.id} redirectTo="/themes" />
              <Link href="/themes" className="app-nav-link">
                返回列表
              </Link>
            </>
          }
        />

        <section className="glass-card detail-card">
          <div className="document-meta">
            {document.frontmatter.themes?.map((theme) => (
              <span key={theme} className="meta-pill">
                {theme}
              </span>
            ))}
            {document.frontmatter.tags?.map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
            ))}
          </div>
          <MarkdownPreview content={document.content} />
        </section>

        {/* 新增分析字段展示 */}
        {(() => {
          const fm = document.frontmatter as unknown as Record<string, unknown>;
          const sections: React.ReactNode[] = [];

          const ba = fm.bottleneck_analysis as Record<string, string> | undefined;
          if (ba && Object.values(ba).some(Boolean)) {
            sections.push(
              <section key="ba" className="glass-card detail-card">
                <h3>新增约束分析</h3>
                <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                  {Object.entries(ba).filter(([_, v]) => v).map(([k, v]) => (
                    <div key={k}><strong>{k}:</strong> {v}</div>
                  ))}
                </div>
              </section>
            );
          }

          const ij = fm.investment_judgment as Record<string, string> | undefined;
          if (ij && Object.values(ij).some(Boolean)) {
            sections.push(
              <section key="ij" className="glass-card detail-card">
                <h3>投资判断</h3>
                <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                  {Object.entries(ij).filter(([_, v]) => v).map(([k, v]) => (
                    <div key={k}><strong>{k}:</strong> {v}</div>
                  ))}
                </div>
              </section>
            );
          }

          const am = fm.a_stock_mapping as Record<string, string[]> | undefined;
          if (am && Object.values(am).some((v) => v && v.length > 0)) {
            sections.push(
              <section key="am" className="glass-card detail-card">
                <h3>A股映射</h3>
                <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                  {Object.entries(am).filter(([_, v]) => v && v.length > 0).map(([k, v]) => (
                    <div key={k}><strong>{k}:</strong> {v.join(', ')}</div>
                  ))}
                </div>
              </section>
            );
          }

          const vt = fm.verification_timeline as Record<string, string[]> | undefined;
          if (vt && Object.values(vt).some((v) => v && v.length > 0)) {
            sections.push(
              <section key="vt" className="glass-card detail-card">
                <h3>验证时间线</h3>
                <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                  {Object.entries(vt).filter(([_, v]) => v && v.length > 0).map(([k, v]) => (
                    <div key={k}><strong>{k}:</strong> {v.join('; ')}</div>
                  ))}
                </div>
              </section>
            );
          }

          return sections.length > 0 ? <>{sections}</> : null;
        })()}

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
