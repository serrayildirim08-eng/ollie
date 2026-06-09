# Ollie feature audit — behavior vs brief (2026-05-31)

Verification of the cofounder brief (2026-05-25, "352 LIVE / 59 STUB / 12 BLOCKED, 83%")
against the actual code on `rewrite/native-foundation`. This is the brief's own
"Week 1 — dogfood verification: convert code measurement into behavior measurement."
7 parallel per-module code+wiring audits. Verdict key: **LIVE** = exists AND wired
end-to-end on the shipping native app · **STUB** = code exists but not wired (dead/starved)
· **MISSING** = no code.

---

## THE ONE FINDING (explains ~everything)

The native Tauri app — the shipping surface — was rebuilt on **SQLite** (`*_events` tables).
Every module's *capture* writes to SQLite, and every Box screen reads SQLite. That half works.

But **every Layer-2 "AI watcher", every cross-module bridge, and all ~120 pattern detectors**
live in `packages/orchestrator` + `packages/logic` and read the **old `@ollie/store`** keys
(`work.focus_log`, `cycle.items`, `body.water_log`, `dump.items`, `shared.actionLog`, …).
**Nothing in `apps/native` writes those keys.** The orchestrators are even instantiated and
`init()`-ed (`apps/native/src/store.ts:112-116`) — they just run on permanently-empty inputs.
And no native Box ever *reads* the computed `<module>.patterns` output, so even if a detector
fired, nothing would surface.

Net: **"Dump → Sort" works. "Notice" (the actual differentiator) is dark on the shipping app.**
The 120+ detectors are real, tested, sophisticated code — severed from live data by one
architectural split, then not rendered. This is **wiring, not invention** (exactly what the
brief predicted for the remaining work — it just under-counted how much is on the wrong side
of the wire).

The single highest-leverage fix: **bridge SQLite → the store keys the orchestrators read (or
port the watchers to read SQLite directly), then render `<module>.patterns` in the Boxes.**
That one bridge revives the majority of STUBs below at once.

Two brief claims are also factually wrong (worth fixing in the cofounder brief):
- "Voice transcript — Ollie transcribes **on-device**" → actually a **cloud** call (`/transcribe`, Groq Whisper). `MicButton.tsx`.
- Layer-1 "local matcher ~90% + **Claude Haiku** fallback" → actually **Voyage embedding cache + Groq Llama 3.3 → Cloudflare AI → Gemini → OpenRouter**. No Claude/Anthropic anywhere in the router. (PII-scrub-before-cloud IS real.)

---

## What genuinely WORKS today (capture / sort layer)

- **Grocery — strongest module.** Shopping list (EN/ES/TR), pantry check-off→dated, smart
  routing ("scratch the eggs"/"got milk"/"finished bread"), Feed Me core (AI recipes from
  pantry, diet chips, "cooked it" + adaptive learning). LIVE end-to-end.
- **Goals capture — 6/6 LIVE.** Rich create modal (what/why/target/obstacle/premortem/Ulysses),
  active-cap-5 refusal, Ulysses shown on delete. Dump goal-intent opens the modal prefilled.
