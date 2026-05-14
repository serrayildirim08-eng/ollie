# Ollie — Full App Audit Summary (2026-05-14, REFRESHED)

> **Note for Serra:** Documents path TCC-sandboxed. This master + 13 area audits live in repo at `audits/AUDIT_*.md`.

Refreshed synthesis across all 13 area audits, capturing state drift from parallel session pushes (B2B telemetry, garden package, consent rewrite, store.ts astrology orchestrator) + sprint follow-up items A-G.

---

## Side-by-side completion (13 areas)

| # | Area | Status | % WIRED | Critical blockers |
|---|---|---|---|---|
| 1 | Money / Finance | ✅ shipped | ~95% | Plaid prod approval (BLOCKED-EXTERNAL ~2 wks) |
| 2 | Body (cycle/sleep/body/habits) | ✅ shipped | ~90% | HealthKit Apple Dev approval (BLOCKED-EXTERNAL) |
| 3 | Crisis layer | ✅ shipped | 95% | `strings.tr.json` missing (1-day fix) |
| 4 | Home screen | ✅ shipped | 95% | Overcast→sky flag one-liner (still open) |
| 5 | Onboarding | ✅ shipped | 100% (8 screens) | day-30 prompt not implemented (TBD if needed) |
| 6 | Auth (passphrase Pattern A) | ✅ Pattern A FIXED | 75% | **Account deletion local-only (orphans server row)**; Apple Sign-In NOT STARTED (blocker IF other social logins) |
| 7 | Notifications | ⚠️ 85% live | ~85% | `flushNotificationQueue` cron stub (P1, ~150 LOC); `/register-token` schema TBD |
| 8 | Settings | ⚠️ partial | ~33% (4/12) | birth_control_enabled + taxProfile module-local; subscription/voice/HealthKit/language all NOT STARTED |
| 9 | Garden / Burhan 3D | ⚠️ broken build | ~70% | **CRITICAL: 7 asset paths 404 post-188a602**; @ollie/garden index.ts missing; stage thresholds divergent (Burhan: 15/61/181/541 vs canonical 1/7/30/90/365) |
| 10 | Capacitor iOS shell | ⚠️ approval-gated | ~75% | TestFlight pipeline NOT STARTED; push entitlement gated; HealthKit pod install pending |
| 11 | Voice ("Hey Ollie") | ⚠️ scaffolded | ~30% | **Wake word doesn't exist** — push-to-talk only; iOS Capacitor plugin not installed; multilingual EN-only |
| 12 | Astrology | ⚠️ inaccessible | 0% public (URL gate `?astrology=1` only) | NEW: inline orchestrator in store.ts wires recompute reactively; no `/horoscope` endpoint, no event emit |
| 13 | Marketing site (ollie.app) | ❌ NOT STARTED | 0% | **Privacy policy + terms + support URLs missing — App Store HARD BLOCKER**; B2B pivot requires updated policy content |

**Average completion: ~65%.**

---

## Top 10 cross-cutting blockers

1. **Privacy policy + terms + support URLs don't exist** — App Store HARD reject. Code refs `ollie.computer/{privacy,terms}`, pages missing. Domain itself unclear (`ollie.app` vs `ollie.computer`). 5.5 hrs to fix.
2. **Garden asset paths 404 post-188a602** — 7 core assets (daisies/ground/dirt-pile/fence/tree-ring/signboard/path-stone) deleted from `/public/assets/garden/` but code still references them. Production build will fail.
3. **Apple Developer approval pending** — gates APNs production, push entitlement, HealthKit, TestFlight, IAP. ~2 weeks external.
4. **Account deletion is client-only** — wipes localStorage, server row orphaned. App Store privacy review concern. Needs server endpoint (~half day).
5. **flushNotificationQueue cron worker is STUB** — server-side scheduling doesn't work. Client-side does. Memo recommends Option D+E (9-14 dev-days).
6. **Voice wake word doesn't exist** — "Hey Ollie" branding requires either dropping the claim or installing Porcupine/picovoice + detection logic.
7. **Stage threshold divergence in garden** — Burhan.tsx code (15/61/181/541) vs `@ollie/garden` canonical (1/7/30/90/365). Pick one before launch.
8. **Marketing site entirely NOT STARTED** — no landing, no FAQ, no waitlist, no "Made by ADHD people" narrative. B2B pivot requires updated privacy/terms content.
9. **TestFlight pipeline NOT STARTED** — no signing identity, no provisioning profile, no export config.
10. **Settings module-local toggles** — birth_control_enabled in CycleModule, taxProfile.selfEmployed store-only; subscription/voice/HealthKit-status/language/quiet-hours all NOT STARTED.

---

## Beta readiness — critical path

**Overall: ~55% feature-complete + ~30% launch-infra-complete.**

### Phase 1 — App Store unblocking (1 week, no Apple Dev required)
1. Write + deploy privacy policy (updated for B2B pivot: research corpus, PII scrub, Claude labeling), terms, support pages
2. Pick domain (`ollie.app` recommended); register if needed; update SettingsScreen.tsx URLs
3. Decide auth posture: passphrase-only (no Apple Sign-In needed) OR add Apple Sign-In + Google
4. Wire server-side account deletion (cascade across encrypted state, plaid_items, finance_records, profiles)
5. **Fix garden asset paths** (vite copy hook OR import update) — production build blocker
6. Pick one garden stage threshold + align spec + code

