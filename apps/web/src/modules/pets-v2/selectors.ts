/**
 * pets-v2 · selectors — pure view-models over the live pets store
 *
 * Every screen of the v2 pets preview derives its content here, from the
 * SAME `@ollie/logic/pets` pure functions + `pets.*` store slices the live
 * `PetsModule` reads + writes. No rendering, no hooks — just `PetsSlices`
 * in, view-models out. This is the seam that keeps the redesign a UI
 * rebuild, not a fork: the data + logic layer is untouched.
 *
 * Mirrors admin-v2/selectors.ts: small, tested, deterministic — every fn
 * that needs the wall clock takes an explicit `now`.
 */
import {
  SPECIES_PROFILES,
  SPECIES_LIST,
  TASK_DISPLAY,
  PREFACES,
  computeCareGaps,
  generateGuiltTripCopy,
  isAdoptversary,
} from '@ollie/logic/pets';
import type {
  Pet,
  CareLogEntry,
  CareGap,
  CareSeverity,
} from '@ollie/logic/pets';

const DAY_MS = 86_400_000;

// ─── store shapes ────────────────────────────────────────────────────────────

/** one pet as the live `PetsModule` stores it on `pets.pets` */
export interface StoredPet extends Omit<Pet, 'nickname'> {
  nickname?: string | null;
  notes?: string | null;
  cohabits_with?: string[];
  archived?: boolean;
  archived_at?: number | null;
  created_at?: number;
}

/** one care-log row — `pets.care_log` */
export interface StoredCareLogEntry extends CareLogEntry {
  id?: string;
  source?: string;
  raw_text?: string | null;
  confidence?: number;
}

/** one observation — `pets.observations` */
export interface StoredObservation {
  id?: string;
  pet_id: string;
  text: string;
  tags: string[];
  kind?: 'weight' | 'symptom' | 'behavior' | 'note';
  value_grams?: number;
  occurred_at?: number;
  created_at?: number;
}

/** one care gap — `pets.care_gaps` (orchestrator-written) */
export type StoredCareGap = CareGap;

/** one health flag — `pets.health_flags` (orchestrator-written) */
export interface StoredHealthFlag {
  id: string;
  pet_id: string;
  flag: string;
  run_length: number;
  last_signal_at: number;
  source_url: string;
  status: 'pending' | 'reviewed' | 'dismissed';
  detected_at: number;
  reviewed_at?: number;
}

/** one milestone — `pets.milestones` */
export interface StoredMilestone {
  pet_id: string;
  tag: string;
  first_seen_at: number;
  raw_text: string;
}

export interface PetsSettings {
  guilt_voice?: string;
  weekly_letter?: string;
  multi_caregiver?: boolean;
}

export interface AwayState {
  active: boolean;
  returning_at: number | null;
}

/** everything the v2 pets screens read from the store */
export interface PetsSlices {
  pets: StoredPet[];
  careLog: StoredCareLogEntry[];
  observations: StoredObservation[];
  careGaps: StoredCareGap[];
  healthFlags: StoredHealthFlag[];
  milestones: StoredMilestone[];
  settings: PetsSettings;
  away: AwayState;
}

// ─── small formatters ────────────────────────────────────────────────────────

