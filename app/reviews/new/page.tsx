import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { ReviewWorkbench } from '@/components/reviews/review-workbench';
import { getDocumentsByType } from '@/lib/server/documents';

export const metadata = { title: '新建复盘 - A 股投研助手' };

export default async function NewReviewPage() {
  const viewpoints = await getDocumentsByType('viewpoint');

  return (
    <AppShell currentPath="/reviews">
      <div className="page-stack-fluid">
        <PageHero
          title="新建复盘"
          description="输入当日市场摘要、板块表现、新闻催化和个人观察，可选择最近观点作为上下文，生成结构化复盘后再人工编辑保存。"
        />
        <ReviewWorkbench
          viewpoints={viewpoints.map((item) => ({
            id: item.id,
            title: item.title,
            summary: item.summary,
            author: item.author,
            date: item.date,
          }))}
        />
      </div>
    </AppShell>
  );
}
