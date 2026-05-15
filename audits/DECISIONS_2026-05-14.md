# Decisions Memo — Auth Posture + Astrology Posture

**Date:** 2026-05-14
**Author:** Claude (Opus 4.7) for Serra Yildirim
**Status:** Recommendations awaiting Serra sign-off

> **Note:** Documents path TCC-sandboxed. File at `audits/DECISIONS_2026-05-14.md` in the repo.

---

## Decision 1 — Auth posture for beta

### Context

Current state (post-2026-05-14 Pattern A fix):
- Email + passphrase auth works end-to-end
- Passphrase never reaches Supabase (PBKDF2 100k + AES-GCM-256 local)
- 26 tests passing including load-bearing assertion tests
- Apple Sign-In: NOT STARTED
- Google Sign-In: NOT STARTED
- Magic link: REJECTED BY DESIGN (Pattern A tradeoff)

### Options

| Option | Effort | App Store impact | Beta UX impact |
|---|---|---|---|
| **A) Passphrase-only (current)** | 0 (already shipped) | None — no social logins → Apple Sign-In not required | Users must remember passphrase; no "sign in with Google" convenience |
| B) Add Apple Sign-In + Google | 2-3 days + Apple dev config | Apple requires Apple Sign-In if other social shown — must implement both | Easier onboarding for users with iCloud/Google accounts |

### Recommendation: **Option A — passphrase-only for beta**

**Rationale:**
1. Already shipped + tested (zero engineering cost)
2. Avoids App Store guideline 4.8 (Apple Sign-In requirement if other social logins added)
3. Aligns with B2B privacy pivot — passphrase auth is the strongest privacy story we can ship
4. Beta users (Serra's friends + first 100) are tech-comfortable enough to manage a passphrase
5. Social logins can be added post-beta if onboarding friction is measurable

**Trade-off acknowledged:**
- Forgotten passphrase = data loss (Pattern A constraint, already disclosed in onboarding)
- New-device sign-in requires backup import (V2 will pull from `profiles` table)
- Conversion funnel may be slower vs social auth (acceptable for closed beta)

### Action items if accepted
- No code changes
- Make sure marketing/privacy.md + onboarding copy emphasize "your passphrase is unrecoverable" clearly
- Plan post-beta retrospective: measure onboarding drop-off; if >25%, prioritize social auth

---

## Decision 2 — Astrology posture for beta

### Context

Current state:
- 2,195 LOC of fully-built, fully-styled astrology module
- Birth chart computation works (computeNatalChart + astronomy-engine, store-persisted)
- NEW (2026-05-14): inline orchestrator in `store.ts:54-115` reactively recomputes on birth change + 24h transit refresh
- Daily horoscope: 15 hardcoded strings, doy rotation (no Claude integration; ai-proxy has no `/horoscope` endpoint)
- Mercury retrograde: schema only, zero detection logic
- Moon phase → cycle: works in isolation, never emits event
- Module is **INACCESSIBLE in production**: gated to `?astrology=1` URL parameter

### Options

| Option | Effort | Quality impact | Risk |
|---|---|---|---|
| A) **Ship full** — onboarding toggle + Claude horoscope + transit alerts + cycle bridge | 1-2 weeks | High value-add for users who want it; risks brand drift (woo-woo vs editorial-luxury) | Brand positioning conflict; new vector for content moderation (Claude horoscope outputs) |
| B) **Defer to backlog** — remove URL gate; module code stays but no user access; revisit post-beta | 0.5 day | Clean launch focus; code preserved for future | Spent dev time stays unrealized; tells the team this isn't shipping |
| C) **MVP ship** — read-only birth chart + hardcoded horoscope only; skip Claude, skip retrograde, skip toggle; surface from a single home-screen entry point | 1-2 days | Test interest with low cost; doesn't damage brand if it stays a "easter egg" | Mixed signal: half-shipped feature feels unfinished |

### Recommendation: **Option B — defer to backlog**

**Rationale:**
1. Astrology doesn't fit the editorial-luxury / lawyer-readable positioning of beta
2. Static 15-line horoscope feels half-baked; shipping it harms quality perception
3. Real shipping requires:
   - Claude `/horoscope` endpoint (1-2 days)
   - Per-feature consent toggle (against B2B pivot's simpler 2-toggle model)
   - Event emission for cycle/moon bridge (1 day)
   - Mercury retrograde detection algorithm (3-5 days)
4. Better to make ONE decision: defer until product calls for it, with code preserved for later activation
5. Removes a "but does it ship?" recurring question from sprint planning

**Trade-off acknowledged:**
- 2,195 LOC sits unused (cost already sunk; preservation is cheap)
- Some users may want it (defer = "not yet" not "never")
- The new inline orchestrator (`store.ts`) does runtime work even though gated — minor perf cost, acceptable

### Action items if accepted
- **Remove URL gate** from `ModuleScreen.tsx:268-276` (no point preserving gate that nobody uses)
- **Disable inline orchestrator** in `store.ts:54-115` — wrap in `if (false)` or feature flag so it doesn't run at boot for production users (saves a small amount of work on every load even before user has birth data, since orchestrator subscribes regardless)
- Move `apps/web/src/modules/astrology/` to a `astrology-deferred/` directory OR add a `BACKLOG.md` note explaining "preserved for future activation; do not import from main app"
- Document decision in `audits/DECISIONS_2026-05-14.md` (this file) for next sprint planning
- Update `audits/AUDIT_astrology.md` status: INACCESSIBLE → DEFERRED

---

## Sign-off

| Decision | Recommendation | Status |
|---|---|---|
| Auth posture | Passphrase-only | ⏳ Awaiting Serra sign-off |
| Astrology posture | Defer to backlog | ⏳ Awaiting Serra sign-off |

If Serra agrees, no further engineering work needed for #1 (already shipped). Engineering work for #2 is small (gate removal + orchestrator disable + directory rename, ~1 hour) — can be done immediately upon sign-off.

*Memo by Claude (Opus 4.7), 2026-05-14.*
