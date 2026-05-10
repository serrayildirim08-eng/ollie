/**
 * @ollie/logic · Jaro–Winkler merchant similarity
 *
 * Pure string utilities. Used by detectRecurring for fuzzy merchant clustering.
 */

export function normalizeMerchant(name: string): string {
  if (typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .replace(/\.(com|net|org|co|io)\b/g, '')
    .replace(/\b(inc|llc|ltd|corp|co)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function jaroSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const win = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aM = new Array(a.length).fill(false) as boolean[];
  const bM = new Array(b.length).fill(false) as boolean[];
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - win);
    const end = Math.min(i + win + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = true;
      bM[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let trans = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) trans++;
    k++;
  }
  trans /= 2;
  return (matches / a.length + matches / b.length + (matches - trans) / matches) / 3;
}

export function jaroWinkler(a: string, b: string, p = 0.1): number {
  const j = jaroSimilarity(a, b);
  if (j === 0 || j === 1) return j;
  const maxP = 4;
  let l = 0;
  const end = Math.min(maxP, a.length, b.length);
  for (let i = 0; i < end; i++) {
    if (a[i] === b[i]) l++;
    else break;
  }
  return j + l * p * (1 - j);
}

export function merchantSimilarity(a: string, b: string): number {
  return jaroWinkler(normalizeMerchant(a), normalizeMerchant(b));
}
