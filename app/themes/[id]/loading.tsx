import { AppShell } from '@/components/layout';
import { PageSkeleton } from '@/components/layout/skeleton';

export default function ThemeDetailLoading() {
  return (
    <AppShell currentPath="/themes">
      <div className="page-stack">
        <PageSkeleton />
      </div>
    </AppShell>
  );
}
