import { AppShell } from '@/components/layout';
import { PageSkeleton } from '@/components/layout/skeleton';

export default function NoteDetailLoading() {
  return (
    <AppShell currentPath="/notes">
      <div className="page-stack">
        <PageSkeleton />
      </div>
    </AppShell>
  );
}
