import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { DocumentEditor } from '@/components/documents/document-editor';
import { getDocumentById } from '@/lib/server/documents';

export const metadata = { title: '编辑复盘 - A 股投研助手' };

interface ReviewEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function ReviewEditPage({
  params,
}: ReviewEditPageProps) {
  const { id } = await params;
  const document = await getDocumentById(decodeURIComponent(id));

  if (!document || document.frontmatter.type !== 'daily_review') {
    notFound();
  }

  const fm = document.frontmatter;

  return (
    <AppShell currentPath="/reviews">
      <div className="page-stack-fluid">
        <PageHero
          title={`编辑：${document.title}`}
          description="修改 frontmatter 字段或直接编辑 Markdown 正文。"
          extra={
            <Link href={`/reviews/${encodeURIComponent(id)}`} className="app-nav-link">
              返回详情
            </Link>
          }
        />

        <DocumentEditor
          documentId={id}
          documentType="daily_review"
          initialFrontmatter={fm}
          initialContent={document.content}
          frontmatterFields={[
            {
              key: 'market_phase',
              label: '市场阶段',
              value: fm.market_phase ?? '',
            },
          ]}
        />
      </div>
    </AppShell>
  );
}
