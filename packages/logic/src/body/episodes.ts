/**
 * @ollie/logic · body episode helpers
 *
 * Pure helpers for illness episode tracking.
 * Ported from void-app.html window.VOID.logic.body.episodes (~lines 9981–10628).
 *
 * Pure: no store / DOM / wall-clock reads. `now` is always injected.
 */

import type {
  Episode,
  EpisodeKind,
  SeverityEntry,
  MedEntry,
  EpisodeSummary,
  EpisodeDurationPattern,
  EpisodeTriggerPattern,
  EpisodeRecurrencePattern,
  MedicationAdherencePattern,
} from './types';

import { STRESS_RE } from './regexes';

// ─── ID generation ────────────────────────────────────────────────────────────

export function newEpisodeId(ts: number, randomFn?: () => string): string {
  const r = typeof randomFn === 'function'
    ? randomFn()
    : Math.random().toString(36).slice(2, 8);
  return 'ep_' + ts + '_' + r;
}

// ─── CRUD helpers ─────────────────────────────────────────────────────────────

export interface OpenEpisodeOpts {
  now?: number;
  randomFn?: () => string;
  symptoms?: string[];
  tags?: string[];
}

export function openEpisode(
  label: string,
  kind: EpisodeKind | string,
  opts?: OpenEpisodeOpts,
): Episode {
  const o = opts || {};
  const now = typeof o.now === 'number' ? o.now : Date.now();
  return {
    id: newEpisodeId(now, o.randomFn),
    started_at: now,
    ended_at: undefined,
    label: String(label || ''),
    kind: kind || 'acute',
    symptoms: Array.isArray(o.symptoms) ? o.symptoms.slice() : [],
    meds: [],
    severity_log: [],
    notes: [],
    tags: Array.isArray(o.tags) ? o.tags.slice() : [],
  };
}

/**
 * Canonical "start an episode" entry point.
 *
 * Takes the current `body.episodes` array and returns a NEW array with the
 * freshly-opened episode appended. This is the primary path the Body module's
 * "log an episode" flow uses — UI never mutates the array by hand.
 *
 * Pure: no store / DOM. `now` is injected via opts.
 */
export function startEpisode(
  episodes: Episode[] | null | undefined,
  label: string,
  kind: EpisodeKind | string,
  opts?: OpenEpisodeOpts,
): Episode[] {
  const list = Array.isArray(episodes) ? episodes : [];
  const ep = openEpisode(label, kind, opts);
  return list.concat([ep]);
}

/**
 * Defensive normalizer. Brain-dump routing (and legacy data) may write
 * episode-shaped objects that are missing required fields — e.g.
 * `{ id, text, ts }` with no `started_at` / `severity_log` / `label` / `kind`.
 *
 * `normalizeEpisode` backfills every required field so downstream helpers
 * (activeEpisode / elapsedDays / summarizeEpisode / generateDoctorSummary)
 * and the UI never see a malformed Episode. It is idempotent: a valid
 * Episode is returned unchanged in shape.
 *
 * Field recovery rules:
 *   - started_at  ← started_at | opened_at | ts | now
 *   - label       ← label | text (truncated) | 'episode'
 *   - kind        ← kind | 'acute'
 *   - arrays      ← coerced to [] when missing/non-array
 *   - ended_at    ← preserved iff a finite number, else undefined (still open)
 */
