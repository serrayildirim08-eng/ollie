import { useEffect, useState } from 'react';

/**
 * Reactive `prefers-reduced-motion` hook. Shared by Burhan3D + Garden3DScene
 * so both honour the same OS preference without duplicating the listener
 * pair in every component.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** Pause GPU work while the tab is hidden. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    return !document.hidden;
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
}
