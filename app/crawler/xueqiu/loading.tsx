import { AppShell } from '@/components/layout';
import { PageSkeleton } from '@/components/layout/skeleton';

export default function XueqiuLoading() {
  return (
    <AppShell currentPath="/crawler/xueqiu">
      <div className="page-stack-fluid">
        <PageSkeleton />
      </div>
    </AppShell>
  );
}
