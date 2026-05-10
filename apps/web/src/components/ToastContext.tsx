import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

export interface ToastOptions {
  module?: string;
  ttl?: number;
}

interface ToastItem {
  id: string;
  message: string;
  module?: string;
}

interface ToastContextValue {
  show(message: string, opts?: ToastOptions): void;
  /** Internal: read by ToastHost only */
  _toasts: ToastItem[];
  _close(id: string): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const close = useCallback((id: string) => {
    const tid = timers.current.get(id);
    if (tid !== undefined) {
      clearTimeout(tid);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, opts?: ToastOptions) => {
      const id = 't_' + Math.random().toString(36).slice(2);
      const ttl = opts?.ttl ?? 4000;
      setToasts((prev) => [...prev, { id, message, module: opts?.module }]);
      if (ttl > 0) {
        const tid = setTimeout(() => {
          timers.current.delete(id);
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, ttl);
        timers.current.set(id, tid);
      }
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ show, _toasts: toasts, _close: close }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): { show(message: string, opts?: ToastOptions): void } {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return { show: ctx.show };
}

/** Internal hook for ToastHost */
export function _useToastState() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('_useToastState must be used inside <ToastProvider>');
  return { toasts: ctx._toasts, close: ctx._close };
}