### Phase 2 — Awaiting Apple Dev approval (parallel work, 1-2 weeks)
7. Stand up minimal marketing site (Astro or no-code) — homepage + waitlist + ADHD-first narrative
8. Symptom log + impulse pause manual UI verification (Serra-only browser walk)
9. ES `strings.tr.json` for Turkish speakers (crisis hotline framing)
10. Settings UI: lift birth_control_enabled + taxProfile.selfEmployed + HealthKit status (3 toggles)
11. Decide astrology posture (ship with Claude horoscope OR defer; cut URL gate either way)
12. Implement `flushNotificationQueue()` cron worker (per memo Option D + E)
13. Create `@ollie/garden/src/index.ts` + wire Burhan.tsx to use canonical thresholds

### Phase 3 — Apple Dev approval lands (mechanical)
14. Plaid production cutover (`packages/plaid/PRODUCTION_CHECKLIST.md`)
15. HealthKit prod cutover (`packages/capacitor-healthkit/PRODUCTION_CHECKLIST.md`)
16. APNs prod cutover (.p8 key + entitlement + TestFlight)
17. TestFlight signing + export config + first build submission

### Phase 4 — Optional polish (post-beta)
- Apple Sign-In if added
- Voice wake-word (Porcupine + iOS Speech plugin)
- Astrology Claude horoscope endpoint
- Subscription management (Stripe + Apple IAP)
- Multi-device auth pairing flow (currently backup import only)
- ES localization for remaining `// LOCALIZE_LATER` flags
- Day-30 retention prompt UI

**Realistic beta launch: 3-4 weeks (Phase 1+2 = 2 wks, Phase 3 mechanical = ≤1 wk after Apple approval).**

---

## 3 biggest surprises across all 13 audits

1. **Garden asset paths 404** — commit 188a602 deleted `/public/assets/garden/*.glb` to move them under `/public/models/garden/`, but didn't update 7 component imports. Production builds break. CRITICAL.

2. **Marketing site privacy policy URL hardcoded to a domain that doesn't exist.** Code refs `ollie.computer/privacy`, not `ollie.app/privacy`. No page at either. Plus B2B pivot (commit 6e7981e) means policy content itself needs full rewrite (research corpus, PII scrub, Claude labeling disclosures).

3. **"Hey Ollie" wake word doesn't exist.** Voice is push-to-talk only. No Porcupine, no picovoice, no continuous listening. Branding implies otherwise.

### Honorable mentions

- **Astrology has 2,195 LOC of fully-built, fully-styled code that no user can access** (URL gate `?astrology=1`). NEW: store.ts now wires an inline reactive orchestrator (lazy boot, 24h transit refresh).
- **Account deletion is client-only** — Apple App Store privacy review flags this.
- **Pearson + Spearman math layer was audit surprise #2 → now registry-driven daily run** (P6 + body-correlations).
- **Notifications: 25 call sites + 49 subscribers wired across 9 modules**, but `flushNotificationQueue` cron drain function is a stub. Server path silently doesn't work; client path does.

---

## What's solid (positive)

- **Money module**: WIRED-CROSSMODULE end-to-end. Plaid sandbox, encrypted sync, 9 APNs subscribers, PDF export, biometric privacy mode.
- **Body module**: 5 real ML correlators + APNs wiring + cycle/sleep/habits/body talking via event bus. HealthKit scaffold ready.
- **Crisis layer**: production-honest. EN+TR keywords, 12-country hotlines, zero network, zero telemetry, free tier accessible. ES copy added today.
- **Onboarding**: 8 screens complete + commit pure-function + ConsentScreen rewrite landed cleanly.
- **Auth (Pattern A)**: critical C1 from 2026-05-11 audit REMEDIATED. Passphrase never reaches Supabase. 26 tests passing. Load-bearing assertion tests cannot be regressed.
- **Home screen**: weather API live, sky video logic correct, brain dump alive post-Sprint A. One overcast→sky one-liner still open.
- **Capacitor**: 4 plugins active + HealthKit scaffold (Item F today), Siri Intents wired, 6 privacy descriptions, Bundle ID stable.
- **Notifications infrastructure**: APNs worker deployed, boot injection live (Item A today), pattern:detected wired (Item B today), 49 subscribers across 9 modules.

---

## Recommended next actions (this week)

1. **Fix garden asset paths** (vite copy hook OR import update) — blocks production build
2. **Decide on auth posture** — passphrase-only ships easier (no Apple Sign-In needed)
3. **Write privacy + terms + support pages today** (updated for B2B pivot, ~4 hrs) — unblocks App Store
4. **Server-side account-deletion endpoint** (~half day) — eliminates App Store privacy review risk
5. **Decide astrology posture** — defer to backlog (cleanest) or commit to Claude horoscope sprint

---

*Master audit synthesis (refreshed) by Claude (Opus 4.7), 2026-05-14. 11 area re-audits delegated to parallel Explore agents; content consolidated + written by main thread. State drift from parallel session pushes (B2B telemetry, garden 188a602, consent rewrite) captured.*
