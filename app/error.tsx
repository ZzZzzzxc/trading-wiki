'use client';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <h2>页面出错了</h2>
      <p style={{ color: 'var(--muted)', margin: '12px 0' }}>{error.message}</p>
      <button className="primary-button" onClick={reset}>
        重试
      </button>
    </div>
  );
}
