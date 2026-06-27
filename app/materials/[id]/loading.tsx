import { AppShell } from '@/components/layout';
import { PageSkeleton } from '@/components/layout/skeleton';

export default function MaterialDetailLoading() {
  return (
    <AppShell currentPath="/materials">
      <div className="page-stack">
        <PageSkeleton />
      </div>
    </AppShell>
  );
}