export function normalizeEpisode(
  raw: unknown,
  opts?: { now?: number },
): Episode {
  const now = typeof opts?.now === 'number' ? opts.now : Date.now();
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && isFinite(v) ? v : undefined;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  const startedAt =
    num(o.started_at) ?? num(o.opened_at) ?? num(o.ts) ?? now;

  let label = '';
  if (typeof o.label === 'string' && o.label.trim()) {
    label = o.label.trim();
  } else if (typeof o.text === 'string' && o.text.trim()) {
    // Brain-dump entries store free text under `text`. Use a short slice
    // as the label so the card has something human-readable.
    const t = o.text.trim();
    label = t.length > 60 ? t.slice(0, 57) + '…' : t;
  } else {
    label = 'episode';
  }

  const kind: EpisodeKind | string =
    typeof o.kind === 'string' && o.kind ? o.kind : 'acute';

  const id =
    typeof o.id === 'string' && o.id ? o.id : newEpisodeId(startedAt);

  const severityLog = arr<SeverityEntry>(o.severity_log).filter(
    (e) => e && typeof e.ts === 'number' && typeof e.severity === 'number',
  );
  const meds = arr<MedEntry>(o.meds).filter(
    (m) => m && typeof m.ts === 'number' && typeof m.name === 'string',
  );
  const notes = arr<unknown>(o.notes)
    .filter((n) => typeof n === 'string')
    .map((n) => n as string);
  const symptoms = arr<unknown>(o.symptoms)
    .filter((s) => typeof s === 'string')
    .map((s) => s as string);
  const tags = arr<unknown>(o.tags)
    .filter((t) => typeof t === 'string')
    .map((t) => t as string);

  // A free-text brain-dump entry IS the first note if it isn't the label.
  if (typeof o.text === 'string' && o.text.trim() && o.text.trim() !== label) {
    notes.unshift(o.text.trim());
  }

  const ep: Episode = {
    id,
    started_at: startedAt,
    label,
    kind,
    symptoms,
    meds,
    severity_log: severityLog,
    notes,
    tags,
  };
  const endedAt = num(o.ended_at);
  if (endedAt != null) ep.ended_at = endedAt;
  if (typeof o.source === 'string') ep.source = o.source;
  return ep;
}

/**
 * Returns `true` when `raw` is already a structurally-valid Episode —
 * i.e. `normalizeEpisode` would not have to backfill anything load-bearing.
 * Used by the orchestrator to skip rewriting already-clean arrays.
 */
export function isWellFormedEpisode(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return (
    typeof o.id === 'string' && o.id.length > 0 &&
    typeof o.started_at === 'number' && isFinite(o.started_at) &&
    typeof o.label === 'string' &&
    typeof o.kind === 'string' &&
    Array.isArray(o.severity_log) &&
    Array.isArray(o.meds) &&
    Array.isArray(o.notes) &&
    Array.isArray(o.symptoms) &&
    Array.isArray(o.tags)
  );
}

export function logSeverity(
  episode: Episode,
  severity: number,
  opts?: { now?: number; note?: string },
): Episode {
  const o = opts || {};
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const entry: SeverityEntry = { ts: now, severity };
  if (o.note != null) entry.note = String(o.note);
  return { ...episode, severity_log: (episode.severity_log || []).concat([entry]) };
}

export function logMed(
  episode: Episode,
  name: string,
  opts?: { now?: number; dose?: string },
): Episode {
  const o = opts || {};
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const entry: MedEntry = { ts: now, name: String(name || '') };
  if (o.dose != null) entry.dose = String(o.dose);
  return { ...episode, meds: (episode.meds || []).concat([entry]) };
}

export function logNote(episode: Episode, text: string): Episode {
  return { ...episode, notes: (episode.notes || []).concat([String(text || '')]) };
}

export function closeEpisode(
  episode: Episode,
  opts?: { now?: number },
): Episode {
  const now = typeof opts?.now === 'number' ? opts.now : Date.now();
  return { ...episode, ended_at: now };
}

export function activeEpisode(episodes: Episode[]): Episode | null {
  if (!Array.isArray(episodes)) return null;
  let best: Episode | null = null;
  for (const ep of episodes) {
    if (!ep || ep.ended_at != null) continue;
    if (!best || (ep.started_at || 0) > (best.started_at || 0)) best = ep;
  }
  return best;
}

export function elapsedDays(episode: Episode, now: number): number {
  if (!episode || typeof episode.started_at !== 'number') return 0;
  return Math.floor((now - episode.started_at) / 86400000);
}

