'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/toast';

interface DeleteButtonProps {
  documentId: string;
  /** 删除后跳转的路径 */
  redirectTo?: string;
}

export function DeleteButton({ documentId, redirectTo = '/dashboard' }: DeleteButtonProps) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  async function handleDelete() {
    setDeleting(true);
    setError('');

    try {
      const response = await fetch('/api/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: documentId }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : '删除失败');
      }

      showToast('文档已删除', 'success');

      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      setError(msg);
      showToast(msg, 'error');
      setDeleting(false);
      setShowConfirm(false);
    }
  }

  if (showConfirm) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>确认删除？</span>
        <button
          className="primary-button"
          style={{
            borderColor: 'rgba(255, 143, 143, 0.3)',
            background: 'rgba(255, 143, 143, 0.15)',
          }}
          disabled={deleting}
          onClick={handleDelete}
          type="button"
        >
          {deleting ? '删除中...' : '确认'}
        </button>
        <button
          className="primary-button"
          disabled={deleting}
          onClick={() => setShowConfirm(false)}
          type="button"
        >
          取消
        </button>
        {error ? <span style={{ color: '#ffb3b3', fontSize: 13 }}>{error}</span> : null}
      </div>
    );
  }

  return (
    <button
      className="primary-button"
      style={{
        borderColor: 'rgba(255, 143, 143, 0.2)',
        background: 'rgba(255, 143, 143, 0.08)',
      }}
      onClick={() => setShowConfirm(true)}
      type="button"
    >
      删除文档
    </button>
  );
}
