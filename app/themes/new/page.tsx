import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { ThemeWorkbench } from '@/components/themes/theme-workbench';
import { getDocumentsByType } from '@/lib/server/documents';

export const metadata = { title: '新建产业链研究 - A 股投研助手' };

export default async function NewThemePage() {
  const [materials, viewpoints, reviews, notes] = await Promise.all([
    getDocumentsByType('material'),
    getDocumentsByType('viewpoint'),
    getDocumentsByType('daily_review'),
    getDocumentsByType('note'),
  ]);

  return (
    <AppShell currentPath="/themes">
      <div className="page-stack-fluid">
        <PageHero
          title="新建产业链研究"
          description="选择素材库中的原始素材、观点蒸馏、每日复盘和个人笔记作为上下文，AI 自动生成产业链分析。可切换主题研究、投资备忘录、供应链分析三种模式。"
        />
        <ThemeWorkbench materials={[...materials, ...viewpoints, ...reviews, ...notes]} />
      </div>
    </AppShell>
  );
}
