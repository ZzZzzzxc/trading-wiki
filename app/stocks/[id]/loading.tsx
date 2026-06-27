import { AppShell } from '@/components/layout';
import { PageSkeleton } from '@/components/layout/skeleton';

export default function StockDetailLoading() {
  return (
    <AppShell currentPath="/stocks">
      <div className="page-stack">
        <PageSkeleton />
      </div>
    </AppShell>
  );
}
