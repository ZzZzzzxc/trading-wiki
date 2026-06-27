import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { DeleteButton } from '@/components/documents/delete-button';
import { MarkdownPreview } from '@/components/documents/markdown-preview';
import { getDocumentById } from '@/lib/server/documents';
import { evidenceLevelLabels } from '@/lib/types/fact';
import type { EvidenceLevel } from '@/lib/types/fact';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<{ title: string }> {
  return { title: `${(await params).id} - 素材 - A 股投研助手` };
}

interface MaterialDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function MaterialDetailPage({ params }: MaterialDetailPageProps) {
  const { id } = await params;
  const document = await getDocumentById(decodeURIComponent(id));

  if (!document || document.frontmatter.type !== 'material') {
    notFound();
  }

  const evidenceLevel = document.frontmatter.evidence_level as EvidenceLevel | undefined;

  return (
    <AppShell currentPath="/materials">
      <div className="page-stack">
        <PageHero
          title={document.title}
          description="素材内容不可编辑，保护原始证据不被事后修改。"
          extra={
            <>
              <DeleteButton documentId={document.id} redirectTo="/materials" />
              <Link href="/materials" className="app-nav-link">
                返回素材库
              </Link>
            </>
          }
        />

        <section className="glass-card detail-card">
          <div className="document-meta">
            {document.frontmatter.date ? (
              <span className="meta-pill">{document.frontmatter.date}</span>
            ) : null}
            {evidenceLevel && (
              <span className="meta-pill">
                证据强度：{evidenceLevelLabels[evidenceLevel] ?? evidenceLevel}
              </span>
            )}
            {document.frontmatter.stocks?.map((stock) => (
              <span key={stock} className="meta-pill">{stock}</span>
            ))}
            {document.frontmatter.themes?.map((theme) => (
              <span key={theme} className="meta-pill">{theme}</span>
            ))}
            {document.frontmatter.tags?.map((tag) => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </div>
          <MarkdownPreview content={document.content} />
        </section>
      </div>
    </AppShell>
  );
}
