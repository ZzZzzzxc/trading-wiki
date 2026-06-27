import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { StockWorkbench } from '@/components/stocks/stock-workbench';
import { getDocumentsByType } from '@/lib/server/documents';

export const metadata = { title: '新建个股档案 - A 股投研助手' };

export default async function NewStockPage() {
  const [viewpoints, reviews, notes, materials] = await Promise.all([
    getDocumentsByType('viewpoint'),
    getDocumentsByType('daily_review'),
    getDocumentsByType('note'),
    getDocumentsByType('material'),
  ]);

  return (
    <AppShell currentPath="/stocks">
      <div className="page-stack-fluid">
        <PageHero
          title="新建个股档案"
          description="选择素材库中的原始素材、观点蒸馏、每日复盘和个人笔记作为上下文，AI 自动生成结构化档案。"
        />
        <StockWorkbench
          viewpoints={viewpoints.map((item) => ({
            id: item.id,
            title: item.title,
            summary: item.summary,
            author: item.author,
            date: item.date,
            themes: item.themes,
          }))}
          materials={[...materials, ...reviews, ...notes]}
        />
      </div>
    </AppShell>
  );
}
