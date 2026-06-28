import { ResearchWorkbench } from '@/components/research/research-workbench';
import { AppShell } from '@/components/layout';
import { PageHero } from '@/components/documents/page-hero';

export default function ResearchPage() {
  return (
    <AppShell currentPath="/research">
      <div className="page-stack-fluid">
        <PageHero
          title="深度研究"
          description="AI 研究助手：多步工具调用、交叉验证、深度报告。输入问题后自动搜索知识库、阅读文档、查询断言，生成结构化的研究报告。"
        />
        <ResearchWorkbench />
      </div>
    </AppShell>
  );
}
