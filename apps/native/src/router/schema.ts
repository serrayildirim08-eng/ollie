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
  language: 'en' | 'es' | 'tr' | 'unknown';

  // Crisis detection — ALWAYS run first. If true, UI shows crisis screen
  // and per-fragment routing is paused until user dismisses.
  crisis?: CrisisSignal;

  // Routed fragments — one input can split into N
  fragments: Fragment[];

  // Routing telemetry for UI + analytics
  summary: RoutingSummary;
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
  text: string;            // the slice of original dump
  module: Module;
  payload: ActionPayload;  // discriminated union by `action` field
  confidence: number;      // 0..1 — UI surfaces low-confidence for confirm
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
  | { module: 'body'; action: 'log_hunger' };

// ── WORK ─────────────────────────────────────────────────────────────

export type WorkAction =
  | { module: 'work'; action: 'log_focus_session'; durationMin?: number; project?: string }
  | { module: 'work'; action: 'create_task'; text: string; project?: string }
  | { module: 'work'; action: 'log_deadline'; text: string; dueDate?: string }
  | { module: 'work'; action: 'log_meeting'; with?: string; durationMin?: number }
  | { module: 'work'; action: 'distraction_journal'; what: string };

// ── ADMIN ────────────────────────────────────────────────────────────

export type AdminAction =
  | { module: 'admin'; action: 'create_task'; text: string }
  | { module: 'admin'; action: 'create_phone_task'; person: string; reason?: string }
  | { module: 'admin'; action: 'schedule_appointment'; what: string; date?: string }
  | { module: 'admin'; action: 'log_paperwork'; what: string }
  | { module: 'admin'; action: 'recurring_decision'; what: string };

// ── PETS ─────────────────────────────────────────────────────────────

export type PetsAction =
  | { module: 'pets'; action: 'log_care'; petName?: string; what: string }
  | { module: 'pets'; action: 'log_observation'; petName?: string; note: string }
  | { module: 'pets'; action: 'log_vet'; petName?: string; reason?: string }
  | { module: 'pets'; action: 'log_feed'; petName?: string };

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
  | { module: 'finance'; action: 'subscription_log'; name: string };

// ── SLEEP ────────────────────────────────────────────────────────────

export type SleepAction =
  | { module: 'sleep'; action: 'log_sleep'; bedtime?: string; wake?: string; quality?: 1 | 2 | 3 | 4 | 5 }
  | { module: 'sleep'; action: 'wind_down_note'; note: string }
  | { module: 'sleep'; action: 'dream_log'; text: string };

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
  | { module: 'grocery'; action: 'pantry_add'; item: string; quantity?: string }
  | { module: 'grocery'; action: 'pantry_use'; item: string }
  | { module: 'grocery'; action: 'shopping_list_add'; item: string }
  | { module: 'grocery'; action: 'meal_request'; query: string }
  | { module: 'grocery'; action: 'recipe_cooked'; name: string };

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
  apply(fragment: Extract<Fragment, { module: M }>): Promise<HandlerResult>;
}

export interface HandlerResult {
  ok: boolean;
  /** Short editorial summary for the JournalNoticed surface */
  note?: string;
  /** Optional deep-link path (e.g., '/box/grocery?item=milk') */
  deepLink?: string;
  /** Set when handler wants the user to confirm before persisting */
  needsConfirm?: boolean;
}
