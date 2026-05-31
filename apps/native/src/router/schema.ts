/**
 * Brain-dump router schema · v1.0
 *
 * Contract between the brain-dump router (AI + cache) and downstream modules.
 *
 * Flow:
 *   user dump  →  router  →  RouterOutput  →  module action handlers
 *
 * Modules read RouterOutput.fragments, filter for their own `module` value,
 * and execute the action described in `payload`. Modules NEVER call AI
 * themselves — the router is the single AI surface.
 *
 * Crisis detection is FIRST and can short-circuit all other routing.
 */

// ─────────────────────────────────────────────────────────────────────
// MODULE REGISTRY · keep in sync with apps/native/src/modules/*
// ─────────────────────────────────────────────────────────────────────

export type Module =
  | 'crisis'      // priority — short-circuits all other routing
  | 'work'
  | 'admin'
  | 'pets'
  | 'cycle'
  | 'finance'
  | 'sleep'
  | 'body'
  | 'habits'
  | 'goals'
  | 'grocery'
  | 'medication'
  | 'dump_only';  // catch-all: archive only, no module action

// ─────────────────────────────────────────────────────────────────────
// TOP-LEVEL ROUTER OUTPUT
// ─────────────────────────────────────────────────────────────────────

export interface RouterOutput {
  schemaVersion: '1.0';

  // The original dump, always preserved + archived
  originalDump: string;
  dumpId: string;          // archive lookup key
  timestamp: number;       // ms since epoch
  language: 'en' | 'es' | 'tr' | 'mixed' | 'unknown';

  // Crisis detection — ALWAYS run first. If true, UI shows crisis screen
  // and per-fragment routing is paused until user dismisses.
  crisis?: CrisisSignal;

  // Routed fragments — one input can split into N
  fragments: Fragment[];

  // Routing telemetry for UI + analytics
  summary: RoutingSummary;

