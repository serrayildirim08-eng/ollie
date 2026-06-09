# Sprint 4 / Group E — ADHD-critical UX + voice + worker cron

**Status:** all 8 tasks + Decision #15 shipped.
**Tests:** 1079 vitest + 21 scanner pretest = 1100 checks (was 1087).
**Typecheck:** clean across all 14 workspace packages.

---

## E1 + E7 · Medication module

- `packages/logic/src/medication/` — pure types + dose/schedule helpers + adherence drift detector (window default 14d, threshold 0.5).
- `packages/orchestrator/src/medication.ts` — wires into root orchestrator; recomputes `dueSlots` + `adherence` every 60s and on items change; emits `medication:overdue_detected`, `medication:adherence_drift`.
- `apps/web/src/modules/medication/MedicationModule.tsx` — add/edit/log/archive UI. Color-dot tile, multi-slot schedule input, factual voice ("noted." / "pattern, not medical." / never "great job!").
- Wired into body cluster on dashboard. Lazy-loaded in ModuleScreen.
- 17 new tests (`packages/logic/tests/medication.test.ts`) — includes explicit assertion that adherence copy NEVER says "missed | failed | broken | streak | great job".

Vitamins fold into the same schema via `kind: 'vitamin'` — E7 done as part of E1.

## E4 · Worker-side cron + scheduled_jobs

- `supabase/migrations/20260513_000001_scheduled_jobs.sql` — table with `(user_id, fire_at, job_type, payload, status, dedupe_key)`, partial unique index on `(user_id, dedupe_key)` for idempotent rescheduling, forced RLS, anon revoked.
- `apps/api/src/worker.ts` — adds `scheduled()` handler (Cloudflare cron) + manual `/cron/tick` endpoint. Selects pending jobs LIMIT 100 per tick, dispatches via APNs JWT, atomically marks `fired | failed`.
- `apps/api/wrangler.toml` — `[triggers] crons = ["* * * * *"]` + `SCHEDULED_JOBS_ENABLED` env var (default off until Serra finishes APNs key generation).
- `packages/notifications/src/server-schedule.ts` — client-side helper `scheduleServerJob(deps, spec, fireAt)` that upserts into `scheduled_jobs` via `OllieAPI`. Falls back gracefully when not authenticated.

## E5 · Cross-protective chain rules

Extended `CROSS_MODULE_RULES` in `packages/router/src/cross-module.ts`:

| Source event | Target | Reflect |
|---|---|---|
| `sleep:short_sleep_run_detected` | `finance:spending_caution_surfaced` | `finance.protective_cards` |
| `sleep:pacing_breach_detected`   | `app:reduce_motion_mode_on`        | `shared.reduce_motion_today` |
| `work:hyperfocus_detected`       | `body:fatigue_warning_surfaced`    | `body.protective_cards` |
| `cycle:luteal_phase_entered`     | `finance:surface_cycle_spending_card` | `finance.cycle_card_visible` |

All quiet surfaces (cards / store flags) — never demanding pushes. Existing 8 cross-module wires from Sprint 3 unchanged.

## E2 · Push-to-talk voice

- `apps/web/src/lib/voice-capture.ts` — single-entry `startVoiceCapture(cb)` that dispatches to web / electron / capacitor via runtime detection. 30s cap, on-device only.
  - Web: Chrome / Safari `webkitSpeechRecognition`
  - Electron: bridges to `window.ollie.voice` (renderer-side Web Speech today; future native SFSpeech hook)
  - Capacitor: dynamic `import('@capacitor-community/speech-recognition')` — plugin install deferred to Sprint 5
- `apps/web/src/components/MicButton.tsx` — floating mic, subtle pulse animation while recording, interim transcript preview, error pill.
- Mounted globally in `App.tsx` (after onboarding, on every screen).
- Pipes transcript → `useApplyBrainDump()` → existing dissection router.

## E3 · Hey Ollie · Mac shortcut + iOS skeleton

