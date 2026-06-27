import Link from 'next/link';
import { FilterableDocumentList } from '@/components/documents/filterable-document-list';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { getDocumentsByType } from '@/lib/server/documents';

export const metadata = { title: '原始素材 - A 股投研助手' };

export default async function MaterialsPage() {
  const items = await getDocumentsByType('material');

  return (
    <AppShell currentPath="/materials">
      <div className="page-stack">
        <PageHero
          title="素材库"
          description="不可变原始资料。公告、新闻、研报等来源证据，独立于研究文档，可被多次引用。"
          extra={
            <Link href="/materials/new" className="app-nav-link app-nav-link-active">
              录入素材
            </Link>
          }
        />
        <FilterableDocumentList
          items={items}
          emptyTitle="素材库为空"
          emptyDescription="点击「录入素材」添加公告、新闻、研报等原始资料，系统会在创建研究文档时自动匹配。"
        />
      </div>
    </AppShell>
  );
}
