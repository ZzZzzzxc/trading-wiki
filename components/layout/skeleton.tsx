// 通用骨架屏组件，在 loading.tsx 中复用

export function CardSkeleton({ width = '100%', height = 120 }: { width?: string; height?: number }) {
  return <div className="skeleton" style={{ width, height, borderRadius: 12, marginBottom: 12 }} />;
}

export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div style={{ padding: 24 }}>
      <CardSkeleton width="60%" height={28} />
      <div style={{ height: 16 }} />
      <CardSkeleton height={80} />
      <CardSkeleton height={200} />
    </div>
  );
}
