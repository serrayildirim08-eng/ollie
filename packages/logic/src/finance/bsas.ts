/**
 * @ollie/logic · Bergen Shopping Addiction Scale (Phase 4)
 *
 * Andreassen et al. 2015, Front. Psychol. 6:1374.
 * DOI: 10.3389/fpsyg.2015.01374. Cronbach α≈0.87, n=23,537.
 * Seven items, 0–4 Likert. Polythetic cutoff: ≥3 on ≥4 items.
 *
 * §9.1  no shame framing — category is observational.
 * §9.4  scales are isolated — never composite with ollie metrics.
 * §9.5  no auto-prompt; cadence is user-initiated.
 * §9.15 every scale result carries cited_url.
 */

import type {
  BSASItem,
  BSASResult,
  ScaleHistoryEntry,
  RecordScaleResult,
  ScaleCadenceStatus,
} from './types';
import { isoDate, DAY_MS } from './math';

export const BSAS_CITED_URL = 'https://doi.org/10.3389/fpsyg.2015.01374';
const BSAS_ITEM_COUNT = 7;
const BSAS_LIKERT_MAX = 4;
const BSAS_POLYTHETIC_THRESHOLD = 3;
const BSAS_POLYTHETIC_MIN_COUNT = 4;

export const BSAS_ITEMS: readonly BSASItem[] = Object.freeze([
  { id: 'bsas1', component: 'salience',          text: 'you think about shopping/buying things all the time' },
  { id: 'bsas2', component: 'mood_modification', text: 'you shop/buy things in order to change your mood' },
  { id: 'bsas3', component: 'tolerance',         text: 'you feel you have to shop/buy more and more to obtain the same satisfaction as before' },
  { id: 'bsas4', component: 'withdrawal',        text: 'you feel bad if you for some reason are prevented from shopping/buying things' },
  { id: 'bsas5', component: 'conflict',          text: 'you shop/buy so much that it affects your daily obligations (e.g., school and work)' },
  { id: 'bsas6', component: 'relapse',           text: 'you have decided to shop/buy less, but have not been able to do so' },
  { id: 'bsas7', component: 'problems',          text: 'you shop/buy so much that it has impaired your well-being' },
]);

export function scoreBSAS(answers: number[]): BSASResult | null {
  if (!Array.isArray(answers) || answers.length !== BSAS_ITEM_COUNT) return null;
  for (const a of answers) {
    if (typeof a !== 'number' || !Number.isFinite(a)) return null;
    if (a < 0 || a > BSAS_LIKERT_MAX) return null;
    if (Math.floor(a) !== a) return null;
  }
  const score = answers.reduce((s, v) => s + v, 0);
  const atRiskCount = answers.filter((v) => v >= BSAS_POLYTHETIC_THRESHOLD).length;
  const category = atRiskCount >= BSAS_POLYTHETIC_MIN_COUNT
    ? 'at_risk_screen'
    : 'within_normal_range';
  return {
    scale: 'bsas',
    score,
    max_score: BSAS_ITEM_COUNT * BSAS_LIKERT_MAX,
    category,
    subscore_at_risk: atRiskCount,
    itemCount: BSAS_ITEM_COUNT,
    item_responses: answers.slice(),
    cited_url: BSAS_CITED_URL,
  };
}

/**
 * Appends a ScaleResult with a 30-day practice-effect guard.
 * Returns { history, appended, reason }.
 */
export function recordScaleResult(
  scaleHistory: ScaleHistoryEntry[],
  scaleName: string,
  result: BSASResult,
  now: number,
): RecordScaleResult {
  const list = Array.isArray(scaleHistory) ? scaleHistory.slice() : [];
  if (!scaleName || typeof scaleName !== 'string') {
    return { history: list, appended: false, reason: 'invalid-scale-name' };
  }
  if (!result || typeof result !== 'object' || typeof result.score !== 'number') {
    return { history: list, appended: false, reason: 'invalid-result' };
  }
  const nowMs = now;
  const cooldownMs = 30 * DAY_MS;
  const prev = list
    .filter((r) => r?.scale === scaleName)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  if (prev.length > 0) {
    const lastAt = new Date(prev[0].date + 'T12:00:00').getTime();
    if (Number.isFinite(lastAt) && nowMs - lastAt < cooldownMs) {
      const daysRemaining = Math.ceil((cooldownMs - (nowMs - lastAt)) / DAY_MS);
      return { history: list, appended: false, reason: 'cooldown', days_remaining: daysRemaining };
    }
  }
  const iso = isoDate(nowMs);
  const entry: ScaleHistoryEntry = {
    scale: scaleName,
    date: iso,
    score: result.score,
    components: {
      item_responses: Array.isArray(result.item_responses) ? result.item_responses.slice() : [],
    },
    cited_url: result.cited_url ?? '',
  };
  if (typeof result.subscore_at_risk === 'number')
    entry.components.subscore_at_risk = result.subscore_at_risk;
  if (typeof result.category === 'string')
    entry.components.category = result.category;
  list.push(entry);
  list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  return { history: list, appended: true, reason: 'ok' };
}

/**
 * §9.5 — empty history → quarterly_due = false (first admin is user-initiated).
 */
export function scaleCadenceStatus(
  scaleHistory: ScaleHistoryEntry[],
  scaleName: string,
  now: number,
): ScaleCadenceStatus {
  const list = Array.isArray(scaleHistory) ? scaleHistory : [];
  const prev = list
    .filter((r) => r?.scale === scaleName)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const CADENCE_DAYS = 90;
  const COOLDOWN_DAYS = 30;
  if (prev.length === 0) {
    return {
      last_admin_at: null,
      days_since: null,
      next_eligible_at: null,
      quarterly_due: false,
    };
  }
  const lastAt = new Date(prev[0].date + 'T12:00:00').getTime();
  const daysSince = Math.floor((now - lastAt) / DAY_MS);
  const nextEligibleTs = lastAt + COOLDOWN_DAYS * DAY_MS;
  return {
    last_admin_at: prev[0].date,
    days_since: daysSince,
    next_eligible_at: isoDate(nextEligibleTs),
    quarterly_due: daysSince >= CADENCE_DAYS,
  };
}