export function summarizeEpisode(
  episode: Episode,
  opts?: { now?: number },
): EpisodeSummary {
  const now = typeof opts?.now === 'number' ? opts.now : Date.now();
  const end = typeof episode.ended_at === 'number' ? episode.ended_at : now;
  const start = typeof episode.started_at === 'number' ? episode.started_at : end;
  const sev = Array.isArray(episode.severity_log) ? episode.severity_log : [];
  const meds = Array.isArray(episode.meds) ? episode.meds : [];
  const notes = Array.isArray(episode.notes) ? episode.notes : [];
  const symptoms = Array.isArray(episode.symptoms) ? episode.symptoms.slice() : [];

  let max = 0, sum = 0;
  for (const e of sev) {
    const s = typeof e.severity === 'number' ? e.severity : 0;
    if (s > max) max = s;
    sum += s;
  }
  const mean = sev.length > 0 ? sum / sev.length : 0;

  const uniqMeds: Record<string, boolean> = {};
  for (const m of meds) {
    if (m && m.name) uniqMeds[m.name] = true;
  }

  return {
    duration_days: Math.floor((end - start) / 86400000),
    max_severity: max,
    mean_severity: mean,
    n_severity_logs: sev.length,
    n_meds: meds.length,
    unique_meds: Object.keys(uniqMeds).length,
    n_notes: notes.length,
    symptoms,
  };
}

// ─── Chronic condition matching ───────────────────────────────────────────────

export function matchChronicCondition(
  label: string,
  conditions: string[],
): string | null {
  if (typeof label !== 'string' || !Array.isArray(conditions) || conditions.length === 0) return null;
  const lower = label.toLowerCase().trim();
  if (!lower) return null;
  for (const c of conditions) {
    if (typeof c !== 'string') continue;
    const cLower = c.toLowerCase().trim();
    if (!cLower) continue;
    if (lower === cLower || lower.includes(cLower) || cLower.includes(lower)) return c;
  }
  return null;
}

export function suggestEpisodeKind(
  label: string,
  conditions: string[],
  fallback?: EpisodeKind | string,
): EpisodeKind | string {
  const matched = matchChronicCondition(label, conditions);
  return matched ? 'chronic' : (fallback || 'acute');
}

// ─── Pattern detectors ────────────────────────────────────────────────────────

function matchLabel(ep: Episode, label: string | null): boolean {
  if (!label) return true;
  const a = String((ep && ep.label) || '').toLowerCase();
  return a.indexOf(String(label).toLowerCase()) >= 0;
}

export function detectDurationDistribution(
  episodes: Episode[],
  opts?: { now?: number; minHistory?: number; label?: string | null },
): EpisodeDurationPattern | null {
  const o = opts || {};
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const minHistory = typeof o.minHistory === 'number' ? o.minHistory : 4;
  const label = o.label || null;

  const list = Array.isArray(episodes) ? episodes : [];
  const closed = list.filter(ep =>
    ep && typeof ep.started_at === 'number' && typeof ep.ended_at === 'number' && matchLabel(ep, label)
  );
  if (closed.length < minHistory) return null;

  const durations = closed.map(ep => (ep.ended_at! - ep.started_at) / 86400000);
  const n = durations.length;
  let sum = 0;
  for (const d of durations) sum += d;
  const mean = sum / n;
  let sse = 0;
  for (const d of durations) sse += (d - mean) * (d - mean);
  const sd = n > 1 ? Math.sqrt(sse / (n - 1)) : 0;

  let active: Episode | null = null;
  for (const ep of list) {
    if (!ep || ep.ended_at != null) continue;
    if (!matchLabel(ep, label)) continue;
    if (typeof ep.started_at !== 'number') continue;
    if (!active || ep.started_at > active.started_at) active = ep;
  }
  const currentDays = active ? (now - active.started_at) / 86400000 : null;
  const threshold = mean + 1.5 * sd;
  if (currentDays == null || currentDays <= threshold) return null;

  const labelOut = label || (active && active.label) || (closed[0] && closed[0].label) || 'episode';
  return {
    pattern: 'episode_duration_distribution',
    label: labelOut,
    history_n: n,
    mean_days: Number(mean.toFixed(1)),
    sd_days: Number(sd.toFixed(1)),
    current_days: Number(currentDays.toFixed(1)),
    outlier: 'long',
    copy:
      `son ${n} ${labelOut} epizodu ortalama ${mean.toFixed(1)} gün sürdü. ` +
      `şu anki ${currentDays.toFixed(1)}. uzun sürüyor — pattern, not cause.`,
    source: {
      citation: 'Bryant et al. 2008, Pain — Recurrence and longitudinal stability of chronic pain',
      url: 'https://doi.org/10.1016/j.pain.2008.04.005',
    },
  };
}

