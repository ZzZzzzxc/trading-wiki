import Link from 'next/link';
import { FilterableDocumentList } from '@/components/documents/filterable-document-list';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { getDocumentsByType } from '@/lib/server/documents';

export const metadata = { title: '每日复盘 - A 股投研助手' };

export default async function ReviewsPage() {
  const items = await getDocumentsByType('daily_review');

  return (
    <AppShell currentPath="/reviews">
      <div className="page-stack">
        <PageHero
          title="每日复盘"
          description="按固定框架生成 A 股每日复盘，支持 RAG 检索历史资料作为上下文。"
          extra={
            <Link href="/reviews/new" className="app-nav-link app-nav-link-active">
              新建复盘
            </Link>
          }
        />
        <FilterableDocumentList
          items={items}
          emptyTitle="还没有复盘"
          emptyDescription="点击「新建复盘」输入市场数据和观察，使用 AI 生成结构化复盘。"
        />
      </div>
    </AppShell>
  );
}
