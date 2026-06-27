import Link from 'next/link';
import { FilterableDocumentList } from '@/components/documents/filterable-document-list';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { getDocumentsByType } from '@/lib/server/documents';

export const metadata = { title: '个股档案 - A 股投研助手' };

export default async function StocksPage() {
  const items = await getDocumentsByType('stock_profile');

  return (
    <AppShell currentPath="/stocks">
      <div className="page-stack">
        <PageHero
          title="个股档案"
          description="个股的详细档案，包含公司主营、产业链位置、上涨逻辑、催化事件、风险点和个人判断。"
          extra={
            <Link href="/stocks/new" className="app-nav-link app-nav-link-active">
              新建个股档案
            </Link>
          }
        />
        <FilterableDocumentList
          items={items}
          emptyTitle="还没有个股档案"
          emptyDescription="点击「新建个股档案」粘贴公司资料，使用 AI 生成结构化档案。"

        />
      </div>
    </AppShell>
  );
}
