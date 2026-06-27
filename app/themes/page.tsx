import Link from 'next/link';
import { FilterableDocumentList } from '@/components/documents/filterable-document-list';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { getDocumentsByType } from '@/lib/server/documents';

export const metadata = { title: '产业链研究 - A 股投研助手' };

export default async function ThemesPage() {
  const items = await getDocumentsByType('theme_research');

  return (
    <AppShell currentPath="/themes">
      <div className="page-stack">
        <PageHero
          title="产业链研究"
          description="产业/主题的产业链分析，包含资金流、实物流、利润流、卡点、核心公司和催化日历。支持主题研究、投资备忘录、供应链分析三种研究模式。"
          extra={
            <Link href="/themes/new" className="app-nav-link app-nav-link-active">
              新建研究
            </Link>
          }
        />
        <FilterableDocumentList
          items={items}
          emptyTitle="还没有产业链研究"
          emptyDescription="点击「新建研究」从素材库中选择资料，使用 AI 生成结构化研究。"
        />
      </div>
    </AppShell>
  );
}
