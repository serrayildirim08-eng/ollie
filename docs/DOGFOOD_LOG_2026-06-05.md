# Ollie Dogfood Log — 2026-06-05

Serra dogfooding via Tauri + `wrangler tail` on `ollie-ai-proxy`. Tracking where each brain dump routes + bugs to fix in a batch.

---

## Dump #1 — 23:22 (multi-fragment, sleep/work/body/med)

**Input:** `2am yatakta uyuyamıyorum hiç almost insomnia maya'nın L-1 brief'i yarın yapmam lazım kafa hala koşuyor melatonin almak istemiyorum yarın zaten kaybetmişim`

**Routed (6 fragments → 5 modules):**

| Fragment | Module | Action | Confidence |
|---|---|---|---|
| 2am yatakta uyuyamıyorum hiç | sleep | log_insomnia | 0.9 |
| almost insomnia | sleep | log_insomnia | 0.8 |
| maya'nın L-1 brief'i yarın yapmam lazım | work | log_deadline | 0.9 |
| kafa hala koşuyor | body | log_symptom | 0.7 |
| melatonin almak istemiyorum | medication | missed_dose | 0.8 |
| yarın zaten kaybetmişim | dump_only | archive_only | 0.4 |

**Findings:**
- ⚠️ **B1 — Groq count mismatch:** `classify-batch groq count mismatch: got 8 want 6` → Groq fell through to fallback provider. Self-recovered (dump not lost), but if Groq mismatches consistently every dump pays the slow+expensive fallback path. Investigate why Groq over-segments (8 vs 6).
- 🤔 **B2 — possible misroute:** "melatonin almak **istemiyorum**" → `medication / missed_dose`. She *chose not to* take it, didn't miss a dose. AI read negation-of-intent as a missed dose. Pending Serra confirm: correct or wrong?

---

## Dump #2 — 23:25:07 (COLLAPSED — data loss)

**Input:** `morning is rough head hurts slept 3 hours email boran for uscis milk's out tontin's vet appointment tomorrow at 10 hasn'...`
**Expected:** ~4 fragments → body + work(email boran) + grocery(milk) + pets(vet appt)
**Got:** 1 fragment only → `body / log_symptom 0.8`. Rest LOST.
**Cause:** Groq `pass2` + `classify-batch` both returned `400 json_validate_failed` → fell back to single pass1 fragment.

## Dump #3 — 23:25:15 (COLLAPSED — data loss)

**Input:** `i-129 done i'm done too sat for 7 hours head's foggy doom shopped on amazon got a wireless mouse this is the 3rd one cra...`
**Got:** 1 fragment only → `dump_only / archive_only 0.4`. (i-129 work milestone + amazon purchase + body all lost.)
**Cause:** same Groq `400 json_validate_failed`.

## Dump #4 — 23:25:15 (GOOD — 8 fragments)

**Input:** `amsterdam apartment search spent 4 hours nl visa fee 180 euros research pet passport for tontin and pinpon august 30 ist...`
**Routed well:**
| Fragment | Module | Action | Conf |
|---|---|---|---|
| amsterdam apartment search | admin | create_task | 0.8 |
| nl visa fee 180 euros | finance | log_transaction | 0.7 |
| research pet passport for tontin | pets | log_care | 0.9 |
| istanbul lease ends | admin | log_renewal | 0.8 |
| moving company quoted 2400 | finance | pending_decision | 0.7 |
| call with betül tomorrow | admin | create_phone_task | 0.9 |
(+ 2 dump_only)
**But:** hit Groq `429` TPM rate limit (free tier 8000 TPM, used 6112) + `waitUntil() tasks cancelled` (background work dropped).

---

## B7 🔴 — Clerk login dead in built app (native dogfood blocker)

**Symptom:** built `Ollie.app` shows the Clerk SignIn form but can't complete login (works fine in `tauri dev`).
**Root cause (confirmed):** built app loads from `tauri://localhost` (DOM footer link = `tauri://localhost#/sign-up`). Clerk's `pk_test` dev instance + OAuth redirects + Turnstile captcha only trust **http(s)** origins → the custom `tauri://` scheme is rejected. Dev mode works because there it's `http://localhost:1420`.
**Fix applied:** `tauri-plugin-localhost` serves the bundled frontend over `http://localhost:9527`; window `url` pointed there (Cargo.toml + lib.rs + tauri.conf.json). Built app now uses an http origin like dev → Clerk should accept. **VERIFIED 2026-06-05: login works in built `Ollie.app`** (origin `http://localhost:9527`). Native dogfood unblocked.
**Also:** enabled `devtools` feature on `tauri` so the built app's WKWebView is inspectable (right-click → Inspect / Safari Develop menu) for future debugging.

---

## FEATURE — Mood module added (2026-06-06)

Gap found during dogfood: emotional/energy/self-talk dumps had no home → forced into body/habits at low confidence. Added a first-class **mood** module.
- **Actions:** `log_mood` (emotion: anxious/sad/numb/overwhelmed), `log_energy` (tired/exhausted/drained), `self_talk` (self-evaluation: "don't like myself", "did nothing today").
- **Boundary:** body keeps PHYSICAL symptoms; habits.identity_statement now only DELIBERATE positive identity goals; negative self-talk → mood.
- **Built:** worker router (enum + classify prompt + examples), native module `apps/native/src/modules/mood/` (handler/repo/migrate/bridge/types/MoodBox + test) mirroring body, all registrations (schema/stubs/bridge/nav). DB `mood_events` + store key `mood.logs`.
- **Status:** native typecheck clean, worker typecheck clean, 339/339 tests pass. Worker DEPLOYED (version b746b0d8). App rebuilt. v1 EXCLUDES Layer-2 Notice/patterns + trend charts (separate phase).
- Note: separate lexicon-based `recordMoodFromDump` (goals delete-lock signal) is untouched — coexists.

## Findings batch

- 🔴 **B3 — Groq JSON-validate 400 collapses dumps (DATA LOSS):** `pass2` + `classify-batch` repeatedly fail `json_validate_failed` → multi-topic dumps collapse to ONE fragment. Dumps #2 and #3 lost most of their content. Highest priority — silent routing loss.
- 🟠 **B4 — Groq 429 TPM rate limit:** free tier 8000 TPM caps real dogfood bursts. Matches known Groq-tier-limit issue. Need Dev Tier / throttle / prompt caching.
- 🟡 **B5 — waitUntil() cancelled:** background tasks (cache write / persistence?) dropped after response. Investigate what work is lost.
- 🔴 **B6 — APP CRASH (dev-only):** SIGABRT via `UNUserNotificationCenter::currentNotificationCenter()` in `local_notifications.rs:65/92`. In `tauri dev` the binary isn't a signed `.app` bundle → macOS aborts when scheduling a reminder. **Workaround applied:** dogfooding now runs the real built `Ollie.app` (`tauri build` → `target/release/bundle/macos/Ollie.app`), which has a valid bundle id → no abort + reminders actually fire. Code fix still nice-to-have: guard `currentNotificationCenter` to no-op when `NSBundle.mainBundle().bundleIdentifier()` is nil, so `tauri dev` survives too.
  - Build note: `tauri build` itself succeeded; only the trailing `bundle_dmg.sh` (.dmg installer) step failed — cosmetic, the `.app` is fine.

---
