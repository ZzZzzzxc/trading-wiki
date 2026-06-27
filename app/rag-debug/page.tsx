import { PageHero } from '@/components/documents/page-hero';
import { AppShell } from '@/components/layout';
import { RagDebugWorkbench } from '@/components/rag/rag-debug-workbench';

export const metadata = { title: 'RAG 调试 - A 股投研助手' };

export default function RagDebugPage() {
  return (
    <AppShell currentPath="/rag-debug">
      <div className="page-stack">
        <PageHero
          title="RAG 调试"
          description="输入 query 查看本地 Markdown 切分后的 chunks、综合得分和命中片段，便于验证历史资料检索质量。"
        />
        <RagDebugWorkbench />
      </div>
    </AppShell>
  );
}
