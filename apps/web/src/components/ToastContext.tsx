import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

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
  // Audit-fix #15: previously `return { show: ctx.show }` allocated a fresh
  // object every render. Consumers that list `toast` in a `useCallback` /
  // `useEffect` dependency array (notably `useApplyBrainDump`) then re-ran
  // their effects/memos on every render. `ctx.show` is itself stable (a
  // `useCallback([])` in the provider), so memoizing the wrapper on it
  // yields a reference that is stable for the lifetime of the provider.
  return useMemo(() => ({ show: ctx.show }), [ctx.show]);
}

/** Internal hook — read by ToastHost only. Name must start with `use`
 *  so React's Rules of Hooks lint recognises it as a hook. */
export function useToastState() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToastState must be used inside <ToastProvider>');
  return { toasts: ctx._toasts, close: ctx._close };
}
