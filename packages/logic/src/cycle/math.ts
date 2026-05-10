/**
 * @ollie/logic · pure stats helpers
 *
 * Shared by all cycle stat layers. Operate on number[]; no assumptions
 * about sorting or non-emptiness — callers must validate input.
 */

export const sum = (arr: number[]): number => arr.reduce((a, b) => a + b, 0);
export const mean = (arr: number[]): number => sum(arr) / arr.length;
export const variance = (arr: number[]): number => {
  const m = mean(arr);
  return arr.reduce((acc, x) => acc + (x - m) ** 2, 0) / arr.length;
};
export const sampleSd = (arr: number[]): number => Math.sqrt(variance(arr));
export const median = (arr: number[]): number => {
  const sorted = [...arr].sort((x, y) => x - y);
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};
