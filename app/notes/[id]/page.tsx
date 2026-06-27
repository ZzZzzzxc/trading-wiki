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
    if (document) return { title: `${document.title} - 笔记 - A 股投研助手` };
  } catch {}
  return { title: '笔记 - A 股投研助手' };
}

interface NoteDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function NoteDetailPage({ params }: NoteDetailPageProps) {
  const { id } = await params;
  const document = await getDocumentById(decodeURIComponent(id));

  if (!document || document.frontmatter.type !== 'note') {
    notFound();
  }

  const related = await getRelatedDocuments(
    document.id,
    document.frontmatter.stocks ?? [],
    document.frontmatter.themes ?? [],
  );

  return (
    <AppShell currentPath="/notes">
      <div className="page-stack">
        <PageHero
          title={document.title}
          description="以下内容来自本地 Markdown 笔记文件。"
          extra={
            <>
              <ExportButton filename={document.title} content={document.content} />
              <Link
                href={`/notes/${encodeURIComponent(document.id)}/edit`}
                className="app-nav-link app-nav-link-active"
              >
                编辑文档
              </Link>
              <DeleteButton documentId={document.id} redirectTo="/notes" />
              <Link href="/notes" className="app-nav-link">
                返回列表
              </Link>
            </>
          }
        />

        <section className="glass-card detail-card">
          <div className="document-meta">
            {document.frontmatter.date ? (
              <span className="meta-pill">{document.frontmatter.date}</span>
            ) : null}
            {document.frontmatter.themes?.map((theme) => (
              <span key={theme} className="meta-pill">
                {theme}
              </span>
            ))}
            {document.frontmatter.stocks?.map((stock) => (
              <span key={stock} className="meta-pill">
                {stock}
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
