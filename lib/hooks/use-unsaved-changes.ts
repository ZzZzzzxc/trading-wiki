'use client';
import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export function useUnsavedChangesWarning(dirty: boolean) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // beforeunload 浏览器级提示：关闭标签页 / 刷新时触发
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