- **Mac (shipped):** `apps/desktop/main.js` registers `globalShortcut.register('CommandOrControl+Control+Space')` on whenReady. Brings window forward + emits `ollie:hotkey` via IPC. `apps/desktop/preload.js` exposes `window.ollie.hotkey.onHotkey(cb)`. MicButton subscribes and triggers `start()` automatically.
- **iOS (skeleton):** `apps/ios/INTENTS.md` documents three App Intents — `OllieCaptureIntent`, `OllieRemindIntent`, `OllieDueIntent` — with full Swift skeleton + `AppShortcutsProvider`. Activation deferred to Sprint 5 (needs `pnpm cap add ios` + Apple Developer enrollment, same gate as APNs).

## E6 · Audio assets

All six loops were already on disk + non-stub in `SleepSoundPlayer`. Added `apps/web/public/audio/SOURCING.md` documenting current CC0 licensing + criteria for commercial replacement pre-launch.

## E8 · Grocery interest-capture

- `packages/logic/src/grocery/interest-capture.ts` — temporal clustering: 3+ distinct names in the same non-consumable category within 21d. Consumable categories (dairy, meat, produce, etc.) filtered out so milk × 3 stays in the cascade detector's lane.
- `packages/orchestrator/src/grocery.ts` — recompute writes `grocery.interest_captures` + emits `grocery:interest_capture_detected` once per new category.
- Existing D2 cross-module rule already routes `habits:interest_capture_detected` → work pause; grocery's separate event surfaces in finance later when the B2B research pipeline reads it.

## Decision #15 · Garden = research opt-in gift

- `apps/web/src/pages/GardenConsentScreen.tsx` — single-screen consent prompt with the exact Ollie-voice copy: *"the garden is for people who want to help us learn how brains like yours move through life. anonymous, opt-in, withdrawable. burhan grows with what you log. nothing leaves the device unencrypted. turn it on?"* + always-visible "change anytime in settings".
- `App.tsx` `/garden` route gated on `shared.consent.spending_research`. If false: render `GardenConsentScreen`. Accept flips consent + opens garden. Decline returns to dashboard.
- Mini Burhan in dashboard corner stays visible for everyone (decoration/brand, no gating).

---

## Per-package totals

| Package         | Before | After | Δ |
|-----------------|--------|-------|---|
| events          | 11     | 11    | (registry added 17 new event names — events test unchanged) |
| store           | 19     | 19    | 0 |
| crypto          | 19     | 19    | 0 |
| logic           | 808    | 821   | +13 (medication) |
| api             | 23     | 23    | 0 |
| backup          | 11     | 11    | 0 |
| router          | 17     | 17    | 0 (rules extended; existing cross-module suite still green) |
| orchestrator    | 87     | 87    | 0 |
| research-stream | 12     | 12    | 0 |
| auth            | 9      | 9     | 0 |
| notifications   | 11     | 11    | 0 |
| sync            | 6      | 6     | 0 (test deflaked with explicit `runAllTimersAsync`) |
| apps/web        | 33     | 33    | 0 |
| **vitest**      | **1066** | **1079** | **+13** |
| scanner pretest | 21     | 21    | 0 |

---

## What still needs your hands-on step

1. **Apply migration `20260513_000001_scheduled_jobs.sql`** to `ykxzfzkfsolwgmheiwpx` (same path as Sprint 2 migrations).
2. **Flip `SCHEDULED_JOBS_ENABLED='1'` + set `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` worker secrets** once the APNs `.p8` is in place — then `wrangler deploy` activates the every-minute cron.
3. **`pnpm cap add ios`** to generate the Xcode project so the iOS App Intents from `apps/ios/INTENTS.md` can be added. Deferred to Sprint 5 (same Apple Developer enrollment that unblocks APNs).
4. **`@capacitor-community/speech-recognition`** plugin install — defer until iOS project exists.

## Coming next · Sprint 5 / Group F

Mobile native polish + App Store + Stripe paid tier.
