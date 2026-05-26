# Architectural Decisions — needs-input log

Single rolling doc capturing v2 architectural questions that need a Serra
decision before they can ship. Open items at the top; resolved decisions
move to the historical section with a short rationale.

---

## 🔴 OPEN

_(none — clear queue)_

---

## ✅ RESOLVED

### `2026-05-26` · movement events: body vs. habits

**Question:** When a user dumps "went on a 20 min walk", does the router
send it to `body` (somatic event, with duration) or `habits` (the daily
move-your-body completion)?

**Resolution:** **Both — context-aware.**

- **Primary route:** `body.log_movement` — captures the somatic event
  (`type: "walk"`, `duration_min: 20`). This always fires.
- **Conditional secondary route:** `habits.complete` — fires in parallel
  only when the user has a habit registered whose `habitName` matches
  the movement type (e.g. a registered "walk" or "exercise" habit).
- The router itself emits ONE primary fragment (`body.log_movement`).
  The body module's `apply()` handler checks the habit registry and
  fires `habits.complete` as a downstream side-effect.

**Why this shape, not multi-fragment from the router:**
- The router must not require knowledge of per-user state (habit registry).
  Keeping that downstream preserves the router's purity.
- Multi-routing as a server-side concern would couple the router to
  Supabase reads (current router is pure stateless aside from Vectorize).

**Where to find it in code:**
- Schema: `apps/native/src/router/schema.ts > BodyAction.log_movement`
- Worker classify prompt: `workers/ai-proxy/src/router/dump-classify.ts`
  (action vocabulary + disambiguation hints)
- Body handler (downstream multi-route trigger): TBD when the body
  module's `apply()` is implemented (task #20 — handler stubs).
- Test case: `T42_body_walk` in `workers/ai-proxy/tests/golden/OLLIE_AI_ROUTER_TESTS.md`

### `2026-05-26` · schema additions — 5 actions

Five actions added to v2 schema per Serra's cofounder brief
(`2026-05-26`), un-collapsing mappings that the initial migration had
folded together:

| module    | action            | distinguishes from                  |
|-----------|-------------------|-------------------------------------|
| grocery   | `pantry_low_flag` | `shopping_list_add` (active need)   |
| pets      | `log_supplement`  | generic `log_care` (typed + dose)   |
| sleep     | `log_insomnia`    | `log_sleep` with `quality=1`        |
| admin     | `log_renewal`     | `recurring_decision` (paperwork ≠ subscriptions) |
| body      | `log_movement`    | `habits.complete` (somatic vs. habit) |

See § ✅ RESOLVED above for the body↔habits multi-route specifically.
