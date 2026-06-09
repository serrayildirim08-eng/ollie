# Ollie — Implementation Plan: Top-10 Technical Fixes

_Date: 2026-06-09 · Branch: feat/brain @ 2325ee5 · Planning only — no files modified._
_Source of truth: docs/audit-2026-06-09/OLLIE_PRODUCT_TECH_HEALTH_AUDIT.md_

Grounding: every file/line below was read on this branch. Risk = {LOW, MEDIUM, HIGH}. Items marked **ALPHA-BLOCKER** must land before any closed-alpha ship.

---

## Dependency graph (read first)

```
#3 migration runner ──┬─> #6 admin due dates
                      └─> #7 ball_state/last_transition_at ──> #8 bridge → stale-ball

#1 crisis schema ─────> #2 trilingual banner        (both touch DumpScreen crisis path)
#9 draft-first ───────> (also touches DumpScreen dispatch; coordinate with #1/#2)

#4 telemetry IDOR     (worker-only, independent)
#5 AI data-loss       (worker-only, independent)
#10 defer Partner     (native nav flag, independent)
```

---

## #1 — Crisis signal schema mismatch  **(ALPHA-BLOCKER · safety · 3/3 confidence)**

**Files**
- `apps/native/src/router/schema.ts:72-77` (native `CrisisSignal`)
- `apps/native/src/dump/DumpScreen.tsx:284-323` (`CrisisBanner`, reads `crisis.type`, `crisis.language`)
- `workers/ai-proxy/src/router/dump-schema.ts:8` (worker imports `CrisisSignal` from `@ollie/crisis-lexicon`)
- `workers/ai-proxy/src/router/dump.ts:227,408` (`detectCrisis(combinedDump)` → `crisis`)
- `packages/crisis-lexicon/src/types.ts:61-74` (canonical `CrisisSignal`: `{ tier, languages, matches }`)

**Current behavior**
- The worker serialises the **lexicon** `CrisisSignal` = `{ tier: 1|2|3|4, languages: LexiconLanguage[], matches: [...] }`.
- The native app defines a **different** `CrisisSignal` with the same name = `{ detected: true, type: 'ideation'|'method_seeking'|'distress'|'panic', confidence, language }`.
- `CrisisBanner` reads `crisis.type` and `crisis.language` (`DumpScreen.tsx:323`) — **both `undefined`** on the real payload. The crisis card renders with missing data; the debug line `type={crisis.type} · {crisis.language}` shows `undefined`.

