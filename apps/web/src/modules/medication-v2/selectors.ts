/**
 * medication-v2 · selectors — pure view-models over the live medication store
 *
 * Every screen of the v2 medication preview derives its content here, from
 * the SAME `@ollie/logic/medication` pure fns + `medication.*` store slices
 * the live `MedicationModule` uses. No rendering, no hooks — just
 * `MedicationSlices` in, view-models out. This is the seam that keeps the
 * redesign a UI rebuild.
 *
 * Mirrors body-v2/selectors.ts in spirit: small, tested, deterministic
 * (every fn that needs the wall clock takes an explicit `now`).
 */
import {
  takenToday,
  takenCountToday,
  dosesRemainingToday,
  dueSlotsToday,
  adherenceReport,
  isoDate,
  type MedicationItem,
  type MedicationKind,
  type AdherenceReport,
  type DueSlot,
} from '@ollie/logic/medication';

// ─── store shapes ────────────────────────────────────────────────────────────

/** the orchestrator-written adherence slice — `medication.adherence` */
export type AdherenceSlice = Record<string, AdherenceReport | null>;

/** everything the v2 medication screens read from the store */
export interface MedicationSlices {
  /** the tracked medications — `medication.items` */
  items: MedicationItem[];
  /** the orchestrator-written adherence reports, keyed by item id */
  adherence: AdherenceSlice;
}

// ─── palette — the calm per-kind dot colour ──────────────────────────────────

/**
 * The medication face shows each med with a quiet colour dot. The mockup
 * pairs amber with prescriptions, sage with vitamins, a soft violet with
 * supplements and a calm clay with otc. A med may carry its own
 * `color_hex` (the live module lets you set one) — that wins.
 */
const KIND_DOT: Record<MedicationKind, string> = {
  prescription: '#C9923E',
  vitamin: '#5B8C7E',
  supplement: '#8C7BB0',
  otc: '#B97A57',
};

/** the calm colour dot for a med — its own `color_hex`, else by kind */
export function medDot(item: MedicationItem): string {
  if (typeof item.color_hex === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(item.color_hex)) {
    return item.color_hex;
  }
  return KIND_DOT[item.kind] ?? KIND_DOT.supplement;
}

// ─── small formatters ────────────────────────────────────────────────────────

