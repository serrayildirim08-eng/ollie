# Crisis Layer — Re-Audit (2026-05-14, post-i18n sprint)

> **Note for Serra:** Documents path TCC-sandboxed. This file lives at `audits/AUDIT_crisis.md`. Reflects state POST Spanish (ES) localization sprint. Parallel session added `strings.es.json` with 213 ES crisis keys.

**Status:** WORKING + SHIPPED (not scaffolded)

---

## Status definitions

- **NOT STARTED** — no code exists
- **SCAFFOLDED** — exists but doesn't function end-to-end
- **WORKING** — functions in isolation
- **WIRED-CROSSMODULE** — connected to brain dump + UI + i18n

---

## TL;DR (100 words)

**Crisis layer WORKING + SHIPPED; no functional regressions post-i18n sprint.** Keyword detection EN + TR (23 regex tests + 6 country routing tests = 29 total). All 12 countries + INTL have hardcoded hotlines in both English AND Spanish strings. Spanish crisis openers now localized ("esto se ve duro. no estás solo."); hotline numbers match across locales. Zero network calls, zero telemetry — purely local regex + toast. Free-tier accessible. **Gap unchanged: Turkish i18n strings (`strings.tr.json`) still MISSING** — Turkish keyword detection works, hotline 182 correct, UI framing English-only. ES keyword detection (Spanish phrases like "quiero morir") not added at regex layer yet.

---

## Features

| # | Feature | Status | File | Notes |
|---|---------|--------|------|-------|
| 1 | EN keyword detection | WIRED-CROSSMODULE | `packages/logic/src/crisis/regex.ts` | ASCII_CRISIS_RE: 14 EN phrases. Word-boundary anchored. |
| 2 | TR keyword detection | WIRED-CROSSMODULE | `packages/logic/src/crisis/regex.ts` | ASCII branch + Unicode branch (öldürmek istiyorum via lookbehind). |
| 3 | ES keyword detection | NOT STARTED | — | Only EN + TR at regex layer. |
| 4 | 12-country hotline routing | WIRED-CROSSMODULE | `apps/web/src/hooks/useApplyBrainDump.ts:37-49` + i18n | TR, US, GB, CA, AU, DE, FR, NL, IT, ES, SE + INTL. Locale-aware (EN, ES). |
| 5 | Always local, no network | WORKING | crisis/, useApplyBrainDump.ts | Zero `fetch`/Sentry/PostHog in crisis files. |
| 6 | Routes from brain dump | WIRED-CROSSMODULE | `useApplyBrainDump.ts:65-77` | detectCrisis() early-return. |
| 7 | UI surfacing (toast) | WORKING | useApplyBrainDump.ts:72-75 | 30s TTL, locale-aware (EN/ES), non-modal. |
| 8 | Free-tier accessibility | WORKING | — | No consent gate, no tier check. |

---

## 12-country hotline dual-locale verification

| Country | EN | ES |
|---|---|---|
| TR | 182 mental health line | 182 línea de salud mental |
| US | 988 suicide & crisis lifeline | 988 suicide & crisis lifeline |
| GB | samaritans · 116 123 | samaritans · 116 123 |
| CA | talk suicide canada · 988 | talk suicide canada · 988 |
| AU | lifeline · 13 11 14 | lifeline · 13 11 14 |
| DE | telefonseelsorge · 0800 111 0 111 | telefonseelsorge · 0800 111 0 111 |
| FR | numéro national · 3114 | numéro national · 3114 |
| NL | 113 zelfmoordpreventie · 0800 0113 | 113 zelfmoordpreventie · 0800 0113 |
| IT | telefono amico · 800 86 00 22 | telefono amico · 800 86 00 22 |
| ES | línea de atención · 024 | 024 línea de atención a la conducta suicida |
| SE | mind självmordslinjen · 90 101 | mind självmordslinjen · 90 101 |
| INTL | global directory · findahelpline.com | directorio global · findahelpline.com |

Bonus ES-only: `hotline_MX: "800 290 0024 saptel"` (not routed; Mexico future work).

Crisis openers:
- EN: `"this looks rough. you're not alone."`
- ES: `"esto se ve duro. no estás solo."`

Close:
- EN: `"the dump is here when you're ready."`
- ES: `"el volcado está aquí cuando estés listo."`

---

## State delta since previous audit

| Item | Before | After | Change |
|---|---|---|---|
| strings.es.json | Missing | ✓ Added (212 keys) | **COMMITTED** (4bf72e4) |
| strings.tr.json | Missing | ✗ Still missing | No change |
| crisis.hotline_* keys (ES) | — | 12 + INTL | **NEW** |
| Regex (EN + TR) | ✓ | ✓ Unchanged | — |
| Regex (ES) | — | Not started | No change |
| Test count | 29 | 29 | No change |
| Telemetry/network | Zero | Zero | No change |

---

## Hypotheses

| Hypothesis | Outcome |
|-----------|---------|
| ES localization broke crisis layer | **REFUTED** (no regex/routing touches) |
| strings.tr.json now exists | **REFUTED** (still missing) |
| Telemetry leakage in ES strings | **REFUTED** |
| Country routing works for ES users | **CONFIRMED** |
| Free-tier remains accessible post-sprint | **CONFIRMED** |

---

## Top 3 next steps

1. Create `strings.tr.json` with crisis openers + 12 hotline translations + app strings (1–2 days, ~600 keys)
2. Extend regex to ES with `ES_CRISIS_RE` (8–12 Spanish phrases, ~40 LOC + 12 tests)
3. Hardness test: confirm offline behavior end-to-end (flight-mode)

## BLOCKED-EXTERNAL
None.

*Re-audit by Claude (Opus 4.7), 2026-05-14, post-i18n sprint.*