**Desired behavior**
- One canonical shape. Adopt the lexicon's (`tier`/`languages`/`matches`) as source of truth since the worker already emits it.
- Native `schema.ts` mirrors the lexicon shape (or re-exports `@ollie/crisis-lexicon`'s `CrisisSignal`).
- `CrisisBanner` derives severity from `tier` (e.g. `tier>=3` = method-seeking → strongest copy) and language from `languages[0]` (but copy itself keyed to app-language — see #2).

**DB/schema changes:** none.

**Migration strategy:** type-only change; verify no other native consumer reads `crisis.type`/`crisis.confidence` (grep `crisis\.` — only DumpScreen + dispatch found). Keep `detected`/severity mapping in one helper so future consumers don't re-derive.

**Tests to add**
- Worker→native contract test: feed a real `detectCrisis` output through the native `CrisisSignal` type + `CrisisBanner` mapping; assert tier/language resolve (no `undefined`).
- Crisis e2e: tier-3 dump → `output.crisis` present → banner shows severe copy + correct language. _(none exists today)_

**Risk:** MEDIUM — safety path; the rename ripples through DumpScreen + dispatch guard. Mitigated by it being type+mapping only.

---

## #2 — Trilingual crisis banner  **(ALPHA-BLOCKER)**

**Files**
- `apps/native/src/dump/DumpScreen.tsx:303-323` (hardcoded English copy)
- `apps/native/src/settings/appLang.ts` (existing `useAppLang()` reactive hook + `getAppLang()`, validated `'en'|'es'|'tr'`, default `'en'`)

**Current behavior:** banner copy ("Something in what you wrote sounded heavy…") is hardcoded English. A TR/ES user in crisis sees English.

**Desired behavior:** copy keyed to **app language** (per Ollie's rule: follows app-language setting, not dump language). `CrisisBanner` calls `useAppLang()` and selects from a 3-key copy map (`en`/`es`/`tr`). Severity-tiered copy (from #1's `tier`) × language = a small `Record<lang, Record<tier, string>>` or two strings (heavy vs urgent) per language. Copy must be human-reviewed (safety wording), not machine-translated silently → mark `[NEEDS: native TR/ES crisis copy review]`.

**DB/schema changes:** none.

**Migration strategy:** none. Additive.

**Tests to add**
- Render `CrisisBanner` under each app language → assert correct-language string + dismiss affordance present in all three.

**Risk:** LOW (copy + locale lookup). The only caveat is **wording quality** — needs a human-approved TR/ES safety string, not a guess.

---

## #3 — SQLite migration runner + schema versioning  **(FOUNDATION for #6, #7)**

**Files**
- `apps/native/src/storage/sqlite.ts` (raw `sql.execute`/`sql.select`; no versioning)
- Every `apps/native/src/modules/*/migrate.ts` (e.g. `admin/migrate.ts:25-100` — `CREATE TABLE IF NOT EXISTS` + ad-hoc `PRAGMA table_info` backfill per module)
- `apps/native/src/storage/index.ts` (barrel; where a `runMigrations()` entrypoint would live)
- Boot path that calls each `migrate*()` (find the aggregate caller in `apps/native/src/store.ts` / app bootstrap)

**Current behavior:** each module hand-rolls idempotent `CREATE TABLE IF NOT EXISTS` + manual column backfills via `PRAGMA table_info` (see `admin/migrate.ts:81-96`). There is **no central version**, no ordered migration list, no `user_version`, no rollback/snapshot. A schema bump = another ad-hoc `ALTER` guarded by a PRAGMA check, easy to get wrong and untracked.

**Desired behavior:** a small migration runner:
- Read/write SQLite `PRAGMA user_version` as the schema version.
- A central ordered registry: `migrations: Array<{ version, up(sql) }>` (or per-module registries composed in order).
- On boot: run all migrations with `version > user_version` in a transaction, then set `user_version`.
- Keep `CREATE TABLE IF NOT EXISTS` for v0 baseline so existing installs adopt cleanly.
- Optional: pre-migration backup of affected tables (mirror `@ollie/store`'s snapshot approach).

**DB/schema changes:** introduces `user_version` tracking; no table changes by itself.

**Migration strategy:**
- v0 = current schema (baseline; existing DBs are implicitly v0).
- Convert existing ad-hoc backfills (admin snooze/decision columns) into numbered migrations so they stop being special-cased.
- Idempotent + transactional; if a migration throws, roll back and surface a boot error (don't half-migrate).

**Tests to add**
- Fresh DB → runner brings it to latest version; tables exist.
- v0 DB (baseline tables, no `user_version`) → upgrades cleanly, data preserved.
- Re-run is a no-op (idempotent).
- Failing migration rolls back + leaves `user_version` unchanged.

**Risk:** MEDIUM-HIGH — touches every module's persistence + boot. A bad runner can brick local data. Mitigate with transactions, snapshot, and the fresh+upgrade+idempotent test trio before wiring boot.

---

## #4 — Telemetry IDOR (use verified Clerk userId)  **(security)**

**Files**
- `workers/ai-proxy/src/index.ts:315-343` (verifies JWT → `userId` at :324 but calls `handleEnrichDump(req, env)` / `handleIngestEvent(req, env)` **without** it)
- `workers/ai-proxy/src/telemetry.ts:91` (`handleEnrichDump`, trusts `body.user_hash:62`), `:168` (`handleIngestEvent`, forwards `body.row` incl. client `user_id` to Supabase at :208)

**Current behavior:** the endpoint authenticates and extracts `userId`, but the handlers never receive it. They trust client-supplied `body.user_hash` (enrich) and `body.row.user_id` (ingest) → an authenticated caller can write telemetry/enrichment as **any other user**.

**Desired behavior:** thread the verified `userId` into both handlers and reject mismatches.
- `handleIngestEvent(req, env, userId)`: require `body.row.user_id === userId` (or overwrite it server-side) before INSERT.
- `handleEnrichDump(req, env, userId)`: validate `body.user_hash` against a **server-reproducible** hash of `userId`, OR compute `user_hash` server-side and ignore the client value.
- `handleLabel` similarly if it takes a user-scoped field.

**OPEN DECISION (blocks the enrich fix):** `user_hash` is a privacy hash the client derives (likely `userId + salt`). The server can only validate it if the salt/pepper is server-side. Options: (a) move hashing server-side with a worker-held pepper; (b) store the per-user salt server-side and recompute; (c) drop `user_hash` and scope by `userId` directly. **Recommend (a)** — least client trust. Needs the derivation source confirmed (`VITE_USER_HASH_SALT` referenced in audit).

**DB/schema changes:** none (validation only). If switching to server-side hashing, no schema change, just where the hash is computed.

**Migration strategy:** none. Backwards-compatible if server recomputes/overwrites rather than rejecting on first deploy (log mismatches for one release, then enforce) — avoids breaking any in-flight client.

**Tests to add**
- ingest-event with `row.user_id` ≠ JWT user → 403.
- enrich-dump with spoofed `user_hash` → 403 (or server overwrites + logs).
- happy path: matching identity → 200.

**Risk:** MEDIUM — security-positive but the `user_hash` derivation decision must be settled or the enrich validation is cosmetic. Phased enforce-after-log avoids client breakage.

---

## #5 — AI data-loss bugs (confidence coercion + remindIn on demotion)  **(data integrity)**

**Files**
- `workers/ai-proxy/src/router/dump-classify.ts:200,233` (`typeof parsed.confidence === 'number' ? parsed.confidence : 0`)
- `workers/ai-proxy/src/router/dump-schema.ts:67-89` (`applyConfidencePolicy` — `<0.60` demotes to `dump_only`, nests `originalGuess`)
- `workers/ai-proxy/src/router/dump.ts:281-296, 338-353` (`applyConfidencePolicy` then `injectScheduledAt(tiered.payload, …)`)
- `workers/ai-proxy/src/router/remindIn.ts` (`injectScheduledAt`)

**Current behavior**
- **5a — confidence→0:** when the model returns a non-numeric `confidence` (string/missing), it's coerced to `0`. `0 < 0.60` → `applyConfidencePolicy` demotes a possibly-correct fragment to `dump_only`. A formatting hiccup becomes silent data loss.
- **5b — remindIn lost on demote:** `applyConfidencePolicy` wraps the original payload in `originalGuess`. `injectScheduledAt` then looks for `payload.remindIn` at the **top level** of the demoted payload (now `{module:'dump_only', …, originalGuess:{…}}`), so the reminder hint is silently dropped — contradicting the classifier rule "never dump_only when remindIn present".

**Desired behavior**
- **5a:** treat non-numeric confidence as **unknown**, not 0. Options: re-ask/keep in a `needsConfirm` middle tier, or default to a conservative `0.6` (→ needsConfirm) rather than `0` (→ discard). At minimum: log + don't auto-discard on a parse artifact.
- **5b:** before demoting, lift a present `remindIn` to the top level of the demoted payload (or have `injectScheduledAt` look inside `originalGuess`). Emit the existing `remindIn dropped` warning only when it's genuinely absent.

**DB/schema changes:** none.

**Migration strategy:** none. Pure worker logic; covered by existing `dump`/`remindIn` test harness.

**Tests to add**
- classify result with `confidence: "high"` (string) → fragment is NOT demoted to dump_only silently.
- low-confidence fragment carrying `remindIn` → `scheduledAtMs` survives (reminder still scheduled) even when demoted.
- regression: high-confidence remindIn still works (no double-injection).

**Risk:** LOW-MEDIUM — isolated, well-tested area (adjacent to the B3 cascade fix). Main care: don't change the meaning of legitimately-low-confidence dumps.

---

## #6 — Due dates on generic admin tasks  **(needs #3)**

**Files**
- `apps/native/src/modules/admin/types.ts:44-49` (`AdminTaskData` union — no date on `task`/`phone`/`paperwork`)
- `apps/native/src/modules/admin/migrate.ts:27-34` (`admin_tasks` table — no date column)
- `apps/native/src/modules/admin/handler.ts` (`create_task`/`create_phone_task`/`log_paperwork` — no date captured)
- `apps/native/src/modules/admin/repo.ts` (`tasks.add`)
- `apps/native/src/todo/aggregateTodos.ts` (buckets by date; dateless tasks all land in "no date")
- `workers/ai-proxy/src/modules/admin.config.ts` (router prompt — should extract `dueDate` for generic tasks)

**Current behavior:** only renewals + appointments carry dates. `create_task`/`phone`/`paperwork` store `created_at` only → cannot sort/filter by urgency; all land in the "no date" bucket.

**Desired behavior:** optional `due_date` (ISO `yyyy-mm-dd`) on `admin_tasks`. Router extracts it when present ("call dentist **friday**"). `aggregateTodos` buckets generic tasks by due date like renewals. Reuse existing `daysUntil`/`formatDaysUntil` (`types.ts:91-116`).

**DB/schema changes:** `admin_tasks` add nullable `due_date TEXT`; add `idx_admin_tasks_due_date`.

**Migration strategy:** via #3 runner — a numbered migration `ALTER TABLE admin_tasks ADD COLUMN due_date TEXT` (nullable, backfills NULL). No data loss.

**Tests to add**
- dump "pay rent friday" → task has `due_date`; appears in the dated bucket.
- dateless task still logs (NULL date, "no date" bucket).
- aggregateTodos orders dated tasks by soonest.

**Risk:** LOW-MEDIUM — additive column + router prompt tweak. Timezone handling (local vs UTC) should match renewals' existing `isoToday()` convention.

---

## #7 — Forgotten-task resurfacing fields (`ball_state`, `last_transition_at`)  **(needs #3)**

**Files**
- `apps/native/src/modules/admin/migrate.ts:27-34` (`admin_tasks` — add columns)
- `apps/native/src/modules/admin/types.ts:29-49` (`AdminTask` — add fields)
- `apps/native/src/modules/admin/repo.ts` (set on create + on transitions)
- consumer already exists: `packages/logic/src/admin/types.ts:17,33,44` (`BallState='MINE'|'THEIRS'|'WAITING'`, optional `ball_state`, `last_transition_at`), `packages/logic/src/admin/phase1.ts:160-210` (`detectStaleBall` reads `t.ball_state` + `t.last_transition_at`)

**Current behavior:** the logic layer's `detectStaleBall` already expects `ball_state` + `last_transition_at`, but native `admin_tasks` has neither → the detector is permanently starved (A9 stale-ball "dark"). Captured tasks have no notion of whose court the ball is in.

**Desired behavior:** persist `ball_state` (`MINE`/`THEIRS`/`WAITING`, default `MINE`) + `last_transition_at` (ms) on `admin_tasks`. Set on create (`MINE`, now). Update on state change (e.g. a phone task awaiting callback → `THEIRS`/`WAITING`, stamp `last_transition_at`). This unblocks #8.

**DB/schema changes:** `admin_tasks` add `ball_state TEXT NOT NULL DEFAULT 'MINE'`, `last_transition_at INTEGER`. Index optional (`idx_admin_tasks_ball_state`).

**Migration strategy:** via #3 runner — numbered migration with `ALTER ADD COLUMN … DEFAULT 'MINE'` (existing rows backfill to MINE + `last_transition_at = created_at`).

**Tests to add**
- new task → `ball_state='MINE'`, `last_transition_at` set.
- transition to THEIRS stamps a new `last_transition_at`.
- `detectStaleBall` fires on a THEIRS row older than 14d (using the now-populated fields).

**Risk:** MEDIUM — the columns are easy; the **semantics** (when does the ball flip to THEIRS/WAITING?) need a small product rule. Keep v1 minimal: default MINE; flip THEIRS only where there's a clear signal (e.g. phone task marked "waiting on them").

---

## #8 — Wire admin bridge → stale-ball detector  **(needs #7)**

**Files**
- `apps/native/src/modules/admin/bridge.ts:20-26` (explicitly notes "ball_state / last_transition_at: no field → A9 stale-ball stays dark")
- `packages/orchestrator/src/admin.ts:295` (`detectStaleBall(history, { now })` already called; consumes the history the bridge builds)

**Current behavior:** the bridge builds the `admin` history mirror for the orchestrator but omits ball fields (because they didn't exist — #7). `detectStaleBall` runs on history with `ball_state === undefined` → never fires.

**Desired behavior:** once #7 lands, the bridge maps each task's `ball_state` + `last_transition_at` into the history rows it mirrors to `@ollie/store` for the orchestrator. `detectStaleBall` then emits `admin_stale_ball` noticings, which surface on home via the existing noticings pipeline.

**DB/schema changes:** none (consumes #7's columns).

**Migration strategy:** none. Pure mapping.

**Tests to add**
- bridge mirrors `ball_state`/`last_transition_at` into history rows.
- orchestrator recompute with a stale THEIRS task → emits an `admin_stale_ball` noticing (integration test).

**Risk:** LOW-MEDIUM — mostly plumbing once #7 exists. Verify the noticing actually reaches home (the noticings selection bar) and isn't filtered out by capacity.

---

## #9 — Draft-first for 0.60–0.79 confidence  **(trust / data integrity)**

**Files**
- `workers/ai-proxy/src/router/dump-schema.ts:67-89` (`applyConfidencePolicy` — 0.60–0.79 currently returns `needsConfirm:true` but still a real module route)
- `apps/native/src/modules/dispatch.ts` (calls `handler.apply()` for every fragment — writes BEFORE confirm)
- `apps/native/src/dump/DumpScreen.tsx:142-199` (dispatch → then renders `NeedsConfirmCard` for `needsConfirm` fragments)
- `apps/native/src/dump/NeedsConfirmCard.tsx`

**Current behavior:** WRITE-THEN-UNDO for all tiers. A 0.60–0.79 fragment is **written to SQLite immediately**, then a card offers keep/undo. The wrong write already happened (and synced) before the user sees it.

**Desired behavior:** **draft-first** in the grey zone only.
- ≥0.80 → unchanged (silent write — the ADHD low-friction win).
- 0.60–0.79 → **do not apply yet**; render a confirm card; apply only on "keep". Undo becomes unnecessary for this tier (nothing was written).
- <0.60 → dump_only (unchanged, after #5 fix).
- Native `dispatch.ts` must split fragments: auto-apply the confident ones, hold the `needsConfirm` ones as pending drafts until the card resolves.

**DB/schema changes:** none.

**Migration strategy:** none. Behavioral; the worker policy flag (`needsConfirm`) already exists — this changes the **client** to treat it as "draft" not "applied".

**Tests to add**
- 0.70 fragment → NOT written until "keep"; "discard" leaves no row.
- 0.85 fragment → written silently (no card).
- mixed dump (one confident + one grey) → confident applies, grey waits.

**Risk:** MEDIUM — changes write semantics + dispatch ordering, and touches the same DumpScreen as #1/#2. Sequence after #1/#2 to avoid merge thrash. Watch the ack/“okay!” UX: the silent-ack must still fire for the confident fragments.

---

## #10 — Defer Partner behind a feature flag  **(scope / debt)**

**Files**
- `apps/native/src/navigation/Router.tsx:32,63,99` (`PartnerBox` import, `box/partner` route, modules-index entry)
- `apps/native/src/modules/partner/*` (left in place, just unreachable)
- a flags source — `apps/native/src/settings/` (add `features.partner` default `false`, mirror `appLang.ts` pattern)

**Current behavior:** Partner is fully routed + listed in the modules index, but it's mocked, untested, and not brain-dump-routable (orphan).

**Desired behavior:** gate the route + modules-index entry behind a `features.partner` flag (default OFF for v1). Code stays; surface disappears. Re-enable later without a revert.

**DB/schema changes:** none.

**Migration strategy:** none. A stored boolean setting (default false).

**Tests to add**
- flag OFF → `/box/partner` not registered + not in modules index.
- flag ON → route + entry present (keeps the path alive for v2).

**Risk:** LOW — additive flag, no deletion. Confirm nothing else hard-links to PartnerBox (e.g. PartnerCard on home — gate that too).

---

## Recommended implementation order

| Order | Item | Why here | Risk |
|---|---|---|---|
| 1 | **#1 Crisis schema** | alpha-blocker; foundation for #2; type-only | MEDIUM |
| 2 | **#2 Trilingual banner** | alpha-blocker; trivial once #1 lands; needs human TR/ES copy | LOW |
| 3 | **#3 Migration runner** | foundation for #6 + #7; nothing schema-y is safe before it | MED-HIGH |
| 4 | **#5 AI data-loss** | worker-only, isolated, high value, adjacent to shipped B3 | LOW-MED |
| 5 | **#4 Telemetry IDOR** | worker-only security; settle `user_hash` decision first | MEDIUM |
| 6 | **#6 Admin due dates** | needs #3; unlocks urgency sorting | LOW-MED |
| 7 | **#7 ball_state/last_transition_at** | needs #3; the resurfacing schema | MEDIUM |
| 8 | **#8 Bridge → stale-ball** | needs #7; flips A9 from dark to live | LOW-MED |
| 9 | **#9 Draft-first grey zone** | after #1/#2 (same DumpScreen); biggest trust gain | MEDIUM |
| 10 | **#10 Defer Partner** | independent; do anytime, lowest risk | LOW |

**Rationale:** clear the two alpha-blockers first (#1, #2). Land the migration runner (#3) before any schema work so #6/#7 are safe. Slot the two isolated worker fixes (#5, #4) while the native schema work proceeds. Do the admin "brain" upgrades (#6→#7→#8) as a chain. Save #9 for after the crisis work to avoid two hands on DumpScreen at once. #10 is a free win whenever.

**Two open decisions before coding:**
1. **#4** — how is `user_hash` derived, and do we move hashing server-side? (blocks the enrich validation)
2. **#7** — the minimal product rule for when a task's ball flips to THEIRS/WAITING (keep tiny for v1).
