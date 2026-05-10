/**
 * @ollie/logic · finance math helpers
 *
 * Pure stat functions. No side-effects, no wall-clock reads, no I/O.
 */

export const DAY_MS = 86_400_000;

export function isoDate(ms: number): string {
  const d = new Date(ms);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

export function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / DAY_MS,
  );
}

export function fMean(a: number[]): number | null {
  if (!a || !a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

export function fMedian(a: number[]): number | null {
  if (!a || !a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Raw MAD (unscaled). Rousseeuw & Croux 1993: σ ≈ 1.4826·MAD. */
export function fMad(a: number[], center?: number): number {
  if (!a || !a.length) return 0;
  const c = center != null ? center : (fMedian(a) ?? 0);
  return 1.4826 * (fMedian(a.map((x) => Math.abs(x - c))) ?? 0);
}
