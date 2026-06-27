import { AppShell } from '@/components/layout';
import { PageSkeleton } from '@/components/layout/skeleton';

export default function NewStockLoading() {
  return (
    <AppShell currentPath="/stocks">
      <div className="page-stack">
        <PageSkeleton />
      </div>
    </AppShell>
  );
}
