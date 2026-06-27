'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/components/toast';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = '确认', cancelLabel = '取消', variant = 'default', loading = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div ref={dialogRef} style={dialogStyle} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.6 }}>{message}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="ghost-button" onClick={onCancel} disabled={loading} type="button" style={{ fontSize: 13 }}>{cancelLabel}</button>
          <button className={variant === 'danger' ? 'danger-button' : 'primary-button'} onClick={onConfirm} disabled={loading} type="button" style={{ fontSize: 13 }}>
            {loading ? '处理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 10000, padding: 20,
};

const dialogStyle: React.CSSProperties = {
  background: '#1a2332', border: '1px solid var(--border)',
  borderRadius: 16, padding: 24, maxWidth: 440, width: '100%',
  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
};
