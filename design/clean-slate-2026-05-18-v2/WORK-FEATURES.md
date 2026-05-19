# WORK CLUSTER — FEATURE INVENTORY

Scope: the Ollie "work" cluster, 2 submodules — **work** and **goals**.
Source of truth: `apps/web/src/modules/{work,goals}`, `packages/logic/src/{work,goals}`,
`packages/orchestrator/src/{work,goals}.ts`. Behavior only — no design.
Compiled 2026-05-18.

A note on architecture: logic packages are pure detectors; orchestrators run
them on store-key changes and write `*.patterns` + fire notification cues; the
UI reads `*.patterns` and renders, plus runs a few detectors inline itself.

---

## SUBMODULE 1 — WORK

The day-of execution surface: focus timer, task list, meetings, deep-work
blocks, distraction journal, hand-off notes. Page sub-title: "what's on. sit
with one for N min at a time."

### 1. Actions — what the user can DO

- Add a task (free text, sanitized) to the work list.
- Toggle a task done / open (checkbox; stamps `done_at`).
- Delete a task.
- Filter task list by open / done / all.
- Pick focus-session duration: 15 / 25 / 45 / 90 min (locked while timer runs).
- Start a focus timer (publishes an `active_focus` marker for notification suppression).
- Stop a focus timer early (partial session ≥60s still logged).
- Reset the timer after a session completes.
- Attach a project to the current focus session (project picker dropdown).
- Create a new project / client inline (name + auto-generated color slot).
- Toggle brown-noise audio overlay on/off for the focus session.
- Add a meeting (title, datetime, duration 5–480 min, optional comma-separated attendees).
- Remove a meeting.
- Schedule a future deep-work block (optional title, datetime, duration 15/25/45/90, optional project; past times rejected).
- Cancel a scheduled deep-work block (soft-cancel; cues skip it).
- Log a distraction ("what pulled you away?" — free text, Enter to log).
- Remove a distraction entry.
- Add a hand-off / collaboration note (body text + optional "for" recipient name).
- Remove a hand-off note.
- Dismiss a noticed work pattern (per-pattern, persisted).

### 2. Info / data — what the submodule holds and can show

