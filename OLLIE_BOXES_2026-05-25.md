# Ollie Boxes — 2026-05-25

30 feature kutusu. Audit'teki 423 feature, **alan başına** gruplanmış. Her kutuda: içindekiler (LIVE), eksikler (STUB + BLOCKED), karar notu.

Sırala = kategori → kategori içi sağlık skoru (kötü → iyi). En kötü kutu önce.

---

## A. KULLANICI MODÜLLERİ (12 kutu)

### 📦 Box 1 — work
**Health: 18/33 LIVE (55%) — 🔴 BROKEN**

**İçinde (LIVE):** focus timer, focus session logging, brown noise, projects, weekly billable hours, meeting logging, meeting cue, scheduled deep-work blocks, block cue, pomodoro tracking + UI, distraction journal, hand-off notes, task list, work patterns display, 5-min/90-min/4-blocks cues, brain-dump → work routing, `pattern_detected` + `hyperfocus_detected` events.

**Eksik (15):**
- 13 STUB detector: W1 task-switch-tax, W2 meeting-cliff, W3 hyperfocus-crash (prompt+pattern), W4 deadline cues, W5 activation barrier, W6 estimation drift, W7 tab sprawl, W8 notification tax, W9 post-meeting buffer, W10 recurring meeting dead, W11 one-more-thing spiral, W12 shutdown gap, W13 multitask illusion, W14 RSD anchor, W17 triage day anchor
- 2 BLOCKED: W0 deep-focus-hours, W0 pacing-breach

**Kök sebep:** UI `work.focus_log`'a yazıyor, detector'lar `state.sessions` okuyor — mismatch.

**Karar:** detector'ları focus_log okuyacak şekilde rewrite et VEYA dual-write yap.

---

### 📦 Box 2 — admin
**Health: 12/17 LIVE (71%) — 🟡 NEEDS_WORK**

**İçinde (LIVE):** A1 open-loop, A2 phone-task, A3 renewal cues, A4 paperwork-split, A5 firehose-dump, A6 defer-chain, A8 2-min task, A9 stale-ball, A10 recurring pattern, A12 last-5%, A14 doc-refs, D1-D2 appointment transitions + dismissal.

**Eksik (5 STUB):**
- A2b phone script generator (UI prompt var, jeneratör yok)
- A7 cost-of-delay (logic var, orchestrator çağırmıyor)
- A11 activation-cost classifier (logic var, integration yok)
- A13 recurring-decision (logic var, orchestrator hook yok)
- A15 schedule-from-dump + drift (logic var, subscribe yok)

**Karar:** Phase 3'ü orchestrator'a bağla VEYA UI render slot'larını kaldır.

---

### 📦 Box 3 — pets
**Health: 31/39 LIVE (79%) — 🟡 NEEDS_WORK**

**İçinde (LIVE):** Care gaps (5 tier), health flags, guilt copy, today forecast, observation entry, 10 species profiles, parsePetMention, away/session/milestone intents, weather alerts, P1-P5 patterns (vet cue, adherence, co-regulator, activation, crash misses, projection), vocab rotation, weekly preface, adoptversary, manual care log, archiving, dismissal, health flag review, feed task, away mode, PetsNoticed panel, severity colors, summary aggregate, consent gate, cooldown, welfare notes, species fallback, negation handling.

