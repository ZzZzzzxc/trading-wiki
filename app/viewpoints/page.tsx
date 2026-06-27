import Link from 'next/link';
import { FilterableDocumentList } from '@/components/documents/filterable-document-list';
import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { getDocumentsByType } from '@/lib/server/documents';
import {
  getViewpointStanceLabel,
} from '@/lib/utils/display';

export const metadata = { title: '观点蒸馏 - A 股投研助手' };

export default async function ViewpointsPage() {
  const items = await getDocumentsByType('viewpoint');

  return (
    <AppShell currentPath="/viewpoints">
      <div className="page-stack">
        <PageHero
          title="关注人观点"
          description="粘贴关注人发言，AI 蒸馏结构化观点，保存为本地 Markdown。"
          extra={
            <Link href="/viewpoints/new" className="app-nav-link app-nav-link-active">
              新建观点
            </Link>
          }
        />
        <FilterableDocumentList
          items={items}
          emptyTitle="还没有观点文档"
          emptyDescription="点击「新建观点」粘贴关注人发言，使用 AI 蒸馏结构化观点。"
          filterConfig={{
            showAuthor: true,
            showPlatform: true,
            showStance: true,
            stanceOptions: ['bullish', 'bearish', 'neutral', 'watch'].map((s) => ({
              value: s,
              label: getViewpointStanceLabel(s as 'bullish' | 'bearish' | 'neutral' | 'watch'),
            })),
          }}
        />
      </div>
    </AppShell>
  );
}
