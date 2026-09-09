/**
 * Module metadata — the lightweight single source of truth for the module set
 * (audit #178/#16). Holds NO component imports, so importing it (e.g. from
 * useDeepLinks for the deep-link allowlist) does NOT eagerly pull every Box →
 * repo → storage adapter at module load. moduleRegistry.ts attaches the
 * components on top of this for the Router.
 */
import type { FeatureFlag } from '../settings/features';

/** Index-screen rooms — see memory: project_ollie_4_modules_grouping. */
export type ModuleGroupId = 'you' | 'your-stuff' | 'your-responsibilities';

export interface ModuleMeta {
  /** Stable module id; the `box/<id>` path segment. */
  id: string;
  /** Index-screen label. */
  label: string;
  /** Index-screen one-line hint. */
  hint: string;
  /** Which index room it lives in. */
  group: ModuleGroupId;
  /** When set, the route + index entry only appear if this flag is on. */
  flag?: FeatureFlag;
}

export const MODULE_META: ModuleMeta[] = [
  // ─── you ───────────────────────────────────────────────────────────────
  { id: 'body', label: 'Body', hint: 'water, movement, symptoms', group: 'you' },
  { id: 'mood', label: 'Mood', hint: 'feelings, energy, self-talk', group: 'you' },
  { id: 'sleep', label: 'Sleep', hint: 'logs + insomnia', group: 'you' },
  { id: 'cycle', label: 'Cycle', hint: 'period + symptoms', group: 'you' },
  { id: 'medication', label: 'Medication', hint: 'doses + side effects', group: 'you' },
  { id: 'habits', label: 'Habits', hint: 'what you do', group: 'you', flag: 'habits' },
  { id: 'goals', label: 'Goals', hint: "what you're moving toward", group: 'you', flag: 'goals' },
  { id: 'partner', label: 'Partner', hint: 'an intimate window', group: 'you', flag: 'partner' },
  // ─── your stuff ──────────────────────────────────────────────────────────
  { id: 'grocery', label: 'Grocery', hint: 'pantry + shopping', group: 'your-stuff' },
  { id: 'chores', label: 'Chores', hint: 'cleaning + upkeep', group: 'your-stuff' },
  { id: 'pets', label: 'Pets', hint: 'tontin + pinpon', group: 'your-stuff', flag: 'pets' },
  // ─── your responsibilities ───────────────────────────────────────────────
  { id: 'work', label: 'Work', hint: 'tasks + deadlines', group: 'your-responsibilities' },
  { id: 'admin', label: 'Admin', hint: 'renewals + paperwork', group: 'your-responsibilities' },
  { id: 'finance', label: 'Finance', hint: 'transactions + bills', group: 'your-responsibilities' },
];

/** Set of all known module ids — the deep-link / route allowlist (audit #16). */
export const MODULE_IDS: ReadonlySet<string> = new Set(MODULE_META.map((m) => m.id));

/** Group display metadata, in render order. */
export const MODULE_GROUP_META: { id: ModuleGroupId; label: string; aside: string }[] = [
  { id: 'you', label: 'you', aside: 'how you are this week.' },
  { id: 'your-stuff', label: 'your stuff', aside: "what's in the kitchen, who's in the house." },
  { id: 'your-responsibilities', label: 'your responsibilities', aside: "things that won't wait." },
];
