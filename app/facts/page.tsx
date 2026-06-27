import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { FactWorkbench } from '@/components/facts/fact-workbench';

export const metadata = { title: '可验证断言 - A 股投研助手' };

export default function FactsPage() {
  return (
    <AppShell currentPath="/facts">
      <div className="page-stack">
        <PageHero
          title="可验证断言"
          description="记录和跟踪投研中的可验证断言。设置多窗口验证（1/3/5/10/20日），追踪预测准确率。"
        />
        <FactWorkbench />
      </div>
    </AppShell>
  );
}