export interface TriggerHistory {
  sleepRecords?: Array<{ night_of: string; tst_min: number }>;
  cyclePhases?: Array<{ ts: number; phase: string }>;
  dumps?: Array<{ ts: number; rawText?: string; text?: string }>;
}

export function detectTriggerCorrelation(
  episodes: Episode[],
  history: TriggerHistory,
  opts?: { now?: number; minEpisodes?: number; lookbackDays?: number; label?: string | null },
): EpisodeTriggerPattern | null {
  const o = opts || {};
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const minEpisodes = typeof o.minEpisodes === 'number' ? o.minEpisodes : 4;
  const lookbackDays = typeof o.lookbackDays === 'number' ? o.lookbackDays : 7;
  const label = o.label || null;

  const list = Array.isArray(episodes) ? episodes : [];
  const filtered = list.filter(ep => ep && typeof ep.started_at === 'number' && matchLabel(ep, label));
  if (filtered.length < minEpisodes) return null;

  const h = history || {};
  const sleepRecords = Array.isArray(h.sleepRecords) ? h.sleepRecords : [];
  const cyclePhases = Array.isArray(h.cyclePhases) ? h.cyclePhases : [];
  const dumps = Array.isArray(h.dumps) ? h.dumps : [];

  const sleepByDay: Record<string, number> = {};
  for (const r of sleepRecords) {
    if (!r || typeof r.night_of !== 'string' || typeof r.tst_min !== 'number') continue;
    sleepByDay[r.night_of] = r.tst_min;
  }
  const sortedPhases = cyclePhases
    .filter(p => p && typeof p.ts === 'number' && typeof p.phase === 'string')
    .sort((a, b) => a.ts - b.ts);
  const phaseAt = (ts: number): string | null => {
    let cur: string | null = null;
    for (const p of sortedPhases) {
      if (p.ts <= ts) cur = p.phase;
      else break;
    }
    return cur;
  };

  const dKey = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  let nLowSleep = 0, nStress = 0, nLuteal = 0;
  const totalEps = filtered.length;
  for (const ep of filtered) {
    const epStart = ep.started_at;
    const winStart = epStart - lookbackDays * 86400000;

    let sleepSum = 0, sleepN = 0;
    for (let i = 0; i < lookbackDays; i++) {
      const t = epStart - (i + 1) * 86400000;
      const k = dKey(t);
      if (sleepByDay[k] != null) { sleepSum += sleepByDay[k]; sleepN++; }
    }
    if (sleepN > 0 && (sleepSum / sleepN) < 360) nLowSleep++;

    let stressed = false;
    for (const d of dumps) {
      if (!d || typeof d.ts !== 'number') continue;
      if (d.ts < winStart || d.ts >= epStart) continue;
      const text = String(d.rawText || d.text || '');
      if (STRESS_RE.test(text)) { stressed = true; break; }
    }
    if (stressed) nStress++;

    let luteal = false;
    for (let i = 0; i <= lookbackDays; i++) {
      const t = epStart - i * 86400000;
      if (phaseAt(t) === 'luteal') { luteal = true; break; }
    }
    if (luteal) nLuteal++;
  }

  const candidates = [
    { trigger: 'low_sleep', count: nLowSleep },
    { trigger: 'stress', count: nStress },
    { trigger: 'luteal', count: nLuteal },
  ];
  candidates.sort((a, b) => b.count - a.count);
  const top = candidates[0];
  const matchRate = totalEps > 0 ? top.count / totalEps : 0;
  if (matchRate < 0.6) return null;

  const trMap: Record<string, string> = {
    low_sleep: 'uyku 6 saatin altındaydı',
    stress: 'stres yazmıştın',
    luteal: 'luteal fazdaydı',
  };
  const labelOut = label || (filtered[0] && filtered[0].label) || 'episode';
  return {
    pattern: 'episode_trigger_correlation',
    label: labelOut,
    episodes_observed: totalEps,
    trigger: top.trigger,
    match_rate: Number(matchRate.toFixed(2)),
    copy:
      `son ${totalEps} ${labelOut} epizodundan ${top.count}'inde önceki hafta ` +
      `${trMap[top.trigger]}. pattern, not cause.`,
    source: {
      citation: 'Hauge et al. 2010, Cephalalgia — Trigger factors in migraine',
      url: 'https://doi.org/10.1111/j.1468-2982.2009.01930.x',
    },
  };
}

