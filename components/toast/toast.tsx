'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useRef,
  type ReactNode,
} from 'react';

// ---- Types ----

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  leaving: boolean;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

// ---- Context ----

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

// ---- Styles ----

const TYPE_STYLES: Record<ToastType, { background: string; border: string; color: string }> = {
  success: {
    background: 'rgba(111,210,169,0.15)',
    border: '1px solid rgba(111,210,169,0.3)',
    color: '#8cd8b0',
  },
  error: {
    background: 'rgba(224,144,144,0.15)',
    border: '1px solid rgba(224,144,144,0.3)',
    color: '#e09090',
  },
  info: {
    background: 'rgba(126,184,255,0.15)',
    border: '1px solid rgba(126,184,255,0.3)',
    color: '#7eb8ff',
  },
};

// ---- Component ----

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idCounter = useRef(0);

  const removeToast = useCallback((id: string) => {
    // 先标记为 leaving 触发消失动画
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
    // 动画结束后再真正移除 DOM 节点
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = `toast-${++idCounter.current}`;
      setToasts((prev) => [...prev, { id, message, type, leaving: false }]);

      // 3 秒后自动消失
      setTimeout(() => {
        removeToast(id);
      }, 3000);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast 容器 — 固定于右下角 */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((toast) => {
          const style = TYPE_STYLES[toast.type];
          return (
            <div
              key={toast.id}
              onClick={() => removeToast(toast.id)}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                borderRadius: 12,
                padding: '12px 16px',
                fontSize: 13,
                lineHeight: 1.5,
                maxWidth: 360,
                wordBreak: 'break-word',
                background: style.background,
                border: style.border,
                color: style.color,
                animation: toast.leaving
                  ? 'toast-fadeout 300ms ease forwards'
                  : 'toast-slidein 300ms ease',
              }}
            >
              {toast.message}
            </div>
          );
        })}
      </div>

      {/* Keyframes 注入 — 只注入一次 */}
      <style>{`
        @keyframes toast-slidein {
          from {
            opacity: 0;
            transform: translateX(24px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes toast-fadeout {
          from {
            opacity: 1;
            transform: translateX(0);
          }
          to {
            opacity: 0;
            transform: translateX(24px);
          }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