  /**
   * True when the dump payload included an image and the worker ran the
   * vision pipeline on it. UI uses this to render a quiet "from your photo"
   * badge on the resulting fragment cards. Backwards-compatible: legacy
   * text-only responses simply omit this field.
   */
  visionUsed?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// CRISIS SIGNAL · highest priority
// ─────────────────────────────────────────────────────────────────────

export interface CrisisSignal {
  detected: true;
  type: 'ideation' | 'method_seeking' | 'distress' | 'panic';
  confidence: number;      // 0..1
  language: 'en' | 'es' | 'tr';
}

// ─────────────────────────────────────────────────────────────────────
// FRAGMENT · one classified slice of the dump
// ─────────────────────────────────────────────────────────────────────

export interface Fragment {
  text: string;
  /** Per-fragment language (router does per-fragment detection). */
  language: 'tr' | 'en' | 'es' | 'mixed' | 'unknown';
  module: Module;
  payload: ActionPayload;
  confidence: number;
  /** Server-side 3-tier policy: true when 0.60 ≤ confidence < 0.80. */
  needsConfirm?: boolean;
  source: 'cache' | 'ai' | 'fast_path';
}

// ─────────────────────────────────────────────────────────────────────
// ROUTING SUMMARY · displayed back to user after dump
// ─────────────────────────────────────────────────────────────────────

export interface RoutingSummary {
  moduleCount: Partial<Record<Module, number>>; // { grocery: 2, body: 1 }
  cacheHitRate: number;    // 0..1
  aiCalls: number;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// ACTION PAYLOAD · per-module discriminated union
// Each module's handler exhaustively matches on `action`.
// Add new actions here; module handlers fail to compile until updated.
// ─────────────────────────────────────────────────────────────────────

export type ActionPayload =
  | BodyAction
  | WorkAction
  | AdminAction
  | PetsAction
  | CycleAction
  | FinanceAction
  | SleepAction
  | HabitsAction
  | GoalsAction
  | GroceryAction
  | MedicationAction
  | DumpOnlyAction;

// ── BODY ─────────────────────────────────────────────────────────────

export type BodyAction =
  | { module: 'body'; action: 'log_symptom'; symptom: string; severity?: 1 | 2 | 3 | 4 | 5; bodyPart?: string }
  | { module: 'body'; action: 'log_water'; amountMl?: number }
  | { module: 'body'; action: 'log_supplement'; name: string; dose?: string }
  | { module: 'body'; action: 'log_episode'; kind: string; duration?: string }
  | { module: 'body'; action: 'log_posture' }
  | { module: 'body'; action: 'log_hunger' }
  /**
   * Movement / exercise. Primary route for "went on a 20 min walk", "stretched",
   * "did 10 reps". MAY multi-route to habits.complete in parallel when the user
   * has a corresponding habit registered (see ARCH_DECISION_NEEDED.md →
   * "movement routes to BOTH body and habits per context"). Downstream concern.
   *
   * `pet` is an optional side-effect hint — when the movement involved a pet
   * ("walked the dog", "tontin'i gezdirdim") the AI populates the proper-noun
   * name so the body handler can mirror to pets.log_care. Following grocery's
   * price→finance convention (Approach B: primary handler emits secondary,
   * see grocery/handler.ts ~line 32-55 for rationale).
   */
  | { module: 'body'; action: 'log_movement'; type: 'walk' | 'stretch' | 'lift' | string; duration_min?: number; pet?: string };

// ── WORK ─────────────────────────────────────────────────────────────

export type WorkAction =
  /**
   * `skipped_meals` is an optional side-effect hint — when the user mentions
   * a hyperfocus / deep-work block paired with not eating ("hyperfocused all
   * morning, didn't eat") the AI sets it true so the work handler can mirror
   * to body.log_hunger. Approach B (see grocery/handler.ts).
   */
  | { module: 'work'; action: 'log_focus_session'; durationMin?: number; project?: string; skipped_meals?: boolean }
  | { module: 'work'; action: 'create_task'; text: string; project?: string; remindIn?: RemindIn }
  | { module: 'work'; action: 'log_deadline'; text: string; dueDate?: string }
  | { module: 'work'; action: 'log_meeting'; with?: string; durationMin?: number }
  | { module: 'work'; action: 'distraction_journal'; what: string }
  /**
   * Start a focus/work timer. "start a timer" / "set a 25 min timer". The
   * handler schedules a background system notification at now + duration
   * (default 30 min) via scheduleAt — fires even if the app is closed.
   */
  | { module: 'work'; action: 'start_timer'; durationMin?: number };

// ── ADMIN ────────────────────────────────────────────────────────────

/**
 * Time-deferred reminder hint (Approach B). The worker may attach a
 * `remindIn` field to admin / work tasks when the user dumps
 * "remind me to X in N min/hour/day". `scheduledAtMs` is computed
 * server-side in `workers/ai-proxy/src/router/remindIn.ts` against the
 * worker's `Date.now()` so handlers don't redo clock math. The handler
 * fires a single system notification at that timestamp.
 */
export interface RemindIn {
  amount: number;
  unit: 'sec' | 'min' | 'hr' | 'day';
  scheduledAtMs: number;
}

export type AdminAction =
  | { module: 'admin'; action: 'create_task'; text: string; remindIn?: RemindIn }
  | { module: 'admin'; action: 'create_phone_task'; person: string; reason?: string; remindIn?: RemindIn }
  | { module: 'admin'; action: 'schedule_appointment'; what: string; date?: string }
  | { module: 'admin'; action: 'log_paperwork'; what: string }
  | { module: 'admin'; action: 'recurring_decision'; what: string }
  /**
   * Renewal events that need staged cues at -90/-30/-7 days before due_date.
   * Distinct from `recurring_decision` (which is about repeating choices like
   * subscription continuation), this is paperwork-with-expiry. Cofounder brief.
   */
  | { module: 'admin'; action: 'log_renewal'; renewal_type: 'passport' | 'license' | 'lease' | 'insurance' | string; due_date?: string };

// ── PETS ─────────────────────────────────────────────────────────────

export type PetsAction =
  | { module: 'pets'; action: 'log_care'; petName?: string; what: string }
  | { module: 'pets'; action: 'log_observation'; petName?: string; note: string }
  | { module: 'pets'; action: 'log_vet'; petName?: string; reason?: string }
  | { module: 'pets'; action: 'log_feed'; petName?: string }
  /**
   * Supplement logging — critical for guinea pigs (Tontin, Pinpon) who need
   * daily vitamin C (scurvy risk on missed doses). Tracked explicitly with
   * a typed `supplement` slot rather than folded into generic `log_care`.
   */
  | { module: 'pets'; action: 'log_supplement'; supplement: 'vitamin_c' | 'vitamin_d' | 'calcium' | string; dose?: string; petName?: string; pet_id?: string };

// ── CYCLE ────────────────────────────────────────────────────────────

export type CycleAction =
  | { module: 'cycle'; action: 'log_period_start' }
  | { module: 'cycle'; action: 'log_period_end' }
  | { module: 'cycle'; action: 'log_symptom'; symptom: string }
  | { module: 'cycle'; action: 'pill_logged' };

// ── FINANCE ──────────────────────────────────────────────────────────

export type FinanceAction =
  | { module: 'finance'; action: 'log_transaction'; amount?: number; currency?: string; merchant?: string }
  | { module: 'finance'; action: 'add_bill'; merchant: string; amount?: number; cadence?: 'monthly' | 'yearly' | 'weekly' }
  | { module: 'finance'; action: 'savings_note'; amount?: number; note?: string }
  // amount/currency/cadence are optional — the worker emits them when the
  // user states a price/cadence ("netflix $15/month"); the native handler
  // stores them so subscriptions feed the monthly-burn headline at the
  // correct amortised rate.
  | { module: 'finance'; action: 'subscription_log'; name: string; amount?: number; currency?: string; cadence?: 'monthly' | 'yearly' | 'weekly' };

// ── SLEEP ────────────────────────────────────────────────────────────

export type SleepAction =
  | { module: 'sleep'; action: 'log_sleep'; bedtime?: string; wake?: string; quality?: 1 | 2 | 3 | 4 | 5; hours?: number }
  | { module: 'sleep'; action: 'wind_down_note'; note: string }
  | { module: 'sleep'; action: 'dream_log'; text: string }
  /**
   * Insomnia — semantically distinct from `log_sleep` with quality 1.
   * "Didn't sleep at all" vs "slept 4h badly" are different downstream
   * (insomnia detector pattern, sleep-onset analysis, etc.).
   *
   * `med_taken` is an optional side-effect hint — when the insomnia mention
   * is paired with a sleep aid ("couldn't sleep so took melatonin") the AI
   * populates the med name (and `med_dose` when given) so the sleep handler
   * can mirror to medication.log_dose. Approach B (see grocery/handler.ts).
   */
  | { module: 'sleep'; action: 'log_insomnia'; duration_attempted_min?: number; woke_count?: number; med_taken?: string; med_dose?: string };

// ── HABITS ───────────────────────────────────────────────────────────

export type HabitsAction =
  | { module: 'habits'; action: 'complete'; habitName: string }
  | { module: 'habits'; action: 'streak_break_note'; habitName: string; reason?: string }
  | { module: 'habits'; action: 'identity_statement'; text: string };

// ── GOALS ────────────────────────────────────────────────────────────

export type GoalsAction =
  | { module: 'goals'; action: 'progress_note'; goalName?: string; note: string }
  | { module: 'goals'; action: 'create_goal'; what: string; why?: string }
  | { module: 'goals'; action: 'milestone_hit'; goalName?: string; milestone: string }
  | { module: 'goals'; action: 'obstacle_note'; goalName?: string; obstacle: string };

// ── GROCERY ──────────────────────────────────────────────────────────

export type GroceryAction =
  // price/currency present when the user states a cost ("bought milk for
  // $5") — the grocery handler mirrors them to a finance transaction
  // (primary grocery, side-effect finance; see grocery/handler.ts).
  | { module: 'grocery'; action: 'pantry_add'; item: string; quantity?: string; price?: number; currency?: string }
  | { module: 'grocery'; action: 'pantry_use'; item: string }
  /**
   * "Out of X" / ran out / used up — depletion. Unlike `pantry_use` (just
   * consumed, no rebuy) this means the user no longer has it AND needs more:
   * the handler removes it from the pantry AND adds it to the shopping list.
   */
  | { module: 'grocery'; action: 'pantry_depleted'; item: string }
  | { module: 'grocery'; action: 'shopping_list_add'; item: string }
  | { module: 'grocery'; action: 'meal_request'; query: string }
  | { module: 'grocery'; action: 'recipe_cooked'; name: string }
  /**
   * "Running low" warning — distinct from `shopping_list_add` (which is
   * "buy this next trip"). The flag triggers a soft cue without committing
   * the item to the active shopping list.
   */
  | { module: 'grocery'; action: 'pantry_low_flag'; item: string };

// ── MEDICATION ───────────────────────────────────────────────────────

export type MedicationAction =
  | { module: 'medication'; action: 'log_dose'; medName: string; dose?: string }
  | { module: 'medication'; action: 'missed_dose'; medName: string }
  | { module: 'medication'; action: 'side_effect_note'; medName: string; note: string };

// ── DUMP_ONLY · catch-all ────────────────────────────────────────────

export type DumpOnlyAction =
  | { module: 'dump_only'; action: 'archive_only'; reason?: 'no_module_match' | 'low_confidence' | 'user_only' };

// ─────────────────────────────────────────────────────────────────────
// MODULE HANDLER CONTRACT · what every module exports
// ─────────────────────────────────────────────────────────────────────

export interface ModuleHandler<M extends Module> {
  module: M;
  /**
   * Apply a routed fragment to the module's local state + backend.
   * Returns a UI-displayable note (e.g., "added milk to pantry").
   */
  apply(fragment: Fragment): Promise<HandlerResult>;
}

export interface HandlerResult {
  ok: boolean;
  /** Short editorial summary for the JournalNoticed surface */
  note?: string;
  /** Optional deep-link path (e.g., '/box/grocery?item=milk') */
  deepLink?: string;
  /** Set when handler wants the user to confirm before persisting */
  needsConfirm?: boolean;
  /**
   * Real undo for the needsConfirm card. When the handler writes a row, it
   * captures the row id and returns a closure that removes it. Omitted when
   * the handler did not persist (dump_only, validation reject, etc.).
   */
  undo?: () => Promise<void>;
}
