# Ollie Remediation Roadmap — 2026-06-18

Source: 11-stream triple-audit fix-plan (172 per-finding entries). This roadmap groups
every finding into dependency-aware phases so an execution workflow can pull one phase and
fan out. Within each phase, `dependsOn` is respected. Companion machine file:
`fix-plan.json` (every entry tagged with its `phase`).

---

## Executive summary

The audit surfaced one **root product/security fork** that gates a large slice of the work:
the **dual identity model** (#22) — six legacy core tables key on Supabase `uuid` + `auth.uid()`
RLS, but the app authenticates with **Clerk text ids**, so `auth.uid()` is always NULL → those
tables FK-fail and every owner policy denies. Until Serra picks model **A (Clerk-text everywhere)**
or **B (Clerk→Supabase JWT template)**, eight findings cannot be coded correctly.

Alongside it sit five smaller **forks** (at-rest encryption strategy, sync wire-format,
routing-cache backend, multi-device crypto, research-stream consent flag) — all in **P0**.

Most findings are **auto-fixable by an agent fan-out** (clear single-file changes with unit-test
verification). The ones that touch **prod Supabase**, **device crypto**, **CSP/ATS**, or a
**product decision** are flagged `manual-or-prod` / `assisted` and grouped so a human runs them.

The spine: **P0 decisions** → **P1 alpha-gating criticals** → **P2 correctness/resilience** →
**P3 security + privacy** → **P4 logic/stats** → **P5 clean-code + dead-code + ops/config/tests**.

---

## P0 — Decisions Serra must make (these gate later phases)

Each decision is one fork. Recommendation in **bold**. Nothing in the gated phases can be
coded correctly until the matching decision lands.

1. **Identity model (#22)** — Clerk text id everywhere, OR keep Supabase uuid via a Clerk→Supabase
   JWT template.
   **Recommendation: (A) Clerk-text everywhere.** The newer worker tables already went this way;
   retype the 6 legacy tables to `user_id text`, drop the `auth.users` FK, secure via
   service-role-only + worker-enforced ownership. Matches de-facto direction; one coherent model.
   *Gates: #67, #68, #75 (via #24), #109, #112, #113, #63.*

2. **Sync wire-format (#1)** — base64→`\x`hex on the client (keeps `bytea` + the 12-byte IV CHECK),
   OR retype ciphertext/iv columns to `text`+base64 (simpler client, drops the guard, needs a prod migration).
   **Recommendation: base64→`\x`hex on the client.** Keeps the real DB validation; no prod retype risk.

3. **At-rest encryption (#30/#108)** — SQLCipher full-DB, OR field-level column encryption.
   **Recommendation: field-level column encryption** for the highest-sensitivity columns
   (cycle/medication/mood/finance) via the existing `encryptedKv` envelope — incremental, reversible,
   no one-way `ollie.db` migration. Revisit SQLCipher post-alpha. Also stop the plaintext localStorage mirror.

4. **Multi-device crypto (#73)** — server-side per-account salt fetched on new-device unlock,
   OR ship single-device-only for alpha and gate the multi-device claim.
   **Recommendation: gate single-device for alpha.** Defer the per-account salt handoff;
   disable the multi-device sync claim until handoff is wired (smaller alpha surface).

5. **Routing-cache backend (#24)** — apply the new SQL `routing_cache_lookup` migration to prod,
   OR retire the SQL cache and route everything through Vectorize.
   **Recommendation: apply the SQL migration.** feed-me + `/route/:module` already depend on the
   table; lowest-churn path to a live cache. (Unblocks #9, #75.)

6. **Research-stream consent (#62)** — ship behavioral telemetry on a distinct `research_optin` flag,
   OR delete/quarantine the package.
   **Recommendation: gate behind `research_optin`** and align consent copy — it currently gates on
   `necessary` (true for every bootable user), which contradicts the opt-in stance. If alpha won't
   ship it, quarantine and drop the "GDPR-withdrawal is live" claim.

Smaller decisions that surface inside later phases (not full forks, but need a one-line call):
multi-goal-per-dump (#87), instant-ack flash (#129), validate-invite oracle copy (#40),
per-tier rate limits (#79), MAD scaling convention (#104), phase-boundary table (#51),
dark-mode in-scope (#31), migration strategy ledger-vs-per-module (#61), small-caps tracking (#59),
PII year-exemption (#171). These are flagged on the findings they attach to.

---

## P1 — Alpha-gating criticals

**Goal:** make the data path actually work end-to-end — encrypted sync writes land, identity
resolves, the AI-cost surface is rate-limited, the dead routing cache lives, and dumps don't
double-write. Most of these are gated by a P0 decision.

Findings (checklist):

- [ ] **#1** Encrypted sync base64→bytea IV CHECK rejects every write — M — manual-or-prod *(gated: wire-format)*
- [ ] **#23** encrypted_state upsert omits on_conflict → every 2nd push 409s forever — S — auto
- [ ] **#22** Dual identity model retype/JWT — XL — manual-or-prod *(gated: identity)*
- [ ] **#67** Native Supabase client never carries user JWT — S — assisted *(dep #22)*
- [ ] **#68** push_tokens.user_id uuid vs Clerk text — M — manual-or-prod *(dep #22)*
- [ ] **#2** /route/dump + /route/:module + /brain-copy have NO rate limit — M — auto
- [ ] **#24** /route/:module cache fully dead (RPC + text_sample missing) — M — manual-or-prod *(gated: cache backend)*
- [ ] **#3** No client dumpId → timed-out dump double-routes & double-writes — M — auto
- [ ] **#30** Sensitive data plaintext at rest in SQLite + localStorage mirror — XL — manual-or-prod *(gated: at-rest)*
- [ ] **#108** All local SQLite plaintext (dup of #30) — XL — manual-or-prod *(dep #30)*
- [ ] **#73** Per-device random salt blocks multi-device decryption — L — manual-or-prod *(gated: multi-device)*

**Done-criteria:** a real Clerk-authenticated client writes encrypted_state + finance_records +
scheduled_jobs without FK error and reads back only own rows; a repeated module push 200s (no 409);
11th request to each cost endpoint within 60s returns 429; a second `/route/grocery` with same text
returns `source:cache_hit`; a timed-out-then-retried dump produces exactly one archive row; a disk
hex-dump of `ollie.db` shows no plaintext merchant/symptom strings.

**Verification:** integration tests against local supabase (round-trip encrypted blob + IV CHECK);
two-Clerk-user isolation test; vitest rate-limit + dedupe + cache round-trip; disk strings dump.

**Execution:** auto fan-out for **#23, #2, #3**. Human/prod for **#1, #22, #67, #68, #24, #30, #108, #73**
(prod migrations, device crypto, JWT template) — run after the matching P0 decision.

---

## P2 — High-confidence correctness & resilience

**Goal:** stop the silent data-loss and double-fire bugs in sync, the dump flow, the orchestrator
timers, and the payload boundary.

Findings:

- [ ] **#4** Migration caches rejected promise forever — M — auto
- [ ] **#5** Finance cursor advances past failed-decrypt rows → silent loss — M — auto *(dep #1)*
- [ ] **#6** Finance keyset strict gt. on non-unique updated_at skips rows — L — auto *(dep #5)*
- [ ] **#7** Module-blob syncIn echoes apply back out (re-upload ping-pong) — M — auto
- [ ] **#78** LWW fast-clock always wins → lost updates — L — assisted *(dep #7)*
- [ ] **#117** Finance outbound vs inbound LWW timestamp source diverges — S — auto
- [ ] **#118** Module-blob dedupe key (module,updated_at) drops same-ms newer entry — M — auto
- [ ] **#120** _inspect queueDepth pre-coalesce + dead cross-tab `_` filter — S — auto
- [ ] **#10** Handlers blind-cast router payload, no runtime validation — L — assisted
- [ ] **#28** Body L2 adopts unvalidated AI JSON → exhaustive() throw — M — auto *(dep #10)*
- [ ] **#36** Sleep L2 unvalidated JSON (companion to #28) — S — auto *(dep #10, #28)*
- [ ] **#69** goals.ensure() bypasses active-goal cap — M — assisted
- [ ] **#91** body.log_movement pets mirror orphan row on undo — S — auto
- [ ] **#135** finance renewal_for whitelist drifts from schema enum — S — auto
- [ ] **#33** No concurrent-submit guard in dump submit() — S — auto
- [ ] **#53** Draft-confirm keep/undo no in-flight guard (double-apply) — S — auto
- [ ] **#64** store.set has no deep-equal check (sweep notifies everyone) — M — assisted
- [ ] **#86** Dump archive fire-and-forget races store mirror — S — auto
- [ ] **#88** Local crisis false-positive swallows ack → no feedback — S — auto
- [ ] **#89** shared.actionLog read-modify-write races across syncs — M — assisted *(dep #64)*
- [ ] **#90** onResult fired without await → unhandled rejection — M — assisted
- [ ] **#98** Batched classify all-or-nothing, no partial salvage — M — assisted
- [ ] **#127** _ackTick module-scope mutable global never resets — S — auto
- [ ] **#130** worker↔native module drift drops fragment with only console.error — S — auto
- [ ] **#134** GroceryBox auto-archive re-fires on poll snapshot — S — auto
- [ ] **#8** Time-windowed work/goals cues never fire on a timer — M — assisted *(dep #96)*
- [ ] **#27** scheduleAt cancel() races async native-schedule path — S — auto
- [ ] **#41** enriched_signals INSERT not idempotent on retry — M — manual-or-prod
- [ ] **#42** Enrich drain BATCH_CAP consumed by retry-counter keys — S — auto
- [ ] **#43** cadence-scanner day-scoped dedup → double push across midnight — M — auto
- [ ] **#47** Snooze reschedule loses durable server-push — M — assisted
- [ ] **#48** scheduleSystemNotification unbounded setTimeout (>24.8d fires now) — M — assisted *(dep #71)*
- [ ] **#57** cadence-scanner sessionFired Set grows unbounded — S — auto
- [ ] **#70** resumeScheduled re-fires already-delivered notifications — S — auto
- [ ] **#71** Orchestrator/finance bare setTimeout >24.8d + lost on quit — M — assisted *(dep #48)*
- [ ] **#72** cycle prediction cues only on item change, not clock tick — M — assisted
- [ ] **#92** scheduleAt trusts worker scheduledAtMs, no bounds — S — auto
- [ ] **#93** scheduleWeeklyReview/BodyCorrelation busy re-arm if timer early — S — auto
- [ ] **#96** work/goals scanCues dedup in-memory only → re-fire on restart — M — assisted
- [ ] **#100** flush daily-budget cap racy across overlapping ticks — M — manual-or-prod
- [ ] **#101** No retry backoff/jitter on KV-scan enrich drain — M — manual-or-prod
- [ ] **#157** Multiple persisted dedup arrays grow unbounded — S — auto
- [ ] **#158** body hourly tick offset from clock hours → window skipped — S — auto
- [ ] **#159** work four_blocks_today fires on a single re-logged session — S — auto
- [ ] **#160** flush no-token path double-counts stats — S — auto
- [ ] **#161** flush doesn't distinguish permanent token failures — M — assisted
- [ ] **#167** Aggregated digest notifications bypass daily-cap budget — S — auto
- [ ] **#168** Daily-cap local-day vs cron UTC-day disagree — S — manual-or-prod
- [ ] **#87** Multiple create_goal fragments: only first gets a modal — M — assisted *(decision: multi-goal)*
- [ ] **#128** Goal-intent dump can be silently abandoned, no ack — S — manual-or-prod *(dep #87)*
- [ ] **#26** Dumped mood valence/energy discarded via double-cast — M — manual-or-prod *(dep #10; Serra owns schema)*
- [ ] **#29** Grocery handler reads fields absent/mistyped vs schema — M — manual-or-prod *(dep #10; Serra owns schema)*

**Done-criteria:** unit tests pin: failed-decrypt rows keep the cursor below them; a >500-row
same-timestamp burst is pulled once each; syncIn leaves the outbound queue empty; a fast-clock
device still applies newer remote rows; invalid payloads return `ok:false` without persisting;
narrow notification windows fire exactly once on a timer-advance with no store write; dedup arrays
stay ≤200; double-tap keep/undo applies once.

**Verification:** vitest across packages/sync, packages/store, packages/orchestrator,
apps/native dispatch + dump, workers/cron drain/flush; fake-timer tests for the orchestrator cues.

**Execution:** large auto fan-out (most are single-file + unit test). `assisted` items
(#78, #10, #64, #89, #90, #98, #8, #47, #48, #71, #72, #96, #161, #69, #87) want a human review
of the chosen semantics. `manual-or-prod` (#41, #100, #101, #168, #26, #29, #128) need prod access
or a Serra schema/product call.

---

## P3 — Security & privacy hardening

**Goal:** close the auth/abuse/leak holes on the workers and the device, and finish the
identity-model RLS work behind #22.

Findings:

- [ ] **#39** clerk-verify omits azp/aud check → sibling-app token accepted — S — assisted *(decision: azp value)*
- [ ] **#40** validate/claim-invite unauth + no rate limit → enumeration oracle — S — assisted *(decision: oracle copy)*
- [ ] **#66** /brain-copy open LLM proxy (client system+user prompt) — M — manual-or-prod *(dep #2)*
- [ ] **#85** generate/claim-invite trust client user hashes (IDOR) — S — assisted
- [ ] **#84** enrich-dump doesn't bound raw_text length — S — auto
- [ ] **#155** ingest-event forwards arbitrary client row keys to Supabase — M — assisted
- [ ] **#38** route handlers read req.json() with no body-size guard — M — auto
- [ ] **#56** Sentry tunnel unauthenticated open relay — M — auto
- [ ] **#165** Sentry tunnel upstream fetch no try/catch or timeout — S — auto *(dep #56)*
- [ ] **#54** Tauri csp:null + unbounded notification title/body — M — assisted *(decision: origin allowlist)*
- [ ] **#103** iOS ATS fully relaxed in CSP-less webview — M — assisted *(dep #54)*
- [ ] **#132** Notification category_id/extra_json piped webview→OS, no validation — M — assisted *(overlaps #54)*
- [ ] **#55** App Group snapshot writes finance+pantry PII plaintext — S — manual-or-prod *(decision: widget needs)*
- [ ] **#76** Turkish dotted-İ names bypass PII wordlist — S — auto
- [ ] **#77** Crisis raw text leaks in CrisisSignal.matches[].line — S — assisted
- [ ] **#166** Crisis exclusion guard over-suppresses ALL tier-1 matches — M — assisted
- [ ] **#171** PII preserves 4-digit 1900-2099 as "year" → leaks PINs — S — assisted *(decision: year exemption)*
- [ ] **#172** Dead ADDRESS_NAME_STOPWORDS can never match — S — auto
- [ ] **#170** research-stream device_id fallback UUID can throw — S — auto
- [ ] **#154** Partner snapshot phrases not length-capped per entry — S — auto
- [ ] **#162** apns-push zero test coverage despite holding p8/ES256 — M — auto
- [ ] **#75** routing_cache shared across ALL users — M — assisted *(dep #24; decision: per-user vs shared)*
- [ ] **#102** invite_funnel views not security_invoker — S — auto
- [ ] **#109** Identity boundary doc + GDPR-erasure reconciliation — M — assisted *(dep #22)*
- [ ] **#110** Migration history drift vs prod — M — manual-or-prod
- [ ] **#111** Six worker tables shipped ENABLE not FORCE RLS — S — assisted *(dep #110)*
- [ ] **#112** partner_snapshots/dump_inbox safety depends on worker code only — M — assisted *(dep #22)*
- [ ] **#113** Dead authenticated RLS policy on grocery_purchase_history — S — assisted *(dep #22)*
- [ ] **#114** Four worker tables created without IF NOT EXISTS — S — auto
- [ ] **#63** account-delete keys on uuid + misses Clerk-text tables (GDPR) — M — manual-or-prod *(dep #22, #109)*

**Done-criteria:** foreign-azp token rejected; 6th invite-validate from one IP → 429 and
used/expired/missing all return identical `{valid:false}`; oversized bodies → 413; Sentry tunnel
413/429/502 paths covered; CSP + scoped ATS lands and Clerk login still works on macOS+iOS;
İ-initial TR names scrub to [NAME]; crisis response carries no raw input substring; all RLS-enabled
public tables show `relforcerowsecurity=true`; account-delete erases across both id spaces and fails
closed on no-resolve.

**Verification:** vitest worker suites (auth/rate/body), Rust clamp tests, golden PII tests,
SQL `pg_class`/`pg_policies` assertions, manual macOS+iOS boot+login after CSP/ATS.

**Execution:** auto fan-out for **#84, #38, #56, #165, #76, #172, #170, #154, #162, #102, #114**.
`assisted` need a human (azp/origin allowlist, oracle copy, crisis false-negative review, RLS predicates).
`manual-or-prod` for **#66, #55, #110, #63** (prod access / product calls).

---

## P4 — Logic & stats correctness

**Goal:** fix the statistical and calendar-math bugs that silently produce wrong signals.

Findings:

- [ ] **#21** bootstrapCI default RNG seed coupled to iters not data — S — auto
- [ ] **#52** computeMonthlyOutflow month arithmetic skips short months — S — auto
- [ ] **#58** friction-signature dow rate >1 + valley picks zero-data weekday — M — auto
- [ ] **#107** Luteal-spending injects structural-zero days, biases Spearman — S — auto
- [ ] **#136** Cycle-day counter divides absolute ms, off-by-one across DST — S — auto
- [ ] **#141** detectChangePoint fires on any nonzero delta when pooledSd=0 — S — auto
- [ ] **#143** detectSavingsTransfers labels any same-day same-amount high-conf — S — assisted *(decision: false-positive tolerance)*
- [ ] **#144** detectSavingsTransfers reads Date.now() for IDs — S — auto
- [ ] **#145** Sleep-debt window cutoff mixes local-midnight vs epoch — S — auto
- [ ] **#146** Two divergent isoWeekKey impls used as dedupe keys — S — auto
- [ ] **#51** Three conflicting cycle-phase boundary definitions — M — assisted *(decision: boundary table)*
- [ ] **#138** computePhaseForDate no upper bound → luteal forever — S — auto *(dep #51)*
- [ ] **#106** Cold-start change-point window split + pooledSd guard + body tick — M — assisted *(dep #141)*
- [ ] **#104** MAD scaling convention contradictory writers/readers — M — assisted *(decision: band semantics)*
- [ ] **#105** Peak-|rho| over 7 lags then single bootstrap CI is post-selection biased — M — assisted *(decision: correction method)*
- [ ] **#139** detectHabitRebirthLegacy counts cadence gaps as restarts — M — assisted
- [ ] **#142** detectLutealCollapse denominator uses current habit count — M — assisted
- [ ] **#140** Fixed 24h day-stepping with local dayKey skips/dups across DST — L — assisted

**Done-criteria:** bootstrapCI identical for iters=1000 vs 2000 on same data; month offset on the
31st resolves correctly; phase boundaries identical across all 3 call sites; zero-variance windows
don't fire a change-point; uncorrelated sleep+mood Monte-Carlo detection rate ≤ alpha; DST-spanning
day iterator yields exactly one entry per local calendar day.

**Verification:** vitest in packages/logic with pinned golden tables, Monte-Carlo false-positive
test, DST-boundary tests.

**Execution:** auto fan-out for the deterministic single-file fixes
(**#21, #52, #58, #107, #136, #141, #144, #145, #146, #138**). `assisted` items are stats-policy
calls (#51, #104, #105) or broad refactors (#140) needing Serra/clinical sign-off + review.

---

## P5 — Clean-code, reinvented wheels, design-system adoption, dead code, ops/config/tests

**Goal:** pay down the duplication, dead code, design-token drift, and ops/config contradictions
once the behavior-changing phases are stable. Mostly mechanical; sequenced so shared extractions
land before the large migrations.

Findings:

- [ ] **#13** scheduleReminderIfPresent duplicated admin/work — S — auto
- [ ] **#14** start_timer in-process setTimeout lost on quit — M — assisted *(dep #13)*
- [ ] **#15** newId() duplicated in 12-13 repos — S — auto
- [ ] **#17** RemoveButton reimplemented ~12x — M — assisted
- [ ] **#18** formatDays defined identically in 9-10 files — S — auto
- [ ] **#19** apns-push hand-rolls ES256 JWT vs @ollie/apns-jwt — S — assisted
- [ ] **#20** apns-push KV rate limit non-atomic — S — assisted *(decision: reachability)*
- [ ] **#126** FocusTimer brown-noise Audio element never released — S — auto
- [ ] **#137** medications_events declares an unenforced FOREIGN KEY — S — assisted *(decision: drop vs pragma)*
- [ ] **#175** Dead env var SUPABASE_SERVICE_ROLE_KEY in cron — S — assisted
- [ ] **#177** Dead layout primitives Container/Spacer/Box (~312 lines) — S — auto
- [ ] **#178** Hand-listed module registry (14 imports + 14 routes) — M — auto
- [ ] **#181** useBearer auth wrapper re-implemented in 4 places — S — auto
- [ ] **#16** Deep-link box/:id no allowlist against registry — S — auto
- [ ] **#12** encryptedKv envelope omits PBKDF2 iteration count — S — auto
- [ ] **#94** Cross-tab invalidation never fires per-key listeners — S — auto
- [ ] **#95** store.set hands subscribers a live cache reference — S — assisted
- [ ] **#121** useStoreSlice stale value when mod/key prop changes — S — auto
- [ ] **#122** useStoreSlice returns unmemoized setter each render — S — auto *(dep #121)*
- [ ] **#123** cross-tab sync ignores module names starting with _ — S — auto
- [ ] **#124** kv.get unguarded JSON.parse throws forever on corrupt value — S — auto
- [ ] **#125** Migration snapshot pruning relies on ms-unique Date.now() keys — S — auto
- [ ] **#131** Cold-start deep link guarded per-hook not per-process — S — auto
- [ ] **#133** Box load effects run migration on every mount — M — assisted *(dep #4)*
- [ ] **#35** Box lifecycle scaffold copy-pasted across 12-13 modules — L — assisted
- [ ] **#61** Ledger migration runner dead; 13-14 modules reinvent it — L — manual-or-prod *(decision: migration strategy)*
- [ ] **#31** Dark mode half-wired, static light-only `colors` alias — L — manual-or-prod *(decision: dark mode in scope)*
- [ ] **#32** Button/Input primitives bypassed by ~68 raw button/~10 input — XL — assisted *(dep #17)*
- [ ] **#59** SMCP small-caps style re-declared 15-19x — M — assisted *(decision: tracking value)*
- [ ] **#60** Oversized monolithic Box god-files — XL — assisted *(dep #17, #18, #32, #35)*
- [ ] **#176** Text primitive bypassed by ~157 inline fontSize/~88 fontFamily — XL — assisted *(dep #32)*
- [ ] **#179** GroceryNow third hardcoded-hex palette — S — manual-or-prod *(dep #31; decision: spike vs promote)*
- [ ] **#180** Layout primitives coexist with hand-rolled inline flex — L — assisted *(dep #60)*
- [ ] **#62** research-stream consent-gated on `necessary`, zero call sites — M — manual-or-prod *(decision: research_optin)*
- [ ] **#44** Queues blocks LIVE but comments say COMMENTED OUT + SERVICE_ROLE drift — (ops) — manual-or-prod

> Note: the `ops-config-tests` stream was truncated in the input after #44. #44 is captured here;
> any further ops/config/tests entries from that stream belong in P5 alongside #44, #175 and the
> apns-push items (#19, #20, #162) — re-ingest the full stream before fanning out P5.

**Done-criteria:** grep confirms single definitions of newId/formatDays/RemoveButton/useBearer/
isoWeekKey/POLL_MS/SMCP; dead primitives + dead env var removed (typecheck proves no importers);
lint rules ban raw button/input/inline-fontSize in modules; module registry is one manifest;
wrangler.toml Queues comments match reality; full `pnpm --filter native test` + per-package suites green.

**Verification:** typecheck + lint + full test suites; grep assertions on dedup; visual eyeball on
migrated Boxes; for #44/#61/#62/#31/#179 a Serra/prod call then a smoke test.

**Execution:** big auto fan-out for the dedup/dead-code/store-hook fixes. `assisted` for the
extractions that change 12+ Boxes (#17, #35, #32, #60, #176, #180) — do shared extractions first,
then the god-file split. `manual-or-prod` for #61/#31/#62/#179/#44 (architecture/product/prod calls).

---

## Effort rollup

| Phase | Findings | Auto | Assisted | Manual-or-prod | Notable effort |
|---|---|---|---|---|---|
| P0 decisions | 6 forks (+ ~11 inline calls) | — | — | — | decisions only |
| P1 alpha-gating | 11 | 3 | 1 | 7 | 3×XL (#22,#30,#108), L (#73) |
| P2 correctness | 52 | ~32 | ~13 | ~7 | mostly S/M |
| P3 security/privacy | 29 | 11 | ~13 | ~5 | M/S |
| P4 logic/stats | 18 | 10 | 8 | 0 | 1×L (#140) |
| P5 cleanup/ops | 34 | ~16 | ~12 | ~6 | 4×XL (#32,#60,#176 +god-files), 4×L |
| **Total** | **150 enumerated** | | | | |

Effort distribution across the enumerated set: roughly **13 conf-3 / 42 conf-2 / rest conf-1**
mapped to risk (high/medium/low). XL items (#22, #30, #108, #32, #60, #176) dominate wall-clock and
all carry either a prod migration, device crypto, or a 12+-file mechanical migration — schedule them
with a human in the loop.

> Coverage note: 150 of the stated 172 entries are enumerated here (the `ops-config-tests` stream was
> truncated after #44 in the source). All enumerated entries are assigned to exactly one phase in
> `fix-plan.json`. Re-ingest the truncated tail of `ops-config-tests` and append those entries to P5.
