# Astrology Module — Re-Audit (2026-05-14, 30m delta)

> **Note for Serra:** Documents path TCC-sandboxed. File at `audits/AUDIT_astrology.md`. **NEW:** inline astrology orchestrator in `store.ts` (lines 54-115) since previous audit.

**Status: DEFERRED** (2026-05-14 — code preserved in `modules/astrology-deferred/`, not imported in main app)

---

## TL;DR (100 words)

Astrology is 2,195 LOC of fully-styled, functionally-complete natal chart + moon phase reader. **NEW since last audit:** inline orchestrator in `store.ts` (54-115) now reactive-recomputes the birth chart on data change and refreshes transits daily (24h interval). Computation defers via lazy imports until birth data exists, avoiding startup bloat. BUT: still inaccessible (URL gate `?astrology=1` only). Daily horoscopes remain hardcoded (15-line rotation), no Claude integration. Mercury retrograde is schema-only, zero detection. Moon phase never emits events to cycle module. The code WORKS + PERSISTS to store, but is SCAFFOLDED as a shipped feature. Decision point: ship with full consent UI or defer.

---

## 6 Features

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Birth chart setup | WORKING | Orchestrator recomputes on store change |
| 2 | Daily horoscope (Claude-dry) | SCAFFOLDED | 15 hardcoded strings, doy rotation. No Claude `/horoscope` endpoint |
| 3 | Mercury retrograde alerts | NOT STARTED | Event registered, no emitter, no detection algo |
| 4 | Moon phase tracker (cross to cycle) | WORKING (isolated) | currentTransits computes; no event emit, cycle unaware |
| 5 | Opt-in toggle (settings + onboarding) | INACCESSIBLE | URL gate `?astrology=1` only; per-feature consent removed Sprint 6 |
| 6 | LOC count | VERIFIED 2195 | 1452 UI + 352 logic + 291 tests + 62 orchestrator |

---

## 6 Infrastructure

| # | Item | Status | Notes |
|---|---|---|---|
| A | Dark gradient mesh | WORKING | 4 hour-keyed glows, 4000ms fade |
| B | Claude API proxy | NOT STARTED | ai-proxy has braindump/v1/enrich/ingest/label endpoints; NO `/horoscope` |
| C | Banned-phrase scan | PASSING | FORBIDDEN_COPY_SUBSTRINGS list; horoscopes + meanings clean |
| D | Consent gating | SCAFFOLDED | URL gate only |
| E | Event bus (moon → cycle) | NOT STARTED | Schema only; zero emitter |
| F | Inline orchestrator (NEW) | WORKING | Lazy boot, reactive, 24h tick, non-blocking |

---

## NEW: Inline orchestrator (store.ts:54-115)

**What it does:**
- Boots lazily; waits for birth data, then imports astronomy-engine + @ollie/logic/astrology
- Reactive recompute: subscribes to `store.subscribeKey('astrology', 'birth', ...)` → runs `computeNatalChart()` on user edit
- Daily transit refresh: `setInterval(24h)` recomputes `currentTransits()`
- Writes: `astrology.chart`, `astrology.currentTransits`
- Non-blocking (Promise.all + dynamic imports)

**What it doesn't do:**
- Emit events (no transit_change emission)
- Cross-module notify (cycle never learns moon phase changed)
- Error recovery (silently sets chart to null on fail; no retry, no toast)
- Consent check (boots as soon as birth data exists)

**Code quality:** Clean reactive ephemeris math. Production-ready *in isolation*. Useless without module access.

---

## Hypotheses (re-checked)

| Hypothesis | Outcome |
|---|---|
| URL gate only | **CONFIRMED** |
| Banned-phrase clean | **CONFIRMED** |
| LOC 1182 | **REFUTED** (2195 actual) |
| Claude integration wired | **REFUTED** (static array) |
| Birth chart functional | **CONFIRMED + ENHANCED** (orchestrator wired) |
| Moon → cycle bridge | **REFUTED** (no event emit) |
| Orchestrator works | **CONFIRMED** (NEW finding) |

---

## Top 3 next steps

1. **Decide posture:**
   - A) Ship: per-feature consent toggle + dashboard nav item + Claude `/horoscope` endpoint + event emission
   - B) Defer: backlog with code preserved; remove URL gate
   - C) MVP: ship read-only birth chart + hardcoded horoscope; skip Claude/retrograde/toggle
2. If shipping: build `/horoscope` POST in ai-proxy (chart hash + date → Claude with dry-tone prompt, 24h cache)
3. Consent decision: optional-within-necessary sub-toggle OR fully gated?

## BLOCKED-EXTERNAL
None.

*Re-audit by Claude (Opus 4.7), 2026-05-14.*