**Eksik (8 STUB):**
- Trust level (hardcoded stage-0)
- Micro-steps UI yok
- vet_schedule UI yok
- coregulation_log writer (body modülünden)
- miss_log writer (work/dumps'tan)
- projection_log writer (P5 detector kendi yazmıyor)

**Karar:** UI ekle (vet schedule + micro-steps) + cross-module writer'ları bağla.

---

### 📦 Box 4 — cycle (+ postpartum)
**Health: 26/30 LIVE (87%) — 🟡 NEEDS_WORK + 🔴 1 KRİTİK BLOCKED**

**İçinde (LIVE):** Bayesian 4-layer prediction (Urteaga 2021), boundary detection, phase computation, health flags (ACOG-referenced), syndrome detection, symptom clustering, adherence detection, ovulation prediction, fertile window, period logging UI, prediction display, day/phase indicator, pattern correlations, clinician flags, birth control pill logging, pill type, partner support, cycle history tiles, settings panel, passphrase hint, module visibility gate, adherence banner, orchestrator integration, APNs push, event emission, cycle × finance correlations.

**Eksik (4):**
- Sleep-cycle-lag pattern (dosya var, wire yok) — STUB
- **🔴 Postpartum state tracking** — onboarding gate var, mantık YOK — BLOCKED
- **🔴 Cycle data ENCRYPTION** — sensitive veri Supabase'e plain gidiyor — BLOCKED
- Import/export handlers stub — BLOCKED

**Karar:** Encryption + postpartum kritik. Sleep-lag + import/export küçük iş.

---

### 📦 Box 5 — finance + money-v2
**Health: 25/28 LIVE (89%) — 🟢 HEALTHY (ama 2 BLOCKED ürün kararı)**

**İçinde (LIVE):** Recurring bills, upcoming forecast, savings goals, ADHD-tax detection, impulse pause (24h), subscription dormancy, cancel-URL DB (170+ aliases), privacy masking, CSV/PDF export, income classification, tax set-aside (US/UK/EU), savings transfer detection, cycle × spend, sleep-debt × spend, anomaly detection, D3 subscriptions/ADHD-tax/cycle-spending, F1-F7 patterns (doom-buy, cancel-avoidance, return-abandonment, hyperfocus, gig-volatility, duplicate, research-paralysis), bill creation (20 presets), transaction logging.

**Eksik (3):**
- money-v2 redesign (branch'te, default değil) — STUB
- Plaid integration (47a6fa6 silindi, tablolar Supabase'de) — BLOCKED (ürün kararı)
- TrueLayer (scaffolding only, iptal) — BLOCKED

**Karar:** money-v2'yi default yap veya branch'i sil. Plaid tablolarını DB'den drop.

---

### 📦 Box 6 — sleep
**Health: 27/30 LIVE (90%) — 🟢 HEALTHY**

**İçinde (LIVE):** Sleep records (braindump + manual), HealthKit sync, sleep stats, sleep debt, DSPS pattern, bedtime drift, chronotype, social jetlag, short-sleep run, tonight TST forecast (CI95), 9 pattern detector (revenge bedtime, caffeine cutoff, onset gap, weekend illusion, mind racing, wind-down friction, med drift, chronotherapy progress, sleep×cycle/focus/mood/cycle-coupling/stimulant), wind-down checklist UI, brown noise player (6 sounds), insomnia survey (ISI-lite), "go deeper" button, wind-down window event, pattern detect events.

**Eksik (3 STUB):**
- MCTQ profile (placeholder)
- PSQI (placeholder)
- ESS daytime sleepiness (placeholder)

**Karar:** 3 enstrümanı yap (~1 gün) veya UI'dan kaldır (~15 dk).

---

### 📦 Box 7 — body
**Health: 35/36 LIVE (97%) — 🟢 HEALTHY**

**İçinde (LIVE):** Episode tracking (heavy), doctor summary, episode kind suggest, chronic conditions registry, treatment plans, water tracker, supplements + reminders, posture nudge, 14 pattern detector (headache↔hydration, interoception drift, hyperfocus dehydration, afternoon crash, supp drift, multi-symptom, hunger↔thirst, caffeine↔water, meal skip, GI↔cycle, movement gap, vasomotor, symptom↔cycle, sleep-debt↔symptom-lag), cross-module signals, protective cards, hydration drop detection, episode normalization, treatment side-effect pattern, work pacing → reduce motion, body correlations registry, HealthKit integration + consent.

**Eksik (1 STUB):** Episode pattern detectors (type'lar tanımlı, detector function yok — duration, trigger, recurrence, med adherence)

**Karar:** 4 detector yaz, `detectPatterns()` runner'a ekle.

---

### 📦 Box 8 — habits
**Health: 40/40 LIVE (100%) — ✅ COMPLETE**

**İçinde (LIVE):** Habit creation/completion/removal/ledger, daily hero count, UTC dedup, `habits:completed` + `morning_check` events, morning push notification, 16 detector (FreshStartCrash, IdentityFraming, BodyVsCognitive, HabitDrift, FrictionSignature, SleepHabitCoupling, HabitRebirth, SelfTalkHabit, ExternalizationGap/Requirement, LutealCollapse, SensoryFlag, InterestHijack, StressCollapse, HyperfocusSpillover, KeystoneAnchor, MedAdherenceCoupling), pattern batch runner, orchestrator subscribe + emission + dedup, persistence, HabitsNoticed surface, water prompt cross-module router, ritual peak detection, goal→habit conversion, phase-2 signal banners.

**Eksik:** YOK.

**Karar:** dokunma, çalışıyor.

---

### 📦 Box 9 — goals
**Health: 40/40 LIVE (100%) — ✅ COMPLETE**

**İçinde (LIVE):** Goal creation (what/why/target), obstacle, premortem, ulysses contract, role, category (6), pacing (sprint/marathon/rolling), manual progress, milestones + auto-compute, AI step breakdown (Claude), session tagging, review modal, status transitions, G1-G16 detectors (contagion, active cap, missing anchor, low-mood lock, research-as-progress, obstacle echo, premortem echo, floating goal, missing/EF construal, anti-goal opportunity + dump, identity drift, goal interference, sunk cost, pacing classify + breach, ulysses on delete, experiment candidate), convert to habit (+ modal), achievement gallery (embedded + standalone screen), goal velocity by category, GoalsNoticed surface, filtering, low mood banner.

**Eksik:** YOK.

**Karar:** dokunma, çalışıyor.

---

### 📦 Box 10 — grocery + Feed Me
**Health: 40/40 LIVE (100%) — ✅ COMPLETE**

**İçinde (LIVE):** Parse intent verbs (EN/TR/ES), normalize names (Levenshtein + 200+ alias), category classification (11 cats), shelf life learning, quantity parsing, duplicate/expiration/stockout/stale/cadence/interest-capture detectors, recipe inference + search, diet filters (5), known store learning (geo), pantry segmentation, add-to-list → pantry, teach-me canonicals, add missing from recipe, AI routing (Voyage + Gemini Flash), Gemini context, list mutation commands (5 intents EN/TR/ES), undo stack (LIFO 10, 11 triggers), undo via brain dump, SortedToast (5 modes), Feed Me v2 (3-card stack, cook history, diet pills, pet target), recipe rejection, cook modal, static fallback, replenishment, PII scrub (brand allowlist), research corpus pipeline, Clerk JWT verify (web), routing cache, smart suggest.

**Eksik:** YOK. (Note: Electron/Clerk web-only, separate box.)

**Karar:** dokunma, çalışıyor.

---

### 📦 Box 11 — medication
**Health: 5/5 LIVE (100%) — ✅ COMPLETE**

**İçinde (LIVE):** CRUD (name, dose, kind, schedule), schedule parsing, adherence reporting, `medication:logged` event, editorial voice ("noted" not "great job").

**Eksik:** YOK.

**Karar:** dokunma.

---

### 📦 Box 12 — dump (brain-dump router)
**Health: 7/7 LIVE (100%) — ✅ COMPLETE**

**İçinde (LIVE):** DumpModule archive (3-pane), BrainDumpInput, cross-module router (64+ rules), anniversary resurface, right-rail JournalNoticed, local keyword/regex router + Haiku fallback, brain-dump → queue → enrich → label pipeline.

**Eksik:** YOK.

**Karar:** dokunma.

---

## B. CROSS-CUTTING YÜZEYLER (8 kutu)

### 📦 Box 13 — voice
**Health: 4/6 LIVE (67%) — 🟡 NEEDS_WORK**

**İçinde (LIVE):** VoiceScreen transcript review (draft→edit→apply), MicButton floating overlay (hotkey), Web Speech API capture, platform support check (hide-not-lie).

**Eksik (2 STUB):**
- Wake word "Hey Ollie" (push-to-talk only, Porcupine yok ama branding ima ediyor)
- iOS speech plugin (Apple Dev approval var ama plugin yüklü değil)

**Karar:** Porcupine ekle VEYA "Hey Ollie" iddiasını kaldır + iOS plugin yükle.

---

### 📦 Box 14 — settings
**Health: 7/10 LIVE (70%) — 🟡 NEEDS_WORK**

**İçinde (LIVE):** Account section (email, sign-out, delete-account 7-table cascade), notifications budget slider, privacy consent toggles, birth control toggle, tax profile toggle, export/import backup, version + links.

**Eksik (3 STUB):**
- Subscription management (Stripe/IAP) — NOT STARTED
- Voice settings (language, quiet hours) — NOT STARTED
- Language selector — NOT STARTED

**Karar:** alpha'da hangi 3 ihtiyaç? Sırayla bitir.

---

### 📦 Box 15 — garden (3D)
**Health: 6/7 LIVE (86%) — 🟡 NEEDS_WORK**

**İçinde (LIVE):** GardenScene (r3f + drei), Burhan tree (additive only, never decays), asset paths fixed, rain mechanic, elements count, scene fallbacks (SceneFallback + ErrorBoundary).

**Eksik (1 BLOCKED):**
- Asset compression (Draco) — PR #11 merge bekliyor

**Karar:** PR #11'i merge et.

---

### 📦 Box 16 — onboarding
**Health: 3/3 LIVE (100%) — ✅ COMPLETE**

**İçinde (LIVE):** ConsentStep (B2B pivot, necessary locked + research toggle), 8-screen pipeline, research_optin re-prompt gate.

**Eksik:** YOK.

---

### 📦 Box 17 — crisis
**Health: 3/3 LIVE (100%) — ✅ COMPLETE**

**İçinde (LIVE):** CrisisScreen (EN/ES/TR, zero telemetry, zero network, 12-country hotlines), grounding (5-4-3-2-1), boundary surface (single calm exit).

**Eksik:** YOK.

---

### 📦 Box 18 — gallery
**Health: 4/4 LIVE (100%) — ✅ COMPLETE**

**İçinde (LIVE):** GalleryScreen (finished shelf), finished goals section, finished milestones section, empty state.

**Eksik:** YOK.

---

### 📦 Box 19 — insights
**Health: 3/3 LIVE (100%) — ✅ COMPLETE**

**İçinde (LIVE):** InsightsScreen (7-day digest), cross-module summary (hide-not-lie), editorial digest UX (locale-aware).

**Eksik:** YOK.

---

### 📦 Box 20 — dashboard/home
**Health: 8/8 LIVE (100%) — ✅ COMPLETE**

**İçinde (LIVE):** HomeScreen sky video + orb (hour-based), weather pill (offline-tolerant), time tracker, BrainDumpInput, Burhan3D avatar, RetentionWelcomeBar, crisis button, DashboardScreen module grid (4 clusters).

**Eksik:** YOK.

---

## C. SİSTEM FEATURE'LARI (6 kutu)

### 📦 Box 21 — auth
**Health: 6/8 LIVE (75%) — 🟡 NEEDS_WORK**

**İçinde (LIVE):** AuthFlow passphrase (Pattern A, hashed client-side, 26 test), sign-up mode (strength meter + invite gate), sign-in mode (cached email), forgot password explainer, invite validation (beta gate), Clerk auth (web-only ai-proxy).

**Eksik (2 STUB):**
- Apple Sign-In (deferred)
- Biometric/passphrase app-lock (Capacitor ready, no AppLockGate component)

**Karar:** Apple Sign-In alpha sonrası ok. Biometric app-lock şimdi yapılabilir.

---

### 📦 Box 22 — consent + privacy
**Health: 8/9 LIVE (89%) — 🟢 HEALTHY**

**İçinde (LIVE):** `@ollie/consent` canonical state, ConsentScreen (pre-pivot), ConsentStep (B2B pivot), legacy System-A migration, marketing toggle, research opt-in UI, consent sync to Supabase (debounced), telemetry table necessary-gate.

**Eksik (2 STUB):**
- HealthKit consent (blocked on Apple Dev — ama approval var)
- Privacy policy + terms (6 TBD doldurulmamış)

**Karar:** Apple Dev onayı var, HealthKit consent etkinleştir. Privacy/terms Serra TBD'leri doldurmalı.

---

### 📦 Box 23 — research + telemetry
**Health: 7/8 LIVE (88%) — 🟢 HEALTHY**

**İçinde (LIVE):** `@ollie/research-stream` foundation (GDPR endpoints), `@ollie/research-cache` (10 sektör), research_optin gate, AI labeling (Anthropic Haiku, enrich → KV → cron → Haiku → research_corpus), PII scrubber, research consent persistence, telemetry table.

**Eksik (1 BLOCKED):**
- B2B research portal UI (data layer hazır, frontend NOT STARTED)

**Karar:** B2B portal post-beta iş, beta için gereksiz.

---

### 📦 Box 24 — notifications + retention
**Health: 6/6 LIVE (100%) — ✅ COMPLETE**

**İçinde (LIVE):** Day30Prompt card, day-30 event emission (recovered), RetentionWelcomeBar (D1/D7), notification budget (4/day, per-category mute), APNs push token registration, cron notification drain (`*/5 * * * *`).

**Eksik:** YOK.

---

### 📦 Box 25 — AI routing + PII scrub
**Health: ~%100 LIVE (grocery box'ında kapsandı, ayrı layer olarak HEALTHY)**

**İçinde (LIVE):** Routing engine (local first + Claude Haiku fallback), Voyage embedding fast path, Gemini Flash slow path, routing_cache migration, PII scrubber (brand allowlist), module-agnostic `/route/:module` endpoint.

**Eksik:** YOK (Electron/Clerk web-only sorunu Box 29'da).

---

### 📦 Box 26 — encryption + crypto
**Health: KISMI — paket sağlıklı, kullanım eksik**

**İçinde (LIVE):** `@ollie/crypto` AES-GCM-256 + PBKDF2, auth passphrase hashing (client-side), export backup envelope encryption.

**Eksik (1 BLOCKED):**
- Cycle data encryption (Box 4'te de var) — sensitive verisi plain gidiyor
- Genel olarak sync layer'da modül verileri şifrelenmiyor

**Karar:** Cycle data ile başla, sonra diğer sensitive modüller (body episodes, finance).

---

## D. PLATFORMLAR (3 kutu)

### 📦 Box 27 — web shell (PWA)
**Health: presumed HEALTHY**

**İçinde (LIVE):** apps/web Vite + React + Tailwind. Tüm modüller buradan render oluyor. PWA manifest, service worker. v2-shell redesign branch'te ama default web shell çalışıyor.

**Eksik:** v2-shell redesign default değil (Box 5'teki money-v2 ile bağlantılı).

---

### 📦 Box 28 — iOS / Capacitor
**Health: KISMI — temel var, real device blocked**

**İçinde (LIVE):** Capacitor config, HealthKit plugin, APNs token registration, push permission, iPhone responsive layout fixes.

**Eksik:**
- iOS speech plugin (Box 13)
- Real iPhone build testing
- Apple Sign-In (Box 21)
- HealthKit consent finalize (Box 22)

**Karar:** Apple Dev onayı var, real device build flow başlatılabilir.

---

### 📦 Box 29 — desktop / Electron
**Health: KISMI — v2-shell tasarım var, AI auth half**

**İçinde (LIVE):** Electron build pipeline, Tauri scaffold, desktop thin-spine redesign (branch).

**Eksik:**
- Clerk auth convergence (web-only JWT verify, desktop bağlı değil) — KRİTİK
- Tüm AI feature'lar Chrome-only şu an

**Karar:** Clerk path birleştir → grocery/Feed Me/AI routing desktop'ta çalışsın.

---

### 📦 Box 30 — CF workers
**Health: 5/6 LIVE (83%) — 🟢 HEALTHY**

**İçinde (LIVE):** ai-proxy worker (brain-dump + enrich + telemetry + labeling), apns-push worker, sentry-tunnel worker (TR ISP DPI bypass), cron worker (5-min drain), Plaid sync worker (sandbox).

**Eksik (1 STUB):**
- Cron daily intelligence stubs (pattern detect, period predict, subscription detect, body correlations, weekly review) — server-side per-user data access ertelenmiş

**Karar:** Post-beta iş.

---

## ÖZET — Kutu sağlığı

| Renk | Durum | Kutular |
|------|-------|---------|
| ✅ COMPLETE | %100 LIVE | 8, 9, 10, 11, 12, 16, 17, 18, 19, 20, 24 — **11 kutu** |
| 🟢 HEALTHY | %85+ LIVE | 5, 6, 7, 22, 23, 25, 30 — **7 kutu** |
| 🟡 NEEDS_WORK | %60-85 | 2, 3, 4, 13, 14, 15, 21, 26, 27, 28, 29 — **11 kutu** |
| 🔴 BROKEN | <%60 | 1 — **1 kutu** |

**İlk açılacak:** 🔴 **Box 1 (work)** — tek mismatch fix, 16 feature açılır.

**En kritik karar:** Box 4 (cycle encryption + postpartum).

**Hızlı kazanç:** Box 15 (PR #11 merge), Box 7 (4 detector), Box 14 settings (language selector ~1 saat).

**Dokunma:** 11 ✅ kutu zaten tamam.

---

*Generated 2026-05-25 from `OLLIE_FEATURE_AUDIT_2026-05-25.md`. 30 kutu, alan başına. Sıra: kategori → sağlık (kötü → iyi). Her kutuyu tek tek aç, bitir, sonrakine geç.*