export function detectRecurrenceRhythm(
  episodes: Episode[],
  opts?: { now?: number; minEpisodes?: number; jitterTolerance?: number; label?: string | null },
): EpisodeRecurrencePattern | null {
  const o = opts || {};
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const minEpisodes = typeof o.minEpisodes === 'number' ? o.minEpisodes : 4;
  const jitterTolerance = typeof o.jitterTolerance === 'number' ? o.jitterTolerance : 0.3;
  const label = o.label || null;

  const list = Array.isArray(episodes) ? episodes : [];
  const filtered = list.filter(ep => ep && typeof ep.started_at === 'number' && matchLabel(ep, label));
  if (filtered.length < minEpisodes) return null;

  const sorted = filtered.slice().sort((a, b) => a.started_at - b.started_at);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push((sorted[i].started_at - sorted[i - 1].started_at) / 86400000);
  }
  if (intervals.length < 2) return null;

  const n = intervals.length;
  let sum = 0;
  for (const v of intervals) sum += v;
  const mean = sum / n;
  let sse = 0;
  for (const v of intervals) sse += (v - mean) * (v - mean);
  const sd = n > 1 ? Math.sqrt(sse / (n - 1)) : 0;
  if (mean <= 0) return null;
  const cv = sd / mean;
  if (cv > jitterTolerance) return null;

  const lastStart = sorted[sorted.length - 1].started_at;
  const predictedNextTs = lastStart + mean * 86400000;
  const daysUntilNext = Math.round((predictedNextTs - now) / 86400000);
  const daysSince = Math.floor((now - lastStart) / 86400000);

  const labelOut = label || (sorted[0] && sorted[0].label) || 'episode';
  return {
    pattern: 'episode_recurrence_rhythm',
    label: labelOut,
    episodes_observed: sorted.length,
    mean_interval_days: Number(mean.toFixed(1)),
    cv: Number(cv.toFixed(3)),
    predicted_next_ts: predictedNextTs,
    days_until_next: daysUntilNext,
    copy:
      `${labelOut} ortalama ${mean.toFixed(1)} günde bir dönüyor. ` +
      `son episode'dan ${daysSince} gün geçti — yaklaşıyor olabilir. pattern, not cause.`,
    source: {
      citation: 'Stewart et al. 2008, Cephalalgia — Population variation in migraine',
      url: 'https://doi.org/10.1111/j.1468-2982.2008.01666.x',
    },
  };
}

export function detectMedicationAdherence(
  episode: Episode,
  opts?: { now?: number; minLogs?: number; gapMultiplier?: number },
): MedicationAdherencePattern | null {
  const o = opts || {};
  if (!episode || typeof episode.started_at !== 'number') return null;
  if (episode.ended_at != null) return null;
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const minLogs = typeof o.minLogs === 'number' ? o.minLogs : 3;
  const gapMultiplier = typeof o.gapMultiplier === 'number' ? o.gapMultiplier : 1.5;
  const meds = Array.isArray(episode.meds) ? episode.meds : [];
  if (meds.length < minLogs) return null;

  const byName: Record<string, number[]> = {};
  for (const m of meds) {
    if (!m || typeof m.ts !== 'number' || !m.name) continue;
    const k = String(m.name);
    if (!byName[k]) byName[k] = [];
    byName[k].push(m.ts);
  }

  let worst: { name: string; median: number; currentGap: number; ratio: number; logCount: number } | null = null;
  for (const name of Object.keys(byName)) {
    const ts = byName[name].slice().sort((a, b) => a - b);
    if (ts.length < minLogs) continue;
    const intervals: number[] = [];
    for (let i = 1; i < ts.length; i++) intervals.push(ts[i] - ts[i - 1]);
    if (intervals.length === 0) continue;
    const sorted = intervals.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
    if (!(median > 0)) continue;
    const lastTs = ts[ts.length - 1];
    const currentGap = now - lastTs;
    if (currentGap <= 0) continue;
    const ratio = currentGap / median;
    if (ratio <= gapMultiplier) continue;
    if (!worst || ratio > worst.ratio) {
      worst = { name, median, currentGap, ratio, logCount: ts.length };
    }
  }
  if (!worst) return null;

  const expectedHours = Math.round((worst.median / 3600000) * 10) / 10;
  const currentHours = Math.round((worst.currentGap / 3600000) * 10) / 10;
  const ratio2 = Math.round(worst.ratio * 100) / 100;

  return {
    pattern: 'medication_adherence_gap',
    episode_id: episode.id,
    med_name: worst.name,
    expected_interval_hours: expectedHours,
    current_gap_hours: currentHours,
    ratio: ratio2,
    log_count: worst.logCount,
    copy:
      worst.name + ' normalde ' + expectedHours + 'h aralıkla logluyorsun, son log ' +
      currentHours + 'h önce. doz mu kaçtı? pattern, not cause.',
    source: {
      citation: 'Pechère et al. 2007, J Clin Pharm Ther — Patient adherence to antibiotics',
      url: 'https://doi.org/10.1111/j.1365-2710.2007.00859.x',
    },
  };
}

