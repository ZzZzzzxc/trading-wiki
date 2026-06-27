import { AppShell } from '@/components/layout';
import { ListSkeleton } from '@/components/layout/skeleton';

export default function ViewpointsLoading() {
  return (
    <AppShell currentPath="/viewpoints">
      <div className="page-stack">
        <div className="page-hero" style={{ minHeight: 80 }} />
        <ListSkeleton count={5} />
      </div>
    </AppShell>
  );
}
