import { AppShell } from '@/components/layout';

export default function DashboardLoading() {
  return (
    <AppShell currentPath="/dashboard">
      <div className="page-stack">
        <div className="page-hero" style={{ minHeight: 100 }}>
          <div style={{ width: 200, height: 28, background: 'rgba(143,164,194,0.1)', borderRadius: 8 }} />
          <div style={{ width: 360, height: 16, marginTop: 12, background: 'rgba(143,164,194,0.06)', borderRadius: 6 }} />
        </div>
        <div className="stat-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-card" style={{ minHeight: 90, background: 'rgba(143,164,194,0.04)' }} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
