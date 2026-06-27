import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { StockWorkbench } from '@/components/stocks/stock-workbench';
import { getDocumentById, getDocumentsByType } from '@/lib/server/documents';
import { parseStockMarkdown } from '@/lib/stocks/markdown';

export const metadata = { title: '编辑个股档案 - A 股投研助手' };

interface StockEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function StockEditPage({ params }: StockEditPageProps) {
  const { id } = await params;
  const document = await getDocumentById(decodeURIComponent(id));

  if (!document || document.frontmatter.type !== 'stock_profile') {
    notFound();
  }

  const parsed = parseStockMarkdown(document.content);
  const companyName = document.title.replace('个股档案', '');
  const themes = (document.frontmatter.themes ?? []).join('\n');
  const [allViewpoints, reviews, notes, materials] = await Promise.all([
    getDocumentsByType('viewpoint'),
    getDocumentsByType('daily_review'),
    getDocumentsByType('note'),
    getDocumentsByType('material'),
  ]);

  // 匹配已关联的观点标题 → ID
  const initialSelectedIds = parsed.linkedViewpointTitles
    .map((title) => allViewpoints.find((v) => v.title === title)?.id)
    .filter(Boolean) as string[];

  return (
    <AppShell currentPath="/stocks">
      <div className="page-stack-fluid">
        <PageHero
          title={`重新生成：${document.title}`}
          description="重新选择素材后调用 AI 生成。素材库中的原始资料不会被覆盖。"
          extra={
            <Link href={`/stocks/${encodeURIComponent(document.id)}`} className="app-nav-link">
              返回详情
            </Link>
          }
        />
        <StockWorkbench
          editDocId={document.id}
          initialName={companyName}
          initialThemes={themes}
          initialObservation={parsed.personalObservation}
          initialSelectedViewpointIds={initialSelectedIds}
          materials={[...materials, ...reviews, ...notes]}
          viewpoints={allViewpoints.map((item) => ({
            id: item.id,
            title: item.title,
            summary: item.summary,
            author: item.author,
            date: item.date,
            themes: item.themes,
          }))}
        />
      </div>
    </AppShell>
  );
}