// ─── Mental episode pattern detection ────────────────────────────────────────

export function detectMentalEpisodePattern(
  episodes: Episode[],
  history: TriggerHistory,
  opts?: { now?: number; minHistory?: number; minEpisodes?: number; jitterTolerance?: number },
): Array<EpisodeDurationPattern | EpisodeTriggerPattern | EpisodeRecurrencePattern> {
  const list = Array.isArray(episodes) ? episodes : [];
  const mentalKinds = ['mental_episode', 'acute_mental', 'mixed'];
  const mentalEps = list.filter(e => e && mentalKinds.indexOf(e.kind) >= 0);
  if (mentalEps.length === 0) return [];

  const out: Array<EpisodeDurationPattern | EpisodeTriggerPattern | EpisodeRecurrencePattern> = [];
  const mentalSource = {
    citation: 'Kessler et al. 2005, Arch Gen Psychiatry — Lifetime prevalence and age-of-onset distributions of DSM-IV disorders',
    url: 'https://doi.org/10.1001/archpsyc.62.6.593',
  };
  const cycleSource = {
    citation: 'Yonkers et al. 2008, Lancet — Premenstrual syndrome',
    url: 'https://doi.org/10.1016/S0140-6736(08)60527-9',
  };

  const duration = detectDurationDistribution(mentalEps, opts);
  if (duration) { out.push({ ...duration, pattern: 'mental_episode_duration', source: mentalSource }); }

  const trigger = detectTriggerCorrelation(mentalEps, history, opts);
  if (trigger) {
    out.push({
      ...trigger,
      pattern: 'mental_episode_trigger',
      source: trigger.trigger === 'luteal' ? cycleSource : mentalSource,
    });
  }

  const rhythm = detectRecurrenceRhythm(mentalEps, opts);
  if (rhythm) { out.push({ ...rhythm, pattern: 'mental_episode_rhythm', source: mentalSource }); }

  return out;
}

// ─── Doctor summary export ────────────────────────────────────────────────────

export interface DoctorSummaryHistory {
  sleepRecords?: Array<{ night_of: string; tst_min: number }>;
  cyclePhases?: Array<{ ts: number; phase: string }>;
  dumps?: Array<{ ts: number; rawText?: string; text?: string }>;
}