const WEEKDAYS_FULL = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];
const MONTHS_FULL = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** "may 18" — the calm short date health/observation rows show */
export function fmtShortDate(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_FULL[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

/** "monday, may 19" — the lock-screen clock day line */
export function fmtClockDay(ts: number): string {
  const d = new Date(ts);
  return `${WEEKDAYS_FULL[d.getDay()]}, ${MONTHS_FULL[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

/** "since may 2024" — the pet-profile age line */
export function fmtSinceMonth(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${MONTHS_FULL[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

/** a relative day phrase — "today" / "2 days ago" / "3 weeks ago" */
export function fmtRelative(ts: number, now: number): string {
  const days = Math.floor((now - ts) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const y = Math.round(days / 365);
  return y === 1 ? '1 year ago' : `${y} years ago`;
}

/** the single-letter disc token for a pet */
export function petInitial(pet: { name?: string } | null | undefined): string {
  const n = (pet?.name ?? '').trim();
  return n ? n.charAt(0).toUpperCase() : '?';
}

/** the human task label */
export function taskLabel(task: string): string {
  return TASK_DISPLAY[task] ?? task.replace(/_/g, ' ');
}

/** the human species label */
export function speciesLabel(species: string): string {
  return SPECIES_PROFILES[species]?.display_name ?? species.replace(/_/g, ' ');
}

// ─── active roster ───────────────────────────────────────────────────────────

/** the non-archived pets, in store order */
export function activePets(slices: PetsSlices): StoredPet[] {
  return slices.pets.filter((p) => !p.archived);
}

/**
 * The care gaps to render — prefer the orchestrator-written `pets.care_gaps`
 * when present, else recompute from the live care log (mirrors `PetsModule`'s
 * `resolvedGaps`). Always recomputed against the supplied `now`.
 */
export function resolveCareGaps(slices: PetsSlices, now: number): CareGap[] {
  const computed = computeCareGaps(
    activePets(slices) as Pet[],
    slices.careLog as CareLogEntry[],
    SPECIES_PROFILES,
    now,
  );
  return slices.careGaps.length > 0 ? slices.careGaps : computed;
}

const SEVERITY_RANK: Record<CareSeverity, number> = {
  ok: 0, nudge: 1, soft: 2, firm: 3, concerned: 4,
};

// ─── the 30-day care strip ───────────────────────────────────────────────────

export type StripDay = 'on' | 'off' | 'gap';

/**
 * The tailored 30-day care strip for a pet: 30 cells, oldest-left, today is
 * the rightmost. A day with ANY care logged → 'on'; a day before the pet
 * joined the notebook → 'gap'; otherwise 'off'.
 */
export function careStrip(
  petId: string,
  joinedAt: number | undefined,
  careLog: StoredCareLogEntry[],
  now: number,
): StripDay[] {
  const todayStart = startOfDay(now);
  const out: StripDay[] = [];
  // distinct calendar-day starts that have a logged care entry for this pet
  const loggedDays = new Set<number>();
  for (const e of careLog) {
    if (e.pet_id === petId) loggedDays.add(startOfDay(e.occurred_at));
  }
  for (let i = 29; i >= 0; i--) {
    const dayStart = todayStart - i * DAY_MS;
    if (joinedAt && dayStart < startOfDay(joinedAt)) {
      out.push('gap');
    } else if (loggedDays.has(dayStart)) {
      out.push('on');
    } else {
      out.push('off');
    }
  }
  return out;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** count of 'on' cells in a strip */
export function stripOnCount(strip: StripDay[]): number {
  return strip.filter((s) => s === 'on').length;
}

// ─── the pets face ───────────────────────────────────────────────────────────

/** the next/overdue care task across all pets — the face hero */
export interface HeroVM {
  petId: string;
  petName: string;
  petInitial: string;
  task: string;
  taskDisplay: string;
  species: string;
  /** "2 days since the last" */
  sinceLine: string;
  /** the species fact appended to the since line */
  speciesFact: string;
  /** the deadpan anti-guilt reframe */
  reframe: string;
  severity: CareSeverity;
}

/** one roster entry */
export interface RosterEntryVM {
  petId: string;
  petName: string;
  petInitial: string;
  species: string;
  speciesDisplay: string;
  /** the most pressing care task label, or null when all current */
  careTask: string | null;
  /** true → "all current" */
  allCurrent: boolean;
  strip: StripDay[];
}

export interface PetsFaceVM {
  /** the hero — the single most-pressing care thing, or null when cold/all-ok */
  hero: HeroVM | null;
  /** the roster — one entry per active pet */
  roster: RosterEntryVM[];
  /** any pet at all? false → the cold first-run face */
  hasPets: boolean;
  /** count of pending health flags */
  healthPendingCount: number;
  /** the calm health drill-row value line */
  healthLine: string;
  /** true → a behavioural pattern is live (the sage "see the rest" row) */
  hasPatterns: boolean;
  /** away mode active */
  away: boolean;
  /** "may 23" — the away-until label, or '' */
  awayUntil: string;
}

/** the species fact that rides the hero's since line */
function speciesFact(task: string, species: string): string {
  const profile = SPECIES_PROFILES[species];
  const note = profile?.care_tasks?.[task]?.welfare_note;
  if (note) {
    // a short clause — the first sentence, lower-cased, no trailing period
    const clause = note.split(/[.—]/)[0]?.trim() ?? '';
    if (clause) return clause;
  }
  if (species === 'guinea_pig') return 'guinea pigs graze all day';
  return `${profile?.display_name_plural ?? 'they'} run on a steady cadence`;
}

/** the deadpan anti-guilt reframe for the hero */
function heroReframe(
  task: string,
  species: string,
  severity: CareSeverity,
): string {
  const profile = SPECIES_PROFILES[species];
  const note = profile?.care_tasks?.[task]?.welfare_note;
  const display = taskLabel(task);
  if (severity === 'nudge') {
    return `${display} is coming due — no rush. catch it when you next pass by.`;
  }
  if (severity === 'soft') {
    return note
      ? `a day over isn't a crisis. ${note}`
      : `a day over isn't a crisis — just catch it when you can.`;
  }
  // firm / concerned — still calm, still no shame
  return note
    ? `worth doing soon. ${note}`
    : `worth catching up on when you have a moment — not a verdict on your care.`;
}

/**
 * The pets face view-model. The hero is the single highest-severity care
 * gap across every active pet (ties broken by days_since). Cold when there
 * are no pets at all.
 */
export function petsFaceVM(slices: PetsSlices, now: number): PetsFaceVM {
  const pets = activePets(slices);
  const gaps = resolveCareGaps(slices, now);
  const pending = slices.healthFlags.filter((f) => f.status === 'pending');

  // the most-pressing gap → the hero
  let hero: HeroVM | null = null;
  let worst: CareGap | null = null;
  for (const g of gaps) {
    if (g.severity === 'ok') continue;
    if (
      !worst ||
      SEVERITY_RANK[g.severity] > SEVERITY_RANK[worst.severity] ||
      (SEVERITY_RANK[g.severity] === SEVERITY_RANK[worst.severity] &&
        (g.days_since ?? 0) > (worst.days_since ?? 0))
    ) {
      worst = g;
    }
  }
  if (worst) {
    const pet = pets.find((p) => p.id === worst!.pet_id);
    if (pet) {
      const days = worst.days_since === null ? null : Math.floor(worst.days_since);
      const sinceLine =
        days === null
          ? 'not logged yet'
          : days <= 0
            ? 'logged today'
            : days === 1
              ? '1 day since the last'
              : `${days} days since the last`;
      hero = {
        petId: pet.id,
        petName: pet.name,
        petInitial: petInitial(pet),
        task: worst.task,
        taskDisplay: taskLabel(worst.task),
        species: pet.species,
        sinceLine,
        speciesFact: speciesFact(worst.task, pet.species),
        reframe: heroReframe(worst.task, pet.species, worst.severity),
        severity: worst.severity,
      };
    }
  }

  // the roster — one entry per pet
  const roster: RosterEntryVM[] = pets.map((pet) => {
    const petGaps = gaps.filter(
      (g) => g.pet_id === pet.id && g.severity !== 'ok',
    );
    let topTask: string | null = null;
    if (petGaps.length > 0) {
      let top = petGaps[0];
      for (const g of petGaps) {
        if (SEVERITY_RANK[g.severity] > SEVERITY_RANK[top.severity]) top = g;
      }
      topTask = taskLabel(top.task);
    }
    return {
      petId: pet.id,
      petName: pet.name,
      petInitial: petInitial(pet),
      species: pet.species,
      speciesDisplay: speciesLabel(pet.species),
      careTask: topTask,
      allCurrent: topTask === null,
      strip: careStrip(
        pet.id,
        pet.adopted_at ?? pet.created_at,
        slices.careLog,
        now,
      ),
    };
  });

  const healthLine =
    pending.length === 0
      ? 'nothing noted right now'
      : `${pending.length} thing${pending.length === 1 ? '' : 's'} noted · when you have a moment`;

  return {
    hero,
    roster,
    hasPets: pets.length > 0,
    healthPendingCount: pending.length,
    healthLine,
    hasPatterns: petsPatternsVM(slices, now).live.length > 0,
    away: slices.away.active,
    awayUntil: slices.away.returning_at
      ? fmtShortDate(slices.away.returning_at)
      : '',
  };
}

// ─── the pet profile ─────────────────────────────────────────────────────────

export interface ProfileObservationVM {
  text: string;
  when: string;
  tags: string[];
}

export interface ProfileMilestoneVM {
  line: string;
  when: string;
}

export interface PetProfileVM {
  petId: string;
  petName: string;
  petInitial: string;
  species: string;
  speciesDisplay: string;
  /** "solo" / "with 1 other" — the cohabitation line */
  socialLine: string;
  sinceLine: string;
  /** the adoptversary years, or null */
  adoptversaryYears: number | null;
  strip: StripDay[];
  stripOnCount: number;
  observations: ProfileObservationVM[];
  milestones: ProfileMilestoneVM[];
}

/** the pet-profile view-model — null if the pet id is unknown / archived */
export function petProfileVM(
  slices: PetsSlices,
  petId: string | null,
  now: number,
): PetProfileVM | null {
  if (!petId) return null;
  const pet = slices.pets.find((p) => p.id === petId);
  if (!pet || pet.archived) return null;

  const profile = SPECIES_PROFILES[pet.species];
  const mustPair = profile?.welfare_flags?.must_pair ?? false;
  const cohabits = pet.cohabits_with?.length ?? 0;
  const socialLine =
    cohabits > 0
      ? `with ${cohabits} other${cohabits === 1 ? '' : 's'}`
      : mustPair
        ? 'solo'
        : 'solo';

  const joined = pet.adopted_at ?? pet.created_at;

  const obs: ProfileObservationVM[] = slices.observations
    .filter((o) => o.pet_id === petId)
    .slice()
    .sort(
      (a, b) =>
        (b.occurred_at ?? b.created_at ?? 0) -
        (a.occurred_at ?? a.created_at ?? 0),
    )
    .slice(0, 3)
    .map((o) => ({
      text: o.text,
      when: fmtRelative(o.occurred_at ?? o.created_at ?? now, now),
      tags: Array.isArray(o.tags) ? o.tags : [],
    }));

  const miles: ProfileMilestoneVM[] = slices.milestones
    .filter((m) => m.pet_id === petId)
    .slice()
    .sort((a, b) => b.first_seen_at - a.first_seen_at)
    .slice(0, 4)
    .map((m) => ({
      line: m.raw_text || `first ${m.tag.replace(/_/g, ' ')}`,
      when: fmtRelative(m.first_seen_at, now),
    }));

  const strip = careStrip(petId, joined, slices.careLog, now);

  return {
    petId: pet.id,
    petName: pet.name,
    petInitial: petInitial(pet),
    species: pet.species,
    speciesDisplay: speciesLabel(pet.species),
    socialLine,
    sinceLine: joined ? `since ${fmtSinceMonth(joined)}` : 'recently joined',
    adoptversaryYears: isAdoptversary(pet as Pet, now),
    strip,
    stripOnCount: stripOnCount(strip),
    observations: obs,
    milestones: miles,
  };
}

// ─── the add screen ──────────────────────────────────────────────────────────

export interface SpeciesOptionVM {
  key: string;
  display: string;
}

/** the 10 species, for the add picker */
export function speciesOptions(): SpeciesOptionVM[] {
  return SPECIES_LIST.map((key) => ({
    key,
    display: SPECIES_PROFILES[key]?.display_name ?? key,
  }));
}

/**
 * The "ollie will keep the {species} cadences" preview line — a calm
 * sentence naming the two or three headline cadences for the species.
 */
export function speciesCadencePreview(species: string): string {
  const profile = SPECIES_PROFILES[species];
  if (!profile) return '';
  const tasks = Object.entries(profile.care_tasks);
  // pick the most-frequent, a weekly-ish, and the vet check
  const daily = tasks.find(([, t]) => t.cadence_days <= 1);
  const weekly = tasks.find(([, t]) => t.cadence_days >= 3 && t.cadence_days <= 14);
  const vet = tasks.find(([k]) => k === 'vet_checkup');
  const parts: string[] = [];
  if (daily) parts.push(`${taskLabel(daily[0])} daily`);
  if (weekly) {
    const d = weekly[1].cadence_days;
    parts.push(
      `a ${taskLabel(weekly[0])} ${d <= 7 ? 'weekly' : 'every couple of weeks'}`,
    );
  }
  if (vet) parts.push('a vet check yearly');
  return parts.join(', ');
}

// ─── the log-care screen ─────────────────────────────────────────────────────

export interface CareTaskOptionVM {
  key: string;
  display: string;
}

/** the species-adaptive quick-pick care tasks for the log screen */
export function careTaskOptions(species: string): CareTaskOptionVM[] {
  const profile = SPECIES_PROFILES[species];
  if (!profile) return [];
  return Object.keys(profile.care_tasks).map((key) => ({
    key,
    display: taskLabel(key),
  }));
}

// ─── the observe screen ──────────────────────────────────────────────────────

/** the species behaviour quick-tags for the observe screen */
export function observationTags(species: string): string[] {
  return SPECIES_PROFILES[species]?.observation_tags ?? [];
}

/** the last recorded weight for a pet, in grams, or null */
export function lastWeight(
  slices: PetsSlices,
  petId: string,
): number | null {
  let latest: StoredObservation | null = null;
  for (const o of slices.observations) {
    if (o.pet_id !== petId || typeof o.value_grams !== 'number') continue;
    if (
      !latest ||
      (o.occurred_at ?? o.created_at ?? 0) >
        (latest.occurred_at ?? latest.created_at ?? 0)
    ) {
      latest = o;
    }
  }
  return latest?.value_grams ?? null;
}

// ─── the health screen ───────────────────────────────────────────────────────

export interface HealthFlagVM {
  id: string;
  petName: string;
  speciesDisplay: string;
  /** the calm observation line */
  line: string;
  /** "observed across 3 days" */
  daysLine: string;
  /** the species welfare note */
  note: string;
  /** the calm consider-a-vet framing */
  vetLine: string;
  /** the quiet citation source */
  cite: string;
  /** true → older than 7 days (the collapsed drawer) */
  old: boolean;
}

export interface PetsHealthVM {
  /** the recent pending flags (<7 days) */
  flags: HealthFlagVM[];
  /** the count of older pending flags, behind the drawer */
  olderCount: number;
}

/** the gentle health-flag line keyed off the flag name */
function healthFlagLine(flag: string, petName: string): string {
  const f = flag.replace(/_/g, ' ');
  const map: Record<string, string> = {
    not_eating: `you noted quiet, low appetite on a few separate days`,
    hunched: `you noted ${petName} sitting hunched on a few days`,
    respiratory: `you mentioned sneezing or a crusty nose more than once`,
    drooling: `you mentioned ${petName} drooling or a wet chin`,
    straining: `you noted straining or trouble in the litter tray`,
    vomiting: `you mentioned ${petName} being sick on a few days`,
    wet_tail: `you noted a wet bottom or loose stool on separate days`,
    lethargy: `you mentioned ${petName} being unusually still or sleepy`,
    tumors: `you noted a lump or growth on a couple of days`,
    black_beard: `you noted a dark, puffed beard more than once`,
    stuck_shed: `you mentioned retained shed across a few days`,
    fluffed: `you noted ${petName} staying fluffed up on separate days`,
    not_flying: `you mentioned ${petName} on the floor of the cage`,
    clamped_fins: `you noted clamped or tight fins more than once`,
  };
  return map[flag] ?? `you noted "${f}" on a few separate days`;
}

/** find the welfare note + severity for a flag across all species profiles */
function healthFlagConfig(flag: string): { note: string; sourceUrl: string } {
  for (const profile of Object.values(SPECIES_PROFILES)) {
    const cfg = profile.health_flags?.[flag];
    if (cfg) return { note: cfg.welfare_note, sourceUrl: cfg.source_url };
  }
  return { note: '', sourceUrl: '' };
}

/** a short, sourced citation tag from a welfare-source URL */
function citeFromUrl(url: string, speciesDisplay: string): string {
  if (url.includes('rspca')) return `${speciesDisplay} welfare — RSPCA guidance`;
  if (url.includes('vetmed.ucdavis'))
    return `${speciesDisplay} welfare — UC Davis veterinary medicine`;
  if (url.includes('rabbit.org'))
    return `${speciesDisplay} welfare — House Rabbit Society`;
  if (url.includes('avma'))
    return `${speciesDisplay} welfare — AVMA pet-owner guidance`;
  if (url.includes('reptifiles'))
    return `${speciesDisplay} welfare — ReptiFiles husbandry`;
  if (url.includes('ratguide'))
    return `${speciesDisplay} welfare — Rat Guide health reference`;
  return `${speciesDisplay} welfare guidance`;
}

/** the health-screen view-model — real `pets.health_flags` data */
export function petsHealthVM(slices: PetsSlices, now: number): PetsHealthVM {
  const pending = slices.healthFlags.filter((f) => f.status === 'pending');
  const recent: HealthFlagVM[] = [];
  let olderCount = 0;

  for (const f of pending) {
    const old = now - f.detected_at >= 7 * DAY_MS;
    if (old) {
      olderCount += 1;
      continue;
    }
    const pet = slices.pets.find((p) => p.id === f.pet_id);
    const petName = pet?.name ?? 'a pet';
    const speciesDisplay = pet ? speciesLabel(pet.species) : '';
    const cfg = healthFlagConfig(f.flag);
    recent.push({
      id: f.id,
      petName,
      speciesDisplay,
      line: healthFlagLine(f.flag, petName),
      daysLine: `observed across ${f.run_length} day${f.run_length === 1 ? '' : 's'}`,
      note:
        cfg.note ||
        `a change worth noting — it is the change, not the amount, that matters.`,
      vetLine:
        `if it's still there in a day or two, it'd be worth a vet visit — ` +
        `just to be sure, not because something is wrong.`,
      cite: citeFromUrl(f.source_url || cfg.sourceUrl, speciesDisplay),
      old: false,
    });
  }

  return { flags: recent, olderCount };
}

// ─── the patterns screen ─────────────────────────────────────────────────────

export interface PatternVM {
  group: string;
  line: string;
  frame: string;
  cite: string;
}

export interface PetsPatternsVM {
  /** patterns derived from real data (currently none are wired — see note) */
  live: PatternVM[];
  /**
   * the canonical example patterns, shown when nothing is live, honestly
   * labelled — mirrors habits-v2 / admin-v2.
   */
  examples: PatternVM[];
  /** true → the `examples` set is what is being shown */
  showingExamples: boolean;
}

/**
 * The canonical pets behavioural-pattern example set, from the approved
 * pets-patterns.html mockup. These are the five research-grounded pattern
 * shapes (`@ollie/logic/pets` P1–P5) the orchestrator produces. They are
 * shown as honestly-labelled examples here — see the selectors note: the
 * P1–P5 detectors need cross-module history (work crash logs, body
 * sleep-debt, dump corpora) that the pets store alone cannot supply, so
 * pets-v2 falls back to canonical examples, exactly like habits-v2.
 */
const PATTERN_EXAMPLES: PatternVM[] = [
  {
    group: 'what the pets do for you',
    line: 'your calmest brain dumps tend to land near the pets',
    frame:
      'sitting with a pet is a real way to settle — regulation outside the ' +
      'body costs less than doing it alone. the cage is quietly part of how ' +
      'you steady yourself.',
    cite: 'P2 · co-regulation — Beetz et al., 2012',
  },
  {
    group: 'where care stalls, and why',
    line: 'cage cleans have slipped twice now, with no first step named',
    frame:
      'starting is the most expensive minute — not the task itself. naming ' +
      'the 30-second first move ("just lift the hay tray") is what gets it ' +
      'going. this is activation, not neglect.',
    cite: 'P3 · care-activation barrier — Barkley, 2012',
  },
  {
    group: 'where care stalls, and why',
    line: 'the care you miss clusters on your low-sleep and crash days',
    frame:
      'pet care breaks first because it is the most goal-directed task in ' +
      'your day — it has no external deadline pushing it. a sensitivity to ' +
      'context, not a flaw in you.',
    cite: 'P4 · crash-context misses — Barkley & Murphy, 2010',
  },
  {
    group: 'where care stalls, and why',
    line: 'the vet checkup has waited a while — longer than its usual gap',
    frame:
      'yours runs on event-cued reminders, not avoidance. the fix is not ' +
      'willpower — it is anchoring a 60-second booking call to something you ' +
      'already do every day.',
    cite: 'P1 · vet-adherence delay — Gollwitzer, 1999',
  },
  {
    group: 'how you talk about them',
    line: 'a few of your notes read "she’s mad at me" after a missed day',
    frame:
      'pets run on present cues, not grudges — they are not keeping score. ' +
      'reading guilt into their behaviour is a sensitivity, not a flaw, but ' +
      'it can make a small miss feel heavier than it is.',
    cite: 'P5 · anthropomorphic projection — Serpell, 2003',
  },
];

/**
 * The patterns view-model. The pets P1–P5 detectors require cross-module
 * history pets-v2 does not have access to from the pets store alone, so —
 * like habits-v2 / admin-v2 — `live` is currently always empty and the
 * canonical `examples` are shown, honestly labelled. `now`/`slices` are
 * accepted so the shape is ready when the orchestrator wires patterns in.
 */
export function petsPatternsVM(
  _slices: PetsSlices,
  _now: number,
): PetsPatternsVM {
  const live: PatternVM[] = [];
  return {
    live,
    examples: PATTERN_EXAMPLES,
    showingExamples: live.length === 0,
  };
}

// ─── the notifications reel ──────────────────────────────────────────────────

export interface NotificationFrameVM {
  kind: 'care' | 'vet' | 'weather' | 'adoptversary' | 'weekly';
  day: string;
  time: string;
  when: string;
  title: string;
  body: string;
}

/**
 * The notification reel — a PRESENTATION SURFACE (like admin-v2 /
 * habits-v2). It builds its frames from real data where it can: the lead
 * `care` frame uses the live face hero's deadpan copy via
 * `generateGuiltTripCopy`; the rest are the canonical voice gallery from
 * the approved pets-notifications.html. Honest stub — reported as such.
 */
export function notificationsReelVM(
  slices: PetsSlices,
  now: number,
): NotificationFrameVM[] {
  const face = petsFaceVM(slices, now);
  const frames: NotificationFrameVM[] = [];
  const dayOf = (offset: number) => fmtClockDay(now + offset * DAY_MS);

  // 1 · care due — built from the real hero when there is one
  if (face.hero) {
    const pet = activePets(slices).find((p) => p.id === face.hero!.petId);
    const gap = resolveCareGaps(slices, now).find(
      (g) => g.pet_id === face.hero!.petId && g.task === face.hero!.task,
    );
    const copy = generateGuiltTripCopy(
      gap ?? null,
      (pet as Pet) ?? null,
      SPECIES_PROFILES[face.hero.species],
    );
    frames.push({
      kind: 'care',
      day: dayOf(0),
      time: '9:41',
      when: 'now',
      title: `${face.hero.petName} · ${face.hero.taskDisplay}`,
      body:
        copy.text ||
        'a day over — top it up when you pass the cage.',
    });
  } else {
    frames.push({
      kind: 'care',
      day: dayOf(0),
      time: '9:41',
      when: 'now',
      title: 'a care task is coming due',
      body: 'a day over is never a crisis — catch it when you pass by.',
    });
  }

  // 2 · vet cue
  frames.push({
    kind: 'vet',
    day: dayOf(2),
    time: '8:30',
    when: '2h ago',
    title: 'vet checkup — book within 2 weeks',
    body: 'a 60-second call — anchor it to your morning coffee.',
  });

  // 3 · weather alert
  frames.push({
    kind: 'weather',
    day: dayOf(4),
    time: '11:15',
    when: 'now',
    title: 'too warm for the cage today — 29°',
    body: "guinea pigs can't cool themselves above 26°. keep the cage out of the sun.",
  });

  // 4 · adoptversary
  frames.push({
    kind: 'adoptversary',
    day: dayOf(6),
    time: '8:00',
    when: 'now',
    title: 'a quiet anniversary today',
    body: 'a year with one of the pets. that’s all — no task attached.',
  });

  // 5 · weekly note (opt-in)
  frames.push({
    kind: 'weekly',
    day: dayOf(12),
    time: '6:00',
    when: 'sun 6pm',
    title: 'your week with the pets',
    body: 'a quiet recap — care logged, what you noticed. arrives only if you asked for it.',
  });

  return frames;
}

// ─── the editorial preface ───────────────────────────────────────────────────

/** the weekly-rotating editorial preface */
export function weeklyPreface(now: number): string {
  const week = Math.floor(
    (now - new Date(new Date(now).getFullYear(), 0, 1).getTime()) /
      (7 * DAY_MS),
  );
  return PREFACES[((week % PREFACES.length) + PREFACES.length) % PREFACES.length];
}