/** "2:00pm" — a calm 12h clock for an HH:MM 24h string */
export function fmtHHmm(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
  if (!m) return hhmm;
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (!Number.isFinite(h)) return hhmm;
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min}${ampm}`;
}

/** "8:02am" — a calm 12h clock for an epoch-ms timestamp */
export function clockOf(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

/** minutes-since-midnight for an HH:MM 24h string, or null when unparseable */
function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mn = Number(m[2]);
  if (h < 0 || h > 23 || mn < 0 || mn > 59) return null;
  return h * 60 + mn;
}

/** minutes-since-midnight for an epoch-ms timestamp */
function minutesOfTs(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

// ─── visible meds ────────────────────────────────────────────────────────────

/** the non-archived meds — what every v2 medication screen renders */
export function visibleMeds(slices: MedicationSlices): MedicationItem[] {
  return (Array.isArray(slices.items) ? slices.items : []).filter(
    (i) => i && i.id && !i.archived,
  );
}

// ─── face view-model ─────────────────────────────────────────────────────────

/** one med, as the face's notebook list renders it */
export interface MedRow {
  id: string;
  /** "methylphenidate" */
  name: string;
  /** the kind word — "prescription" */
  kind: MedicationKind;
  /** the dot colour */
  dot: string;
  /** "10mg · 8:00am, 2:00pm" — dose + schedule, or "manual log only" */
  meta: string;
  /** taken at least once today */
  doneToday: boolean;
  /** "8:02am" — the first logged time today, when done */
  takenAt: string | null;
}

/** the day's dose-dot states — one per scheduled slot */
export type DoseDotState = 'done' | 'now' | 'ahead';

export interface MedicationFaceVM {
  /** has any med been added at all? drives the cold copy */
  hasMeds: boolean;

  // ── the hero — the next dose ──
  /** is there a live dose to take? */
  hasNextDose: boolean;
  /** "methylphenidate" — the med the next dose belongs to */
  nextName: string;
  /** "prescription · 10mg" — the calm sub-line */
  nextSub: string;
  /** "2:00pm" — the next dose time, or "—" cold */
  nextTime: string;
  /** the take-circle cue — "tap when taken", or "" cold */
  nextCue: string;
  /** the id of the med the next dose belongs to (to log against) */
  nextItemId: string | null;

  // ── the day's dose dots — across all scheduled meds ──
  doseDots: DoseDotState[];
  /** doses logged today across all scheduled meds */
  dosesTaken: number;
  /** total scheduled doses today across all meds */
  dosesScheduled: number;

  // ── the notebook list ──
  meds: MedRow[];

  // ── the adherence drill row ──
  /** the adherence-log row glance line */
  adherenceLine: string;
  /** is the adherence row cold? */
  adherenceCold: boolean;
}

/** "10mg · 8:00am, 2:00pm" — the calm meta line for a med */
function medMeta(item: MedicationItem): string {
  const dose = item.dose && item.dose.trim() ? item.dose.trim() : null;
  const sched = (Array.isArray(item.schedule) ? item.schedule : [])
    .map((s) => fmtHHmm(s))
    .filter(Boolean);
  const schedPart = sched.length > 0 ? sched.join(', ') : 'manual log only';
  return dose ? `${dose} · ${schedPart}` : schedPart;
}

/** the first logged time today for a med, as "8:02am", or null */
function firstTakenToday(item: MedicationItem, now: number): string | null {
  const date = isoDate(now);
  const todays = (Array.isArray(item.taken) ? item.taken : [])
    .filter((t) => t && t.date === date && typeof t.ts === 'number')
    .sort((a, b) => a.ts - b.ts);
  return todays.length > 0 ? clockOf(todays[0].ts) : null;
}

/**
 * The medication face view-model. The hero is the NEXT DOSE: across every
 * scheduled med, the earliest slot today that has not yet been logged. If
 * every scheduled dose is done — or no med has a schedule — the hero falls
 * back to a calm "all done"/"nothing to take" state.
 */
export function medicationFaceVM(
  slices: MedicationSlices,
  now: number,
): MedicationFaceVM {
  const meds = visibleMeds(slices);
  const hasMeds = meds.length > 0;
  const nowMin = minutesOfTs(now);

  // ── the day's dose dots + the next dose ──
  // every scheduled slot today, paired with whether it's been logged.
  interface Slot {
    itemId: string;
    name: string;
    sub: string;
    hhmm: string;
    min: number;
    state: DoseDotState;
  }
  const slots: Slot[] = [];
  for (const it of meds) {
    const sched = Array.isArray(it.schedule) ? it.schedule : [];
    if (sched.length === 0) continue;
    const due: DueSlot[] = dueSlotsToday(it, now);
    const takenCount = takenCountToday(it, now);
    // a slot is "done" when the count covers its index; "now"/"ahead" by clock
    const sorted = sched
      .map((hhmm) => ({ hhmm, min: minutesOf(hhmm) }))
      .filter((s): s is { hhmm: string; min: number } => s.min != null)
      .sort((a, b) => a.min - b.min);
    let i = 0;
    for (const s of sorted) {
      const done = i < takenCount;
      let state: DoseDotState;
      if (done) state = 'done';
      else if (s.min <= nowMin) state = 'now';
      else state = 'ahead';
      slots.push({
        itemId: it.id,
        name: it.name,
        sub: `${it.kind}${it.dose ? ` · ${it.dose}` : ''}`,
        hhmm: s.hhmm,
        min: s.min,
        state,
      });
      i++;
    }
    // a passing reference so `due` is read (overdue informs nothing extra
    // here — the face stays calm — but the live logic is exercised).
    void due;
  }
  slots.sort((a, b) => a.min - b.min);

  const dosesScheduled = slots.length;
  const dosesTaken = slots.filter((s) => s.state === 'done').length;
  const doseDots: DoseDotState[] = slots.map((s) => s.state);

  // the next dose — the earliest un-done slot, "now" preferred over "ahead"
  const pending = slots.filter((s) => s.state !== 'done');
  const nextSlot =
    pending.find((s) => s.state === 'now') ?? pending[0] ?? null;

  const hasNextDose = nextSlot != null;

  // ── the notebook list ──
  const medRows: MedRow[] = meds.map((it) => ({
    id: it.id,
    name: it.name,
    kind: it.kind,
    dot: medDot(it),
    meta: medMeta(it),
    doneToday: takenToday(it, now),
    takenAt: firstTakenToday(it, now),
  }));

  // ── the adherence drill row ──
  const anyLog = meds.some(
    (it) => (Array.isArray(it.taken) ? it.taken : []).length > 0,
  );
  const adherenceCold = !anyLog;
  const adherenceLine = adherenceCold
    ? 'nothing logged yet'
    : 'what was taken, and when';

  return {
    hasMeds,
    hasNextDose,
    nextName: nextSlot ? nextSlot.name : hasMeds ? 'all done for today' : 'nothing on file yet',
    nextSub: nextSlot
      ? nextSlot.sub
      : hasMeds
        ? 'every scheduled dose is logged'
        : 'a med, a vitamin, a supplement — anything',
    nextTime: nextSlot ? fmtHHmm(nextSlot.hhmm) : hasMeds ? 'done' : '–',
    nextCue: nextSlot ? 'tap when taken' : hasMeds ? 'nothing due' : 'nothing to take',
    nextItemId: nextSlot ? nextSlot.itemId : null,
    doseDots,
    dosesTaken,
    dosesScheduled,
    meds: medRows,
    adherenceLine,
    adherenceCold,
  };
}

// ─── add view-model ──────────────────────────────────────────────────────────

/** the four kind tiles the add screen offers, with their calm hints */
export interface KindTile {
  value: MedicationKind;
  hint: string;
}

export const KIND_TILES: KindTile[] = [
  { value: 'vitamin', hint: 'd, b12, …' },
  { value: 'supplement', hint: 'magnesium, …' },
  { value: 'prescription', hint: 'prescribed' },
  { value: 'otc', hint: 'over the counter' },
];

/**
 * Parse a comma-separated schedule string into clean HH:MM slots + a
 * human preview. Mirrors how `MedicationModule.addItem` splits the field,
 * but also surfaces the parsed times as "8:00am" chips for the preview.
 */
export interface ParsedSchedule {
  /** the clean HH:MM 24h slots, sorted, de-duped */
  slots: string[];
  /** the same slots as calm "8:00am" labels for the chip preview */
  labels: string[];
  /** a one-line hint — "two doses a day", "" when blank/manual */
  hint: string;
}

export function parseSchedule(raw: string): ParsedSchedule {
  const parts = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<number>();
  const slots: string[] = [];
  for (const p of parts) {
    const min = minutesOf(p);
    if (min == null || seen.has(min)) continue;
    seen.add(min);
    // normalise to zero-padded HH:MM
    const h = Math.floor(min / 60);
    const m = min % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  slots.sort((a, b) => (minutesOf(a) ?? 0) - (minutesOf(b) ?? 0));
  const labels = slots.map((s) => fmtHHmm(s));
  let hint = '';
  if (slots.length === 1) hint = 'one dose a day';
  else if (slots.length === 2) hint = 'two doses a day';
  else if (slots.length === 3) hint = 'three doses a day';
  else if (slots.length > 3) hint = `${slots.length} doses a day`;
  return { slots, labels, hint };
}

// ─── adherence-log view-model ────────────────────────────────────────────────

/** one of today's scheduled slots for a med, with its taken state */
export interface TodaySlot {
  /** "8:00am" — the scheduled time */
  label: string;
  /** "taken" when logged, "due" when past + un-logged, "ahead" otherwise */
  state: 'taken' | 'due' | 'ahead';
  /** "8:02am" — the actual logged time, when taken */
  takenAt: string | null;
}

/** one med's today block in the adherence log */
export interface TodayMedVM {
  id: string;
  name: string;
  dot: string;
  /** "10mg", or "" */
  dose: string;
  /** the day's scheduled slots, sorted; empty for a manual-only med */
  slots: TodaySlot[];
  /** true when the med has no schedule (manual log only) */
  manual: boolean;
  /** how many manual logs were made today (manual meds only) */
  manualLoggedToday: number;
}

/** one med's fortnight report line */
export interface ReportLine {
  id: string;
  name: string;
  dot: string;
  /** the report — a scheduled med carries `logged X of Y` */
  report: AdherenceReport | null;
  /** for manual / un-windowed meds: the raw count of logs in the window */
  manualCount: number;
  /** is this a manual-only med? (no schedule → "logged N times") */
  manual: boolean;
}

export interface AdherenceLogVM {
  /** today's per-med blocks */
  today: TodayMedVM[];
  /** the 14-day report lines */
  report: ReportLine[];
  /** anything to render at all? */
  hasMeds: boolean;
}

const DAY_MS = 86_400_000;

/** count a med's `taken` logs that fall in the last `windowDays` */
function loggedInWindow(item: MedicationItem, now: number, windowDays = 14): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const startTs = d.getTime() - (windowDays - 1) * DAY_MS;
  let n = 0;
  for (const t of Array.isArray(item.taken) ? item.taken : []) {
    if (!t) continue;
    const tts = Date.parse(`${t.date}T${t.time || '12:00'}`);
    if (Number.isFinite(tts) && tts >= startTs && tts <= now) n++;
  }
  return n;
}

/**
 * The adherence-log view-model. Today's slots come from `dueSlotsToday` +
 * the med's logged times; the fortnight report comes from the SAME pure
 * `adherenceReport` the orchestrator runs — preferring the orchestrator's
 * stored slice when present, else computed live so the preview is honest
 * even before the orchestrator has run.
 */
export function adherenceLogVM(
  slices: MedicationSlices,
  now: number,
): AdherenceLogVM {
  const meds = visibleMeds(slices);
  const date = isoDate(now);

  const today: TodayMedVM[] = meds.map((it) => {
    const sched = Array.isArray(it.schedule) ? it.schedule : [];
    const logs = (Array.isArray(it.taken) ? it.taken : [])
      .filter((t) => t && t.date === date && typeof t.ts === 'number')
      .sort((a, b) => a.ts - b.ts);

    if (sched.length === 0) {
      return {
        id: it.id,
        name: it.name,
        dot: medDot(it),
        dose: it.dose && it.dose.trim() ? it.dose.trim() : '',
        slots: [],
        manual: true,
        manualLoggedToday: logs.length,
      };
    }

    const due = dueSlotsToday(it, now);
    // pair each scheduled slot, in clock order, with a log (in order)
    const sortedDue = due
      .slice()
      .sort((a, b) => a.slot_ts - b.slot_ts);
    const slots: TodaySlot[] = sortedDue.map((d, i) => {
      const log = logs[i] ?? null;
      let state: TodaySlot['state'];
      if (log) state = 'taken';
      else if (now >= d.slot_ts) state = 'due';
      else state = 'ahead';
      return {
        label: fmtHHmm(d.slot_hhmm),
        state,
        takenAt: log ? clockOf(log.ts) : null,
      };
    });
    return {
      id: it.id,
      name: it.name,
      dot: medDot(it),
      dose: it.dose && it.dose.trim() ? it.dose.trim() : '',
      slots,
      manual: false,
      manualLoggedToday: 0,
    };
  });

  const report: ReportLine[] = meds.map((it) => {
    const sched = Array.isArray(it.schedule) ? it.schedule : [];
    if (sched.length === 0) {
      return {
        id: it.id,
        name: it.name,
        dot: medDot(it),
        report: null,
        manualCount: loggedInWindow(it, now),
        manual: true,
      };
    }
    // prefer the orchestrator's stored report; fall back to a live compute
    const stored = slices.adherence?.[it.id];
    const live = adherenceReport(it, now);
    return {
      id: it.id,
      name: it.name,
      dot: medDot(it),
      report: stored ?? live,
      manualCount: loggedInWindow(it, now),
      manual: false,
    };
  });

  return { today, report, hasMeds: meds.length > 0 };
}

// re-exported for screens that want the raw helpers
export { takenToday, takenCountToday, dosesRemainingToday, isoDate };
export type { MedicationItem, MedicationKind, AdherenceReport };
