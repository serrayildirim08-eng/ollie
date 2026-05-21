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
  'void:cycle:closed':             { payload: '{ cycleStartTs: number, cycleEndTs: number, cycleLengthDays: number }' },

  // ─── crisis pathway ─────────────────────────────────────────────
  // Fired before routing. Carries NO content — only a timestamp — so crisis
  // text never enters the event bus or the retention bridge. Day30Prompt
  // listens to this to suppress its prompt for the rest of the session.
  'void:crisis:detected':        { payload: '{ ts: number }' },

  // ─── brain dump spine ───────────────────────────────────────────
  'void:braindump:submitted':      { payload: '{ v: 2, items: Array<{module,text,intent,extracted?,confidence,horizon?}>, raw: string, ts: number, idempotency_key: string, route_path: string }  // legacy v:1 shape: { id, text, moduleContext, ts } only on bypassed entrypoints' },
  'void:dump:receipt':             { payload: '{ idempotency_key: string, modules: string[], ts: number, raw: string, source: string|null, route_path: string }' },
  'braindump:routed':              { payload: '{ route_path: string, item_count: number, modules: string[], idempotency_key: string, ts: number }' },
  'braindump:routing_failed':      { payload: '{ raw: string, reason: "cost-capped"|"offline"|"low-confidence", ts: number }' },

  // ─── grocery ────────────────────────────────────────────────────
  'grocery:duplicate_detected':    { payload: '{ name: string, days_since_purchase: number, ts: number }' },
  'grocery:pattern_detected':      { payload: '{ pattern: string, confidence: string, sample_n: number, ts: number }' },

  // ─── grocery · AI routing (frontend hook + SortedToast contract) ─
  // Backend agent (T0/T1/T2) will own the producer side. Frontend
  // subscribes via apps/web/src/hooks/useGroceryRouting.ts. The shape
  // string below is the contract — backend should match it 1:1 when
  // they finalize packages/events/src/grocery-routing.ts.
  // `pending` fires synchronously on submit (instant UI feedback);
  // `routed` fires once the router (cache hit or Gemini call) returns.
  // `source` distinguishes instant cache-hits ("cache") from
  // delayed Gemini calls ("gemini") and the deterministic fallback
  // path ("fallback") that runs when AI is offline / cost-capped.
  'grocery:routing:pending':       { payload: '{ idempotency_key: string, raw: string, ts: number }' },
  'grocery:routed':                { payload: '{ idempotency_key: string, raw: string, items: Array<{ name: string, target: "shopping"|"pantry", recipe_parent?: string }>, source: "cache"|"gemini"|"fallback", latency_ms: number, ts: number, error?: string }' },

  // ─── grocery · Feed Me v2 (frontend hook + telemetry contract) ──
  // Spec: docs/handoffs/feed-me/00-SPEC.md. The frontend FeedMeView
  // emits all four; backend is free to ignore. Reserved for research
  // stream + B2B activation funnel ingestion.
  //   `requested`  — fires when the hook fetches a fresh suggestion set.
  //   `suggested`  — fires when suggestions resolve (any source).
  //   `cooked`     — fires when the user records a cook via the modal.
  //   `rejected`   — fires when the user dismisses a card with "× not this".
  'feedme:requested':              { payload: '{ pantryCount: number, diet: string, feedTarget: "user"|"pet", ts: number }' },
  'feedme:suggested':              { payload: '{ source: "gemini"|"cache_hit"|"static_fallback", count: number, latencyMs: number, ts: number }' },
  'feedme:cooked':                 { payload: '{ dish: string, rating: -1|0|1, ts: number }' },
  'feedme:rejected':               { payload: '{ dish: string, ts: number }' },

  // ─── cycle prediction & flags ───────────────────────────────────
  'void:cycle:symptom_logged':     { payload: '{ ts: number, tags: string[], moduleContext: string }' },
  'void:cycle:asks_changed':       { payload: '{ asks: string[], ts: number }' },

  // ─── research pipeline (Sprint B' 2026-05-14) ───────────────────
  // Emitted by upstream module orchestrators when a scrubbable row is
  // written. Research orchestrator buffers + flushes through scrub → /label.
  // Consent check is on the orchestrator side; emitters do not gate.
  'research:row_written':          { payload: '{ row_id: string, table: "brain_dump_log" | "finance_records" | "body_records" | "home_records" | "work_records", text: string, locale: "en" | "es" | "tr", sector_hint?: string, ts: number }' },

  // ─── pets ───────────────────────────────────────────────────────
  'pets:pet_added':                { payload: '{ pet_id: string, name: string, species: string }' },
  'pets:pet_archived':             { payload: '{ pet_id: string }' },
  'pets:care_logged':              { payload: '{ pet_id: string, task: string, source: string, occurred_at: number }' },
  'pets:observation_logged':      { payload: '{ pet_id: string, text: string, tags: string[] }' },
  'pets:care_gap_detected':        { payload: '{ pet_id: string, task: string, severity: string, days_since: number }' },
  'pets:health_flag_raised':       { payload: '{ pet_id: string, pet_name: string, flag: string, run_length: number, source_url: string }' },
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
  'void:toast':                    { payload: '{ message: string, module: string }' },

  // ─── consent (B2B pivot 2026-05-14) ─────────────────────────────
  // Fires every time consent state is persisted via @ollie/consent
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

  // ─── sleep · wind-down checklist (feature 12 / AUDIT_body_v2 hyp #6) ────
  // Sequential 6-item bedtime ritual; started fires on first tap of the night,
  // completed when the final item is checked, skipped if dismissed mid-flow.
  'sleep:wind_down_started':       { payload: '{ ts: number }' },
  'sleep:wind_down_completed':     { payload: '{ ts: number, durationMs: number, itemsCompleted: number }' },
  'sleep:wind_down_skipped':       { payload: '{ ts: number, itemsCompleted: number }' },
  // Per-step row — emitted once per ritual-item tap. The sleep orchestrator
  // subscribes and appends each to sleep.windDownLog for detectWindDownFriction.
  'sleep:wind_down_step':          { payload: '{ ts: number, step_id: string, step_label?: string, action: "checked"|"unchecked" }' },

  // ─── episodes ───────────────────────────────────────────────────
  'void:episode:opened':           { payload: '{ id: string, label: string, kind: string, started_at: number }' },
  'void:episode:closed':           { payload: '{ id: string, ended_at: number, duration_days: number }' },
  'void:episode:severity_logged':  { payload: '{ id: string, severity: number, ts: number }' },
  'void:episode:med_logged':       { payload: '{ id: string, name: string, dose?: string, ts: number }' },
  'void:signals:updated':          { payload: '{ count: number, ts: number }' },

  // ─── pattern detection (per-module) ─────────────────────────────
  'work:pattern_detected':         { payload: '{ pattern: string, confidence: string, sample_n: number, ts: number }' },
  'work:matters_routed':           { payload: '{ filed: number, loose: number, suggestions: number, ts: number }' },
  'body:pattern_detected':         { payload: '{ pattern: string, confidence: string, sample_n: number, ts: number }' },
  'sleep:pattern_detected':        { payload: '{ pattern: string, confidence: string, sample_n: number, ts: number }' },
  'pattern:caffeine_sleep_detected': { payload: '{ correlation: number, threshold: { hours: number, minutes: number } | null, sampleSize: number, copy: string, ts: number }' },
  'pattern:detected':              { payload: '{ correlation_name: string, correlation: number, sample_size: number, copy: string, ts: number }' },
  'astrology:transit_change':      { payload: '{ aspect: string, planet1: string, planet2: string, ts: number }' },

  // ─── habits ─────────────────────────────────────────────────────
  'habits:completed':                  { payload: '{ habitId: string, category: "health"|"mental"|"home"|"work"|"self_care", habitName: string, ts: number }' },
  'habits:pattern_detected':           { payload: '{ pattern: string, confidence: string, sample_n: number, ts: number }' },
  'habits:externalization_detected':   { payload: '{ confidence: string, sample_n: number, ts: number }' },
  'habits:luteal_collapse_detected':   { payload: '{ drop_pct: number, ts: number }' },
  'habits:sensory_preflight_detected': { payload: '{ confidence: string, ts: number }' },
  'habits:interest_hijack_detected':   { payload: '{ habits_affected: number, ts: number }' },
  'habits:stress_collapse_detected':   { payload: '{ confidence: string, ts: number }' },
  'habits:fresh_start_crash':          { payload: '{ confidence: string, ts: number }' },
  'habits:identity_framing':           { payload: '{ confidence: string, ts: number }' },
  'habits:body_vs_cognitive':          { payload: '{ confidence: string, ts: number }' },
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
  // audit task 15 (2026-05-14) — per-category completion velocity
  'goals:velocity_pattern':            { payload: '{ category: string, total: number, completed: number, velocity: number, avg_days_to_complete: number, ts: number }' },
  // ─── audit 2026-05-14 · goal → habit cross-dispatch ─────────────
  // UI fires this when the user taps "convert to habit" on a goal
  // detail card. habits orchestrator listens + appends a new Habit
  // into shared.habits_v2.
  'goals:convert_to_habit':            { payload: '{ goal_id: string, habit_title: string, cadence: "daily"|"weekly"|"weekdays"|"custom", ts: number }' },

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
  'admin:appointment_completed':       { payload: '{ task_id: string, kind?: "doctor"|"appointment"|"other", ts: number }' },
  'admin:reflect_upcoming':            { payload: '{ source_event: string, source_module: string, kind: string, due_at: number, message: string, ts: number }' },

  // ─── Sprint 3 / D1 burhan life-event tree ───────────────────────
  // Constitutional: tree never decays. Elements are append-only.
  'burhan:element_added':              { payload: '{ id: string, type: "leaf"|"gold_leaf"|"fruit"|"flower"|"canopy_fruit", source_module: string, source_event_id: string, ts: number }' },
  'burhan:add_leaf':                   { payload: '{ source_module: string, source_event_id: string, ts: number }' },
  'burhan:add_gold_leaf':              { payload: '{ source_module: string, source_event_id: string, ts: number }' },
  'burhan:add_fruit':                  { payload: '{ source_module: string, source_event_id: string, ts: number }' },
  'burhan:add_flower':                 { payload: '{ source_module: string, source_event_id: string, ts: number }' },
  'burhan:add_canopy_fruit':           { payload: '{ source_module: string, source_event_id: string, ts: number }' },

  // ─── Sprint 3 / D3 finance pattern alerts (Canva-style) ─────────
  'finance:subscription_detected':     { payload: '{ pattern_id: string, merchant: string, amount: number, cadence: "monthly"|"quarterly"|"yearly", occurrence_count: number, ts: number }' },
  'finance:adhd_tax_updated':          { payload: '{ total_30d: number, count_30d: number, ts: number }' },
  'finance:cycle_spending_pattern_detected': { payload: '{ luteal_ratio: number, follicular_median: number, luteal_median: number, cycle_count: number, ts: number }' },
  'finance:spending_spike_detected':   { payload: '{ amount: number, baseline_median: number, ratio: number, ts: number }' },
  'finance:reminder_set':              { payload: '{ pattern_id: string, due_at: number, kind: "bill"|"subscription"|"goal", message: string, ts: number }' },
  'finance:subscription_cancelled':    { payload: '{ pattern_id: string, merchant: string, ts: number }' },
  'finance:bill_paid_on_time':         { payload: '{ pattern_id: string, merchant: string, ts: number }' },
  'finance:bill_due_predicted':        { payload: '{ pattern_id: string, merchant: string, amount: number, due_at: number, days_until: number, ts: number }' },
  'finance:recurring_candidate_detected': { payload: '{ merchant: string, merchant_normalized: string, estimatedAmount: number|null, estimatedInterval: number|null, nextDueDate: number|null, confidence: "low"|"medium"|"high", category: "bill"|"subscription"|"unknown", evidence: { occurrenceCount: number, amountVariance: number|null, intervalVariance: number|null }, ts: number }' },
  'finance:savings_deposit_detected':    { payload: '{ transfer_id: string, record_id: string, paired_record_id: string|null, amount: number, date: string, memo: string|null, matched_keyword: string|null, confidence: "low"|"medium"|"high", is_matched_pair: boolean, ts: number }' },
  'finance:adhd_tax_candidate_detected': { payload: '{ record_id: string|null, category: "late_fee"|"replacement"|"duplicate"|"unknown", confidence: "low"|"medium"|"high", amount: number|null, matched_phrase: string, copy: string, auto_add: boolean, ts: number }' },

  // ─── Sprint 3 / D2 cross-module wires ───────────────────────────
  'cycle:period_logged':               { payload: '{ ts: number, source: "user"|"braindump"|"import" }' },
  'sleep:pacing_breach_detected':      { payload: '{ severity: "info"|"watch", run_length: number, ts: number }' },
  'habits:reduce_motion_on':           { payload: '{ reason: string, ts: number }' },
  'work:suggest_break':                { payload: '{ reason: string, ts: number }' },
  'body:suggest_rest_check':           { payload: '{ reason: string, ts: number }' },
  'habits:interest_capture_detected':  { payload: '{ habit_id?: string, ts: number }' },
  'work:suggest_pause_marked_missed':  { payload: '{ reason: string, ts: number }' },
  'body:hydration_drop_detected':      { payload: '{ drop_pct: number, ts: number }' },
  'habits:surface_water_habit':        { payload: '{ reason: string, ts: number }' },
  'body:doctor_visit_completed':       { payload: '{ ts: number }' },
  'grocery:auto_added':                { payload: '{ source_event: string, item_ids: string[], category: string, ts: number }' },

  // ─── Sprint 2.5 / notification layer ────────────────────────────
  'notifications:delivered':           { payload: '{ dedupe_key: string, category: "REMINDER"|"PATTERN_ALERT"|"CONTENT_DELIVERY", ts: number }' },
  'notifications:suppressed':          { payload: '{ dedupe_key: string, category: "REMINDER"|"PATTERN_ALERT"|"CONTENT_DELIVERY", reason: string, ts: number }' },

  // ─── Sprint 2.5 / F1 savings tracker ────────────────────────────
  'finance:savings_recorded':          { payload: '{ id: string, merchant: string, monthly_amount: number, cancelled_at: number, surfaced_by_ollie: boolean, ts: number }' },

  // ─── push notification events (money module gap closure) ─────────
  'finance:subscription_stale':        { payload: '{ pattern_id: string, merchant: string, amount: number, days_since: number, ts: number }' },
  'finance:savings_milestone':         { payload: '{ goal_id: string, goal_name: string, current: number, target: number, milestone_pct: number, ts: number }' },
  'finance:impulse_pause_summary':     { payload: '{ count: number, total: number, month_start: number, ts: number }' },
  'finance:anomaly_detected':          { payload: '{ anomaly_id: string, merchant: string|null, amount: number, median: number|null, ts: number }' },
  'finance:tax_setaside_due':          { payload: '{ amount: number, month_start: number, suggested_pct: number, message: string, ts: number }' },

  // ─── Sprint 2 / Group C · sync ──────────────────────────────────
  'sync:outbound_flushed':             { payload: '{ count: number, ts: number }' },
  'sync:inbound_applied':              { payload: '{ ts: number }' },
  'sync:auth_expired':                 { payload: '{ ts: number }' },

  // ─── Sprint 5 · finance per-record sync ─────────────────────────
  'sync:finance_outbound_flushed':     { payload: '{ upserts: number, deletes: number, ts: number }' },
  'sync:finance_inbound_applied':      { payload: '{ applied: number, cursor: string, ts: number }' },

  // ─── Sprint 2 / Group C · auth ──────────────────────────────────
  'auth:signed_up':                    { payload: '{ user_id: string, ts: number }' },
  'auth:signed_in':                    { payload: '{ user_id: string, ts: number }' },
  'auth:signed_out':                   { payload: '{ ts: number }' },
  'auth:decryption_failed':            { payload: '{ reason: string, ts: number }' },

  // ─── encryption vault (Clerk migration · 2026-05-19) ────────────
  // The passphrase-derived vault (@ollie/auth). Emitted on key derivation
  // (create/unlock) and on lock/reset. Payload is metadata only — never
  // the passphrase or the derived key.
  'vault:unlocked':                    { payload: '{ ts: number }' },
  'vault:locked':                      { payload: '{ ts: number }' },

  // ─── Sprint 2 / Group C · research stream ───────────────────────
  'research:event_queued':             { payload: '{ event_id: string, ts: number }' },
  'research:flush_succeeded':          { payload: '{ count: number, ts: number }' },
  'research:flush_failed':             { payload: '{ count: number, reason: string, ts: number }' },

  // ─── Sprint 4 / E1+E7 · medication ──────────────────────────────
  'medication:logged':                 { payload: '{ item_id: string, name: string, ts: number }' },
  'medication:overdue_detected':       { payload: '{ item_id: string, name: string, slot_hhmm: string, ts: number }' },
  'medication:adherence_drift':        { payload: '{ item_id: string, name: string, ratio: number, ts: number }' },

  // ─── Sprint 4 / E5 cross-protective chains ──────────────────────
  'sleep:short_sleep_run_detected':    { payload: '{ nights: number, mean_hours: number, ts: number }' },
  'finance:spending_caution_surfaced': { payload: '{ reason: string, ts: number }' },
  'app:reduce_motion_mode_on':         { payload: '{ reason: string, ts: number }' },
  'work:hyperfocus_detected':          { payload: '{ minutes: number, ts: number }' },
  'body:fatigue_warning_surfaced':     { payload: '{ reason: string, ts: number }' },
  'cycle:luteal_phase_entered':        { payload: '{ ts: number }' },
  'finance:surface_cycle_spending_card': { payload: '{ reason: string, ts: number }' },

  // ─── Sprint 4 / E2-E3 · voice ───────────────────────────────────
  'voice:capture_started':             { payload: '{ source: "mic-button"|"hotkey"|"siri", ts: number }' },
  'voice:capture_transcribed':         { payload: '{ text: string, source: string, ts: number }' },
  'voice:capture_cancelled':           { payload: '{ reason: string, ts: number }' },

  // ─── Sprint 4 / E8 · grocery interest capture ───────────────────
  'grocery:interest_capture_detected': { payload: '{ category: string, count: number, window_days: number, ts: number }' },

  // ─── Sprint 6 · impulse pause flow (FinanceModule) ──────────────
  // Opt-in 24-hour hold on non-essential variable purchases. The pending
  // pause lives in the finance store under `finance.pendingPauses`; on
  // resolve, we emit the second event and either commit the transaction
  // (purchased) or increment finance.savedByPause (skipped). The 24h
  // expiry notification is delivered via the existing reminder pathway
  // (see `void:reminder:scheduled`); a parallel backend worker aggregates
  // resolved pauses into a monthly summary via `finance:impulse_pause_summary`
  // (declared earlier in this registry).
  'finance:impulse_pause_started':     { payload: '{ id: string, amount: number, merchant: string, category: string, ts: number, expires_at: number }' },
  'finance:impulse_pause_resolved':    { payload: '{ id: string, amount: number, merchant: string, outcome: "purchased" | "skipped", ts: number }' },

  // ─── body weekly review (Sunday 19:00 local) ────────────────────────────
  'body:weekly_review': { payload: '{ ts: number, weekStartTs: number, weekEndTs: number, copy: string, summary: { habitsCompleted: number, habitsTotal: number, mostSkippedWeekday: string|null, sleepAvgHours: number|null, sleepNightsLogged: number, cyclePhaseAtEnd: string|null, supplementAdherencePct: number|null, waterAvgCups: number|null, isSparse: boolean } }' },

  // ─── body notifications · 11 push events (Sprint body-v2 wiring) ────────
  'cycle:period_approaching':    { payload: '{ predictedTs: number, daysUntil: number, ts: number }' },
  'cycle:period_imminent':       { payload: '{ predictedTs: number, ts: number }' },
  'cycle:period_late':           { payload: '{ predictedTs: number, daysLate: number, ts: number }' },
  'cycle:luteal_starting':       { payload: '{ lutealStartTs: number, daysUntil: number, ts: number }' },
  'cycle:ovulation_imminent':    { payload: '{ ovulationTs: number, ts: number }' },
  'cycle:pill_missed':           { payload: '{ missedDate: string, ts: number }' },
  'sleep:wind_down_window':      { payload: '{ bedtimeTs: number, ts: number }' },
  'sleep:debt_accumulated':      { payload: '{ debtHours: number, targetHours: number, idealBedtimeHHMM: string, ts: number }' },
  'body:supplement_due':         { payload: '{ supplementId: string, supplementName: string, reminderHHMM: string, ts: number }' },
  'body:posture_nudge':          { payload: '{ hourBucket: number, ts: number }' },
  'habits:morning_check':        { payload: '{ firstHabitName: string|null, totalCount: number, ts: number }' },

  // ─── retention telemetry (local-only until backend Group C ships) ────────
  // Local-first: backend may pick these up via research-stream later.
  'void:retention:installed':          { payload: '{ installed_at: number, source: "fresh"|"reinstall", ts: number }' },
  'void:retention:session_started':    { payload: '{ session_count: number, hours_since_install: number, ts: number }' },
  'void:retention:d1_returned':        { payload: '{ installed_at: number, returned_at: number, hours: number }' },
  'void:retention:d7_returned':        { payload: '{ installed_at: number, returned_at: number, days: number }' },
  'void:retention:d30_returned':       { payload: '{ installed_at: number, returned_at: number, days: number }' },
};
