/**
 * @ollie/events · REGISTRY
 *
 * Every cross-module event name lives here, paired with a human-readable
 * payload shape. The shape strings are documentation — they're printed
 * in console warnings when something emits an unregistered event.
 *
 * Runtime payload validation (typeof checks) lives in shapes.ts.
 *
 * To add a new event:
 *   1. Add it here with a payload-shape comment.
 *   2. If it's high-impact, also add a SHAPES entry in shapes.ts.
 */

export type RegistryEntry = { payload: string };
export type Registry = Record<string, RegistryEntry>;

export const REGISTRY: Registry = {
  // ─── inventory & cycle ──────────────────────────────────────────
  'void:inventory:refill':         { payload: '{ productType: string, absorbency?: string, quantity: number, source: "grocery" | "manual" | "braindump" }' },
  'void:inventory:updated':        { payload: '{ productType: string, count: number, capacity: number }' },
  'void:cycle:started':            { payload: '{ ts: number, source: "user" | "braindump" | "import" }' },
  'void:cycle:closed':             { payload: '{ cycleStartTs: number, cycleEndTs: number, cycleLengthDays: number }' },

  // ─── crisis pathway ─────────────────────────────────────────────
  // Fired before routing; downstream pipeline must not process crisis text.
  'void:crisis:detected':        { payload: '{ text: string, matchedLine: string, ts: number }' },

  // ─── brain dump spine ───────────────────────────────────────────
  'void:braindump:submitted':      { payload: '{ v: 2, items: Array<{module,text,intent,extracted?,confidence,horizon?}>, raw: string, ts: number, idempotency_key: string, route_path: string }  // legacy v:1 shape: { id, text, moduleContext, ts } only on bypassed entrypoints' },
  'void:dump:receipt':             { payload: '{ idempotency_key: string, modules: string[], ts: number, raw: string, source: string|null, route_path: string }' },
  'braindump:routed':              { payload: '{ route_path: string, item_count: number, modules: string[], idempotency_key: string, ts: number }' },
  'braindump:routing_failed':      { payload: '{ raw: string, reason: "cost-capped"|"offline"|"low-confidence", ts: number }' },

  // ─── grocery ────────────────────────────────────────────────────
  'grocery:duplicate_detected':    { payload: '{ name: string, days_since_purchase: number, ts: number }' },
  'grocery:pattern_detected':      { payload: '{ pattern: string, confidence: string, sample_n: number, ts: number }' },

  // ─── cycle prediction & flags ───────────────────────────────────
  'void:prediction:updated':       { payload: '{ nextPeriodTs: number|null, confidence: number, explanation: string }' },
  'void:flag:raised':              { payload: '{ key: string, severity: "info"|"watch"|"discuss", title: string, evidence: string[] }' },
  'void:cycle:symptom_logged':     { payload: '{ ts: number, tags: string[], moduleContext: string }' },
  'void:cycle:asks_changed':       { payload: '{ asks: string[], ts: number }' },

  // ─── pets ───────────────────────────────────────────────────────
  'pets:pet_added':                { payload: '{ pet_id: string, name: string, species: string }' },
  'pets:pet_archived':             { payload: '{ pet_id: string }' },
  'pets:care_logged':              { payload: '{ pet_id: string, task: string, source: string, occurred_at: number }' },
  'pets:observation_logged':      { payload: '{ pet_id: string, text: string, tags: string[] }' },
  'pets:care_gap_detected':        { payload: '{ pet_id: string, task: string, severity: string, days_since: number }' },
  'pets:health_flag_raised':       { payload: '{ pet_id: string, flag: string, run_length: number, source_url: string }' },
  'pets:health_flag_reviewed':     { payload: '{ pet_id: string, flag_id: string, status: string }' },
  'pets:guilt_copy_generated':     { payload: '{ pet_id: string, task: string, level: string, text: string }' },
  'pets:milestone_detected':       { payload: '{ pet_id: string, tag: string, first_seen_at: number }' },
  'pets:away_entered':             { payload: '{ returning_at: number }' },
  'pets:away_exited':              { payload: '{ at: number }' },
  'pets:weather_alert_raised':     { payload: '{ pet_id: string, severity: string, welfare_note: string }' },
  'pets:session_started':          { payload: '{ pet_id: string, at: number }' },
  'pets:session_closed':           { payload: '{ pet_id: string, duration_minutes: number, at: number }' },

  // ─── reminders ──────────────────────────────────────────────────
  'void:reminder:scheduled':       { payload: '{ id: string, fireAt: number, message: string, module: string, source: string }' },
  'void:reminder:fired':           { payload: '{ id: string, fireAt: number }' },
  'void:reminder:dismissed':       { payload: '{ id: string }' },
  'void:reminder:cancelled':       { payload: '{ id: string }' },

  // ─── consumption (B2B panel) ────────────────────────────────────
  'consumption:brand:detected':    { payload: '{ id: string, brand_key: string, category_l1: string, category_l2?: string, confidence: number, source: "braindump"|"finance"|"grocery"|"direct", raw_module: string, ts: number }' },
  'consumption:brand:confirmed':   { payload: '{ id: string, brand_key: string, confirmed_by: "user" }' },
  'consumption:brand:rejected':    { payload: '{ id: string, brand_key: string }' },
  'consumption:event:logged':      { payload: '{ id: string, brand_key: string, category_l1: string, category_l2?: string, source: string, ts: number, context: object }' },
  'consumption:consent:granted':   { payload: '{ granted_at: number, device_id: string }' },
  'consumption:consent:revoked':   { payload: '{ revoked_at: number }' },
  'consumption:sync:queued':       { payload: '{ event_ids: string[], queue_depth: number }' },
  'consumption:sync:flushed':      { payload: '{ flushed_count: number, failed_count: number }' },

  // ─── finance / journal / sleep ──────────────────────────────────
  'finance:record_added':          { payload: '{ id: string, kind?: string, amount: number, direction?: string, merchant?: string, merchant_normalized?: string, category?: string, is_adhd_tax?: boolean, ts?: number }' },
  'finance:pattern_detected':      { payload: '{ pattern: string, confidence: string, ts: number }' },
  'journal:entries_added':         { payload: '{ dump_ts: number, count: number, extractor: string }' },
  'sleep:record_updated':          { payload: '{ night_of: string, is_partial: boolean }' },

  // ─── episodes ───────────────────────────────────────────────────
  'void:episode:opened':           { payload: '{ id: string, label: string, kind: string, started_at: number }' },
  'void:episode:closed':           { payload: '{ id: string, ended_at: number, duration_days: number }' },
  'void:episode:severity_logged':  { payload: '{ id: string, severity: number, ts: number }' },
  'void:episode:med_logged':       { payload: '{ id: string, name: string, dose?: string, ts: number }' },
  'void:signals:updated':          { payload: '{ count: number, ts: number }' },

  // ─── pattern detection (per-module) ─────────────────────────────
  'work:pattern_detected':         { payload: '{ pattern: string, confidence: string, sample_n: number, ts: number }' },
  'body:pattern_detected':         { payload: '{ pattern: string, confidence: string, sample_n: number, ts: number }' },
  'sleep:pattern_detected':        { payload: '{ pattern: string, confidence: string, sample_n: number, ts: number }' },
  'astrology:transit_change':      { payload: '{ aspect: string, planet1: string, planet2: string, ts: number }' },

  // ─── habits ─────────────────────────────────────────────────────
  'habits:pattern_detected':           { payload: '{ pattern: string, confidence: string, sample_n: number, ts: number }' },
  'habits:externalization_detected':   { payload: '{ confidence: string, sample_n: number, ts: number }' },
  'habits:luteal_collapse_detected':   { payload: '{ drop_pct: number, ts: number }' },
  'habits:sensory_preflight_detected': { payload: '{ confidence: string, ts: number }' },
  'habits:interest_hijack_detected':   { payload: '{ habits_affected: number, ts: number }' },
  'habits:stress_collapse_detected':   { payload: '{ confidence: string, ts: number }' },
  'habits:fresh_start_crash':          { payload: '{ confidence: string, ts: number }' },
  'habits:identity_framing':           { payload: '{ confidence: string, ts: number }' },
  'habits:body_vs_cognitive':          { payload: '{ confidence: string, ts: number }' },
  'habits:drift':                      { payload: '{ habit_id: string, drop_pct: number, ts: number }' },
  'habits:friction_signature':         { payload: '{ habit_id: string, worst_day: string, ts: number }' },
  'habits:sleep_coupling':             { payload: '{ confidence: string, ts: number }' },
  'habits:rebirth_pattern':            { payload: '{ rebirths_n: number, ts: number }' },
  'habits:self_talk_drop':             { payload: '{ confidence: string, ts: number }' },

  // ─── goals ──────────────────────────────────────────────────────
  'goals:pattern_detected':            { payload: '{ pattern: string, confidence: string, sample_n: number, ts: number }' },
  'goals:low_mood_detected':           { payload: '{ confidence: string, ts: number, lock_until_ts: number }' },
  'goals:obstacle_echo_detected':      { payload: '{ goal_id: string, dump_id: string, matches: number, ts: number }' },
  'goals:premortem_echo_detected':     { payload: '{ goal_id: string, dump_id: string, ts: number }' },
  'goals:ulysses_presented':           { payload: '{ goal_id: string, action: string, ts: number }' },
  'goals:active_cap_exceeded':         { payload: '{ active_count: number, ts: number }' },
  'goals:research_as_progress':        { payload: '{ goal_id: string, thinking_count: number, ts: number }' },
  'goals:identity_drift':              { payload: '{ goal_id: string, role: string, days_silent: number, ts: number }' },
  'goals:sunk_cost_flag':              { payload: '{ goal_id: string, ts: number }' },
  'goals:pacing_classified':           { payload: '{ goal_id: string, pacing: string, ts: number }' },
  'goals:pacing_breach':               { payload: '{ goal_id: string, pacing: string, days_since: number, ts: number }' },
  'goals:contagion':                   { payload: '{ source_excerpt: string, ts: number }' },
  'goals:missing_anchor_pair':         { payload: '{ goal_id: string, anchor_type: string, missing: string, ts: number }' },
  'goals:floating_goal':               { payload: '{ goal_id: string, reason: string, depth: number, ts: number }' },
  'goals:missing_construal':           { payload: '{ goal_id: string, missing: string, ts: number }' },
  'goals:anti_goal_opportunity':       { payload: '{ goal_id: string, mode: string, ts: number }' },
  'goals:anti_goal_in_dump':           { payload: '{ excerpt: string, ts: number }' },
  'goals:interference':                { payload: '{ conflict_count: number, ts: number }' },
  'goals:experiment_candidate':        { payload: '{ goal_id: string, weeks_stuck: number, ts: number }' },

  // ─── admin ──────────────────────────────────────────────────────
  'admin:open_loop_missing':           { payload: '{ dump_id: string, ts: number }' },
  'admin:phone_task_detected':         { payload: '{ verb: string, ts: number }' },
  'admin:renewal_cue':                 { payload: '{ task_id: string, stage: string, days_left: number, ts: number }' },
  'admin:stale_ball':                  { payload: '{ task_id: string, kind: string, days_overdue: number, ts: number }' },
  'admin:activation_classified':       { payload: '{ task_id: string, tier: number, fits_state: boolean, ts: number }' },
  'admin:last_5pct':                   { payload: '{ task_id: string, days_since_done: number, ts: number }' },
  'admin:paperwork_split':             { payload: '{ task_id?: string, dump_match?: boolean, ts: number }' },
  'admin:firehose_dump':               { payload: '{ candidate_count: number, ts: number }' },
  'admin:defer_chain':                 { payload: '{ task_id: string, defer_count: number, ts: number }' },
  'admin:two_minute_tasks':            { payload: '{ count: number, batch: boolean, ts: number }' },
  'admin:recurring_pattern':           { payload: '{ category_or_label: string, predicted_next_ts: number, ts: number }' },
};
