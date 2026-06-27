import { AppShell } from '@/components/layout';
import { PageSkeleton } from '@/components/layout/skeleton';

export default function FactsLoading() {
  return (
    <AppShell currentPath="/facts">
      <div className="page-stack">
        <PageSkeleton />
      </div>
    </AppShell>
  );
}
