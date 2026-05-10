/**
 * @ollie/logic · pets constants
 */

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

/** Offsets (in days before due) at which vet-cue notifications fire. */
export const VET_CUE_OFFSETS_DAYS: readonly number[] = [14, 3, 0] as const;

/** Default linked-event suggestions when no habit state is available. */
export const DEFAULT_EVENT_SUGGESTIONS: readonly string[] = [
  'when you fill the kettle',
  'after morning coffee',
  'when you open the pet folder',
] as const;

/** Negation detection window (tokens before the matched keyword). */
export const NEGATION_WINDOW = 4;

/** Tokens that negate a care-task match in a brain dump sentence. */
export const NEGATION_MARKERS: readonly string[] = [
  "didn't", 'didnt', "haven't", 'havent',
  "still haven't", 'still havent',
  'forgot to', 'need to', 'gonna', 'gotta', 'should',
  'tomorrow', 'later',
] as const;

/** Projection regex — matches human-attributing phrases in brain dumps. */
export const PROJECTION_RE =
  /\b(?:she'?s\s+mad|he'?s\s+mad|she\s+hates|he\s+hates|punishing|grudge|won'?t\s+forgive|disappointed\s+in\s+me|holding\s+a\s+grudge|mad\s+at\s+me)\b/i;

/** Human-readable task label map. */
export const TASK_DISPLAY: Record<string, string> = {
  hay_refill: 'hay refill',
  cage_clean: 'cage clean',
  vitamin_c: 'vitamin c',
  fresh_veg: 'fresh veggies',
  water_refresh: 'water change',
  nail_trim: 'nail trim',
  floor_time: 'floor time',
  vet_checkup: 'vet checkup',
  feed: 'feed',
  habitat_clean: 'habitat clean',
  health_observation: 'health check-in',
  uvb_bulb_check: 'uvb bulb check',
  tank_water_change: 'tank water change',
  fresh_hay: 'fresh hay',
  litter_change: 'litter change',
  cuttlebone_check: 'cuttlebone check',
  wheel_check: 'wheel check',
  basking_temp: 'basking temp check',
  substrate_spot_clean: 'substrate spot clean',
  water_test: 'water test',
  filter_check: 'filter check',
  walk: 'walk',
};

/** Editorial prefaces — rotated by ISO week. */
export const PREFACES: readonly string[] = [
  'a pet is a record of your attention.',
  'the smallest animals notice the most.',
  'consistency is the whole game.',
  "they don't need you to be good. they need you to be there.",
  'observation beats intervention. usually.',
] as const;

/** Severity ladder used for cold-start downgrade. */
export const SEVERITY_LADDER = ['ok', 'nudge', 'soft', 'firm', 'concerned'] as const;
