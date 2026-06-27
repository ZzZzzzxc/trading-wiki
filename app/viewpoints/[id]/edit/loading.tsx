import { AppShell } from '@/components/layout';
import { PageSkeleton } from '@/components/layout/skeleton';

export default function EditViewpointLoading() {
  return (
    <AppShell currentPath="/viewpoints">
      <div className="page-stack">
        <PageSkeleton />
      </div>
    </AppShell>
  );
}
