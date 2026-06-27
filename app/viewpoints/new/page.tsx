import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { ViewpointWorkbench } from '@/components/viewpoints/viewpoint-workbench';

export const metadata = { title: '新建观点 - A 股投研助手' };

export default function NewViewpointPage() {
  return (
    <AppShell currentPath="/viewpoints">
      <div className="page-stack-fluid">
        <PageHero
          title="新建观点"
          description="粘贴关注人的原始发言，调用 DeepSeek 做结构化蒸馏。结果生成后仍需要人工编辑确认，再保存为本地 Markdown。"
        />
        <ViewpointWorkbench />
      </div>
    </AppShell>
  );
}
