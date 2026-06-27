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
    if (document) return { title: `${document.title} - 个股档案 - A 股投研助手` };
  } catch {}
  return { title: '个股档案 - A 股投研助手' };
}

interface StockDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function StockDetailPage({ params }: StockDetailPageProps) {
  const { id } = await params;
  const document = await getDocumentById(decodeURIComponent(id));

  if (!document || document.frontmatter.type !== 'stock_profile') {
    notFound();
  }

  const related = await getRelatedDocuments(
    document.id,
    document.frontmatter.stocks ?? [],
    document.frontmatter.themes ?? [],
  );

  return (
    <AppShell currentPath="/stocks">
      <div className="page-stack">
        <PageHero
          title={document.title}
          description="以下内容来自本地 Markdown 文件。"
          extra={
            <>
              <ExportButton filename={document.title} content={document.content} />
              <Link
                href={`/stocks/${encodeURIComponent(document.id)}/edit`}
                className="app-nav-link app-nav-link-active"
              >
                编辑文档
              </Link>
              <DeleteButton documentId={document.id} redirectTo="/stocks" />
              <Link href="/stocks" className="app-nav-link">
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
            { label: '关联观点', items: related.byTheme },
            { label: '同行业个股', items: related.byType },
          ]}
        />
      </div>
    </AppShell>
  );
}