- **Dump core.** Raw-text capture any language, PII-scrub before any cloud call, routing to the
  right module. (This is what "milk → grocery", "dad pickup → admin to-do", "call mama →
  reminder", "sign a contract → admin" all exercise — and they work.)
- **Reminders** (shipped this week): client + OS-local-notification + server path; fires app-closed.
- Basic capture+persist+Box-display for: sleep (bedtime/wake), body (water, supplements),
  cycle (period/symptoms), habits (name + dedup check-off), work (focus sessions, distractions),
  admin (tasks, phone tasks), money (transactions), pets (care log), medication (dose log).

---

## What's DARK (built but not wired on native)

### Every Layer-2 watcher, every module
All starved by the SQLite↔store split. Representative (full code exists + tested):

- **Sleep AI** (4): bedtime drift, revenge-bedtime, caffeine×onset, weekday/weekend gap — STUB (read `sleep.records`, never written).
- **Body AI** (4): hydration drift, hyperfocus dehydration, hunger↔thirst, episode patterns — STUB. (Citations genuinely attached — good.)
- **Cycle AI**: 4-layer Bayesian prediction, clinician-aware health flags, symptom-phase clustering — fully coded + tested, but `createCycleOrchestrator` is **never instantiated in apps/native**. STUB.
- **Work AI** (the brief's "14 detectors silenced"): root cause = `work.ts:110` comment claims "UI writes `work.focus_log`" — **false**; FocusTimer writes SQLite. All ~14 detectors STUB.
- **Admin AI**: Phase-1/2 (A1–A12) wired-but-starved; **Phase-3 (A7/A11/A13/A14/A15) coded but never called** in `admin.ts:152` (the brief's "Phase 3 not wired" — confirmed).
- **Money AI** (6): doom-buying, hyperfocus burst, duplicate, sub-cancel-avoidance, cycle×spend, return-abandonment — orphaned.
- **Habits AI** (4), **Medication AI** (3), **Pets AI** (5), **Dump AI** nightly resurfacers (3) + search — all STUB.

### Cross-module bridges (the "compound insight" the brief calls "the product")
~20 bridges checked: ~9 compute-live (read real cross-module data, persist) **but render nowhere on native**; ~8 STUB; 1 MISSING (work×body `reduce_motion_today` — the shared-state mechanism the brief describes does not exist). Pattern-taxonomy infra is real (151 `detect*` functions → "120+" is true as code; 3 universal rules wired; 5 categories present). But the compound insight **reaches the user in ~0 cases on native** because no Box renders pattern cards and the push subscriber (`initPatternDetectedSubscriber`) isn't mounted.

### MISSING (need building/schema, not just wiring)
- **HealthKit** (sleep + body vitals) — no code at all.
- **Postpartum** mode (cycle) — no code (brief flagged; confirmed).
- **Bleeding-intensity 9 tags** (cycle) — no field; symptoms are free-text only.
- **Medication schedule/kind** — native schema is name+free-text-dose; structurally can't feed "remaining doses"/adherence. Archive/"stopped on" missing.
- **Sleep feel-tags** (rested/wired/foggy/wrecked) — only numeric 1-5 quality.
- **Age-based water target** — hardcoded 8 glasses.
- **Money**: tap-to-log + category field, return-abandonment detector.
- **Work**: scheduled deep-work blocks, hand-off notes; brown-noise asset missing.
- **Goals low-mood delete lock** — coded but **inert**: `recordMoodSignal` has zero callers, so `goals_mood_log` is always empty, lock always fails open.
- **Streak code still present** in habits (`computeStreak`, `streak_break` event + routable action) — dead/unsurfaced, but contradicts the "no streaks, ever" mandate; should be ripped out.

### Security note
- **Cycle data bypasses encryption**: `cycleRepo` writes plaintext to SQLite `cycle_events`; encrypted KV exists (`storage/encrypted.ts`) but the cycle table doesn't route through it. The brief's "even our engineers can't open it" is not yet true for the SQLite path.

---

## Honest "where we are" vs the brief's 83%

The brief's 352/423-LIVE measured **code exists + wired into the orchestrator**. True. But the
orchestrator is fed nothing on the shipping app, so the **behavior** number splits hard:

- **"Dump → Sort" (capture + routing + Box display):** largely real. ✅
- **"Notice" (every watcher, every bridge, every pattern card):** built, tested — **dark on device.**

The brief said the remaining work is "wiring, not invention." That's correct and encouraging —
but it's a **bigger, more load-bearing wire** than 59 STUBs suggests: it's one architectural
bridge that, once built, lights up the whole second half of the product at once.

---

## Highest-leverage next moves (in order)
1. **The great rewiring** — bridge native SQLite capture → the store keys watchers read (or port watchers to SQLite), on module boot + after each write. Revives ~50+ detectors across all modules.
2. **Render pattern cards** — make each Box read `<module>.patterns` / `shared.patterns` and show the soft-note cards. Mount `initPatternDetectedSubscriber`.
3. **Wire the mood signal** — `recordMoodSignal` from the dump flow → activates the low-mood delete lock + doom-buying + several cross-module bridges.
4. **Fix the 3 confirmed-correct brief flags** — work `focus_log` comment/write, admin Phase-3 call sites, cycle orchestrator instantiation.
5. **Build the true-MISSING set** as scoped features — HealthKit, postpartum, med schedule, bleeding-intensity, cycle encryption — these are invention, not wiring.
6. Rip out residual streak code; correct the brief's on-device/Claude-Haiku claims.
