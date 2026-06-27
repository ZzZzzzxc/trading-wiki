import { AppShell } from '@/components/layout';
import { ListSkeleton } from '@/components/layout/skeleton';

export default function MaterialsLoading() {
  return (
    <AppShell currentPath="/materials">
      <div className="page-stack">
        <div className="page-hero" style={{ minHeight: 80 }} />
        <ListSkeleton count={5} />
      </div>
    </AppShell>
  );
}
