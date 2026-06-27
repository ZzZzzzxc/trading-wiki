import Link from 'next/link';
import { FilterableDocumentList } from '@/components/documents/filterable-document-list';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { getDocumentsByType } from '@/lib/server/documents';

export const metadata = { title: '个人笔记 - A 股投研助手' };

export default async function NotesPage() {
  const items = await getDocumentsByType('note');

  return (
    <AppShell currentPath="/notes">
      <div className="page-stack">
        <PageHero
          title="个人笔记"
          description="自由创建和编辑 Markdown 投研笔记，支持主题、个股和标签归档。"
          extra={
            <Link href="/notes/new" className="app-nav-link app-nav-link-active">
              新建笔记
            </Link>
          }
        />
        <FilterableDocumentList
          items={items}
          emptyTitle="还没有个人笔记"
          emptyDescription="点击「新建笔记」创建 Markdown 笔记，支持主题、股票和标签归档。"
        />
      </div>
    </AppShell>
  );
}
