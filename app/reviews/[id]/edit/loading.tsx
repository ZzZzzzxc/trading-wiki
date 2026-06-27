import { AppShell } from '@/components/layout';
import { PageSkeleton } from '@/components/layout/skeleton';

export default function EditReviewLoading() {
  return (
    <AppShell currentPath="/reviews">
      <div className="page-stack">
        <PageSkeleton />
      </div>
    </AppShell>
  );
}
