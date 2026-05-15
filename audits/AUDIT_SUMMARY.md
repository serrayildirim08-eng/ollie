# Ollie — Full App Audit Summary (updated 2026-05-15, post-merge)

> **Note for Serra:** Documents path TCC-sandboxed. This master + 13 area audits live in repo at `audits/AUDIT_*.md`.

Post-merge update. Sprints from 2026-05-14/15 are now merged to `main` via PRs #8 (audit + decisions), #9 (cycle pill settings), #10 (consolidated: legal pages + account deletion + Sprint B'' + garden). `main` typecheck is clean (web + orchestrator). Open: PR #11 (garden Draco assets).

---

## Side-by-side completion (13 areas) — post-merge

| # | Area | Status | % WIRED | Remaining |
|---|---|---|---|---|
| 1 | Money / Finance | ✅ shipped | ~95% | Plaid prod approval (BLOCKED-EXTERNAL ~2 wks) |
| 2 | Body (cycle/sleep/body/habits) | ✅ shipped | ~90% | HealthKit Apple Dev approval (BLOCKED-EXTERNAL) |
| 3 | Crisis layer | ✅ shipped | 95% | `strings.tr.json` — N/A: EN+ES only, no Turkish (locked product decision) |
| 4 | Home screen | ✅ shipped | 95% | Overcast→sky flag one-liner (minor) |
| 5 | Onboarding | ✅ shipped | 100% | day-30 prompt now SHIPPED (PR #10) |
| 6 | Auth (passphrase Pattern A) | ✅ shipped | ~85% | Account deletion server-cascade SHIPPED (PR #10); Apple Sign-In deferred (passphrase-only beta per DECISIONS memo) |
| 7 | Notifications | ✅ shipped | ~90% | `flushNotificationQueue` cron SHIPPED (PR #10); Serra ops: apply migration + secrets + retire duplicate `apps/api/runCron` |
| 8 | Settings | ⚠️ partial | ~50% | birth_control + taxProfile toggles SHIPPED (PR #9/#10); subscription/voice/language still NOT STARTED |
| 9 | Garden / Burhan 3D | ✅ shipped | ~90% | Asset paths fixed + @ollie/garden index.ts + thresholds unified (PR #10); Draco compression in PR #11 (awaiting merge) |
| 10 | Capacitor iOS shell | ⚠️ approval-gated | ~75% | TestFlight pipeline NOT STARTED; push + HealthKit entitlements gated on Apple Dev |
| 11 | Voice ("Hey Ollie") | ⚠️ scaffolded | ~30% | Wake word doesn't exist (push-to-talk only); iOS Capacitor speech plugin not installed; multilingual EN-only |
| 12 | Astrology | 🗄️ deferred | N/A | Deferred to backlog (PR #10) — code in `astrology-deferred/`, URL gate removed, orchestrator disabled |
| 13 | Marketing site (ollie.app) | ⚠️ scaffolded | ~60% | privacy/terms/support pages written + Astro site scaffolded (PR #10); Serra: fill 6 TBDs + Vercel deploy + DNS |

**Average completion: ~80% (post-merge).**

---

## Resolved since previous audit (merged 2026-05-14/15)

- ✅ Privacy/terms/support pages written + Astro marketing site scaffolded (PR #10) — Serra: fill 6 TBDs + Vercel deploy
- ✅ Garden asset paths fixed; @ollie/garden index.ts created; stage thresholds unified (PR #10); Draco compression in PR #11
- ✅ Server-side account deletion endpoint — 7-table cascade (PR #10)
- ✅ flushNotificationQueue cron drain implemented — banned-phrase + budget + APNs (PR #10)
- ✅ Astrology deferred to backlog — URL gate removed, orchestrator disabled (PR #10)
- ✅ Day-30 retention prompt shipped (PR #10)
- ✅ Settings: birth_control + taxProfile.selfEmployed toggles surfaced (PR #9/#10)
- ✅ Auth Pattern A fix confirmed merged; account deletion server-cascade resolves the local-only gap

## Remaining blockers (post-merge)

1. **Apple Developer approval pending** — gates APNs production, push entitlement, HealthKit, TestFlight, IAP. ~2 weeks external.
2. **Plaid production approval pending** — ~2 weeks external.
3. **Marketing deploy** — pages + Astro site exist; Serra must fill 6 TBDs (legal entity, governing law, postal address, partner names, issue tracker, community link), create Vercel project, point `ollie.app` DNS.
4. **Notification cron ops** — apply migration `20260515000001`, set worker secrets, retire duplicate `apps/api/runCron` drain (escalated decision).
5. **Voice wake word doesn't exist** — "Hey Ollie" is push-to-talk only; needs Porcupine/picovoice OR drop the wake-word claim. iOS speech plugin not installed.
6. **TestFlight pipeline NOT STARTED** — no signing identity, provisioning profile, export config.
7. **PR #11 (garden Draco) awaiting merge.**
8. **Settings gaps** — subscription management (Stripe/IAP), voice settings, language selector, quiet hours still NOT STARTED.
9. **Manual UI verification** — symptom log + impulse pause + day-30 prompt never browser-tested (Serra-only walk).
10. **Capacitor entitlements** — push + HealthKit capability toggles gated on Apple Dev approval.

---

## Beta readiness — critical path (updated)

**Overall: ~80% feature-complete + ~45% launch-infra-complete.**

### Phase 1 — App Store unblocking (this week, no Apple Dev required)
1. Merge PR #11 (garden Draco assets)
2. Fill 6 TBDs in `marketing/privacy.md` + `marketing/terms.md`
3. Vercel project for `marketing/site` + `ollie.app` DNS
4. Notification cron ops: apply migration, worker secrets, retire duplicate `apps/api/runCron`
5. Sign off `DECISIONS_2026-05-14.md` (auth passphrase-only + astrology defer)
6. Manual UI verification walk (symptom log, impulse pause, day-30, settings toggles)

### Phase 2 — Awaiting Apple Dev approval (parallel, 1-2 weeks)
7. Voice: decide wake-word posture (drop claim OR Porcupine); install iOS speech plugin
8. Settings: subscription display, voice settings, language selector, quiet hours
9. ES localization sweep for remaining `// LOCALIZE_LATER` flags (in progress)

### Phase 3 — Apple Dev approval lands (mechanical)
10. Plaid production cutover (`packages/plaid/PRODUCTION_CHECKLIST.md`)
11. HealthKit prod cutover (`packages/capacitor-healthkit/PRODUCTION_CHECKLIST.md`)
12. APNs prod cutover (.p8 key + entitlement)
13. TestFlight signing + export config + first build submission

**Realistic beta launch: 2-3 weeks (Phase 1 ~1 wk, Phase 2 parallel, Phase 3 mechanical ≤1 wk after Apple approval).**

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
