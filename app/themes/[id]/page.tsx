import Link from 'next/link';
import { notFound } from 'next/navigation';
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