export function generateDoctorSummary(
  episode: Episode,
  history?: DoctorSummaryHistory,
  opts?: { now?: number; userName?: string; contextDays?: number },
): string {
  if (!episode || typeof episode.started_at !== 'number') return '';
  const o = opts || {};
  const h = history || {};
  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtDay = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const lines: string[] = [];
  const namePrefix = (o.userName && String(o.userName).trim())
    ? String(o.userName).toLowerCase().trim() + ' · '
    : '';
  lines.push('# ' + namePrefix + (episode.label || 'episode') + ' — episode summary');
  lines.push('');
  lines.push('Started: ' + fmtDate(episode.started_at));

  if (episode.ended_at) {
    lines.push('Ended: ' + fmtDate(episode.ended_at));
    const days = Math.round((episode.ended_at - episode.started_at) / 86400000 * 10) / 10;
    lines.push('Duration: ' + days + ' days');
  } else {
    lines.push('Status: still open');
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const days = Math.round((now - episode.started_at) / 86400000 * 10) / 10;
    lines.push('Duration so far: ' + days + ' days');
  }
  if (episode.kind) lines.push('Type: ' + episode.kind);

  const sev = episode.severity_log || [];
  if (sev.length > 0) {
    lines.push('');
    lines.push('## Severity timeline (1–5)');
    const bar = (n: number) => {
      const filled = Math.max(0, Math.min(5, Math.round(n)));
      return '▓'.repeat(filled) + '░'.repeat(5 - filled);
    };
    for (const s of sev) {
      const note = s.note ? '  — ' + s.note : '';
      lines.push(`${fmtDate(s.ts)}  ${bar(s.severity)} ${s.severity}/5${note}`);
    }
  }

  const meds = episode.meds || [];
  if (meds.length > 0) {
    lines.push('');
    lines.push('## Medications');
    const grouped: Record<string, { count: number; dose?: string; ts: number[] }> = {};
    for (const m of meds) {
      if (!m || !m.name) continue;
      if (!grouped[m.name]) grouped[m.name] = { count: 0, dose: m.dose, ts: [] };
      grouped[m.name].count++;
      grouped[m.name].ts.push(m.ts);
    }
    for (const [name, g] of Object.entries(grouped)) {
      const dose = g.dose ? ' ' + g.dose : '';
      const tsStrs = g.ts.map(fmtDate).join(', ');
      lines.push(`- ${name}${dose} ×${g.count}: ${tsStrs}`);
    }
  }

  const symptoms = episode.symptoms || [];
  if (symptoms.length > 0) {
    lines.push('');
    lines.push('## Symptoms');
    lines.push(symptoms.join(', '));
  }

  const onsetTs = episode.started_at;
  const lookbackMs = (o.contextDays || 7) * 86400000;
  const winStart = onsetTs - lookbackMs;

  const sleepArr = (h.sleepRecords || []).filter(r => {
    if (!r || typeof r.tst_min !== 'number' || typeof r.night_of !== 'string') return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.night_of);
    if (!m) return false;
    const ts = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)).getTime();
    return ts >= winStart && ts <= onsetTs;
  });

  const dumpsArr = (h.dumps || []).filter(d => {
    if (!d || typeof d.ts !== 'number') return false;
    return d.ts >= winStart && d.ts <= onsetTs;
  });

  const stressCount = dumpsArr.filter(d => STRESS_RE.test(String(d.rawText || d.text || ''))).length;
  const sleepAvg = sleepArr.length > 0 ? sleepArr.reduce((a, b) => a + b.tst_min, 0) / sleepArr.length : null;

  let phaseAtOnset: string | null = null;
  const sortedPhases = (h.cyclePhases || [])
    .filter(p => p && typeof p.ts === 'number' && typeof p.phase === 'string')
    .sort((a, b) => a.ts - b.ts);
  for (const p of sortedPhases) {
    if (p.ts <= onsetTs) phaseAtOnset = p.phase;
    else break;
  }

  if (sleepAvg != null || stressCount > 0 || phaseAtOnset) {
    lines.push('');
    lines.push(`## Context (${o.contextDays || 7} days prior to onset)`);
    if (sleepAvg != null) lines.push('Sleep avg: ' + (sleepAvg / 60).toFixed(1) + ' h/night');
    if (stressCount > 0) lines.push('Stress mentions: ' + stressCount);
    if (phaseAtOnset) lines.push('Cycle phase at onset: ' + phaseAtOnset);
  }

  const notes = episode.notes || [];
  if (notes.length > 0) {
    lines.push('');
    lines.push('## Notes');
    for (const n of notes) lines.push('- ' + n);
  }

  lines.push('');
  lines.push('—');
  const now2 = typeof o.now === 'number' ? o.now : Date.now();
  lines.push('generated by ollie · ' + fmtDay(now2));
  return lines.join('\n');
}
