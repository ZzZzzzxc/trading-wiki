import { AppShell } from '@/components/layout';
import { PageSkeleton } from '@/components/layout/skeleton';

export default function RagDebugLoading() {
  return (
    <AppShell currentPath="/rag-debug">
      <div className="page-stack">
        <PageSkeleton />
      </div>
    </AppShell>
  );
}