- Task list with open/done state; live open-count and done-count.
- Today's completed focus-session count.
- Active project name for the running session.
- Live timer display (idle / counting-down / "done.").
- Selected focus duration.
- Focus log: per-session `ts`, planned `duration_min`, actual `duration_ms`, optional project/task link.
- Pomodoro cycle state: blocks done today, position in the 4-block cycle, blocks until a long break, whether a long break is earned now.
- Week-to-date billable rollup per project (minutes → h/m label, total).
- Project list (active vs soft-archived).
- This-week meetings (next 7 days), sorted, with when / duration / attendees; each shows "ping 30m prior".
- Upcoming scheduled deep-work blocks (future, not cancelled), each "ping 1h prior".
- Distraction journal — recent entries (newest first, capped 30) + a plain "N today" tally.
- Hand-off notes list (text, timestamp, optional recipient).
- "Noticed" panel: all computed work patterns with copy, prompt, suggestion, meta chips, citation link.
- Cross-module read: `body.sleep_sounds` (brown-noise default), `sleep.records` (last night's hours, feeds shutdown-gap).

### 3. Patterns / detections — what the app COMPUTES on its own

Logic IDs W0–W17. `detectPatterns()` runs all; W17 triage short-circuits W1–W14.

- **deep-focus-hours (W0a)** — your longest focus sessions cluster around a specific 2-hour block of the day.
- **pacing-breach (W0b)** — a single session ran past your safe pacing zone (8h+); the body files the bill 24–72h later.
- **task-switch-tax (W1)** — you switched tasks N times across M sessions; that tiredness has a name (switch cost).
- **meeting-cliff (W2)** — N back-to-back meetings today; plan recovery, not productivity, after.
- **deadline-cues (W4)** — for each deadline, event-anchored cues at -7 / -2 / -1 days with a concrete next action per stage.
- **shutdown-gap (W12)** — you haven't done a shutdown ritual in 3+ days; open loops cost more than the work (escalates if sleep < 6h).
- **triage-day-anchor (W17)** — today is a get-through day, not a work day; here is the one thing that matters.
- **activation-barrier (W5)** — a task has sat 48h+ untouched with no first micro-step; what is the first 30-second move?
- **estimation-drift (W6)** — your estimates run ~xN short across recent tasks; a knowable number, more useful than guilt.
- **post-meeting-buffer (W9)** — three buffer accepts/declines in a row → auto-flips the buffer default on/off.
- **one-more-thing-spiral (W11)** — this is the Nth "one more thing" this session; naming the pattern, not stopping you.
- **hyperfocus-crash-prompt (W3)** — yesterday's 3h+ session: has the body filed the bill yet? (yes / not yet / no crash / not sure).
- **hyperfocus-crash-pattern (W3)** — across logged crash replies, 3h+ sessions led to a crash N of M times.
- **tab-sprawl (W7)** — your tab count averages 15+; past ~7, tabs stop being memory and become anxiety.
- **notification-tax (W8)** — N self-checks across the window; each costs ~a minute to land back.
- **recurring-meeting-dead (W10)** — a recurring meeting is flagged dead; includes a ready cancel-message draft.
- **multitask-illusion (W13)** — completion in "two-at-once" sessions vs solo sessions; the felt sense is real, so is the cost.
- **rsd-anchor-prompt (W14)** — a task title looks like feedback/review; offer to open it inside Ollie, not the inbox.
- **rsd-anchor-mirror (W14)** — across N feedback opens, a tally of how they landed (fine / sting / shame-spike / mixed).
- **hyperfocus_detected (orchestrator)** — a single sustained focus-log session ≥3h in the last 24h; emits an event routed to the body fatigue surface.

#### Notification cues (orchestrator `scanCues`)

- **meeting_30m** — a meeting starts in ~30 min: "take a breath."
- **upcoming_block** — a scheduled block starts in ≤20 min: "focus block in 15 min. or skip."
- **deep_work_tomorrow** — a scheduled block 20–90 min out: "deep work today/tomorrow Nam. heads up."
- **session_90_warn** — a running 90-min session, 5 min before the mark: "wind down what you're on."
- **session_end** — a focus session just ended: "25 min done. 5 min stretch."
- **four_blocks_today** — 4+ focus blocks logged today: "body says rest."

---

## SUBMODULE 2 — GOALS

The big-picture surface: goals with why/obstacle/premortem, milestones, AI step
breakdown, progress, reviews, sessions, achievement gallery. Page sub-title:
"the big picture. keep it short. don't lie."

### 1. Actions — what the user can DO

- Create a goal — fields: title (what), why (one sentence), target date (optional), obstacle, premortem, Ulysses contract, role/identity, pacing (sprint/marathon/rolling), category (1 of 6).
- Cancel / clear the goal draft.
- Filter goals by active / done / dropped / graveyard / all.
- Filter goals by category (career / relationship / health / finance / learning / creative / all).
- Set goal status → done, dropped, or re-activate.
- Delete a goal (guarded — see low-mood lock + Ulysses contract below).
- Park a goal until a date instead of deleting (sets status `paused`).
- Move an existing goal to graveyard when the 5-active cap is hit, to make room for a new one.
- Tag a goal work-session as **thinking** or **doing**.
- Open a goal review and tag it "still want" or "already invested".
- Add a milestone to a goal (title + optional target date).
- Toggle a milestone done/open (auto-recomputes goal progress %).
- Remove a milestone (recomputes progress).
- Set goal progress manually via a 0–100 slider (when no milestones exist).
- Start progress tracking via a "+ track progress" affordance.
- Ask Claude to break a goal into 3–7 concrete steps (Cloudflare AI worker; "ask again" to regenerate).
- Toggle an AI step done/open (completion keyed by step text).
- Convert a goal into a habit — pick cadence (daily / weekly / weekdays / custom); dispatches a cross-module event to the habits module.
- Dismiss a noticed goal pattern (per-pattern, persisted).
- Dismiss the low-mood banner.

### 2. Info / data — what the submodule holds and can show

- Goal list with title, why, status, category, target date, days-until / days-ago.
- Counts per status bucket: active, done, dropped, graveyard.
- Per-goal progress bar (manual % or auto from milestone completion).
- Milestone list per goal — title, target date, done state.
- AI step list per goal — ordered steps with completion checkboxes.
- Pacing classification per goal (sprint / marathon / rolling) + dormancy threshold, shown on create + in card.
- Goal sessions log (thinking vs doing, timestamped, goal-linked).
- Goal reviews log ("want" vs "invested", timestamped).
- Ulysses contract text (surfaced on delete/pause attempts).
- Stored goal context: obstacle, premortem, role, why-chain, anti-goal, hypothesis, anchor type, construal levels, interference tags, incubation deadline.
- Achievement gallery — finished goals only, most-recent-first, with finish date + category ("N goals carried all the way through").
- "Noticed" panel: computed goal patterns with copy, source excerpt, meta chips, citation link.
- Low-mood banner (active during a 72h delete-lock window).
- Cross-module: merges braindump `shared.actionLog` entries into the dump stream feeding contagion/obstacle/premortem detectors.

### 3. Patterns / detections — what the app COMPUTES on its own

Logic IDs G1–G16 + velocity. Orchestrator runs all and writes `goals.patterns`;
GoalsModule also runs several inline (research, drift, sunk-cost, low-mood, echoes, pacing).

- **low-mood (G4)** — 3+ low-mood markers in 7d (or 2 in 48h) in dumps → 72h "don't delete anything" lock.
- **obstacle-echo (G6)** — language from a goal's predicted obstacle reappears in recent dumps: "this was the obstacle you predicted."
- **premortem-echo (G7)** — a goal's premortem reasoning reappears in dumps 30d+ after creation: "your past self predicted this exact reason."
- **ulysses-present (G15)** — on delete/pause, surfaces the user's own future-self contract note.
- **active-cap (G2)** — more than 5 active goals: cognitive load is real; pick one for the graveyard.
- **research-as-progress (G5)** — 5+ contiguous "thinking" sessions and zero "doing" on a goal: what's the smallest doing step?
- **identity-drift (G11)** — a goal's role hasn't been touched in 30d: "role changed, or season?"
- **sunk-cost (G13)** — last 3 reviews of a goal all "already invested" (not "still want"): graveyard?
- **pacing-classified (G14)** — classifies a goal sprint/marathon/rolling from its timeline and gives a staleness threshold.
- **pacing-breach (G14)** — a goal has had no "doing" past its pacing-dependent dormancy threshold (sprint 7d / rolling 14d / marathon 30d).
- **contagion (G1)** — recent dumps contain external-trigger language: "this goal came from outside — sit with it 7 days."
- **missing-anchor-pair (G3)** — an identity goal lacks a concrete behavior, or a metric goal lacks a "who am I becoming" anchor.
- **floating-goal (G8)** — a why-chain is too shallow (<3), dead-ends on "idk"/"just because", or runs in circles.
- **missing-construal (G9)** — a goal lacks one of its two construal levels (abstract meaning / concrete micro-behavior).
- **anti-goal-opportunity (G10)** — a stuck goal (14d+ no doing): mirror its anti-goal, or ask "what do you NOT want to become here?"
- **anti-goal-in-dump (G10)** — recent dumps name something the user wants to avoid: "save it as an anti-goal?"
- **goal-interference (G12)** — two active goals carry opposing resource tags (spend/save, night/morning…): are they cancelling out?
- **experiment-candidate (G16)** — a goal quiet 4+ weeks gets reframed: "what if it's a hypothesis, not a promise — what are you testing?"
- **velocity-pattern** — per-category completion velocity over 90d: which category do you actually finish, and how fast.
- **construal-frame (G9 helper)** — picks the abstract frame on low-EF days, concrete frame on high-EF days (zoom out vs today's step).

#### Notification cues (orchestrator `scanCues`)

- **weekly_check_in** — Sundays, when an active goal was last reviewed >7 days ago: "goal check-in. it's been 7 days."
- **deadline_30d** — an active goal's target date is ~30 days out: surfaces title + current progress %.
- **paused_14d** — a goal paused 14+ days ago: "still relevant?"
- **velocity_gap** — top category finishes ≥2x faster than bottom category: "X goals finish Nx faster than Y. flagging."

---

## CROSS-SUBMODULE PATTERNS

- **Shared "Noticed" architecture** — both submodules: pure detectors → orchestrator writes `*.patterns` → UI renders dismissible cards with copy + citation. Goals additionally re-runs detectors inline in the component.
- **Anti-shame / non-verdict framing is universal** — every pattern copy explicitly says "pattern, not cause" / "mirror, not a verdict" / "information, not a verdict." No streaks, no guilt; pomodoro and achievement gallery are deliberately un-amplified.
- **Body-bill / pacing thread runs through both** — work's pacing-breach + hyperfocus-crash and goals' pacing-breach + experiment-candidate all model the same idea: sustained push has a delayed cost. Work emits `hyperfocus_detected` straight into the body module's fatigue surface.
- **The braindump stream feeds both** — `void:braindump:submitted` events and `shared.actionLog` recompute both orchestrators; goals' contagion/obstacle/premortem detectors literally scan dump text for echoes of the user's own words.
- **Consent-gated detection** — both clusters gate all non-legacy detectors on `opts.consent` (default-on); work's W0 legacy detectors run pre-consent.
- **Cross-module dispatch out** — goals → habits (`goals:convert_to_habit`); work → body (`work:hyperfocus_detected`); deadline-cues borrows habit external cues for event-anchoring.
- **"Thinking vs doing" is the goals analog of work's focus session** — goals measures intent vs execution via session type; work measures it via completed focus blocks. Both surface the gap (research-as-progress ↔ activation-barrier).
- **Citations everywhere** — every pattern in both submodules carries a primary-source academic citation (Monsell, Steel, Gollwitzer, Barkley, Microsoft HFL, etc.).
