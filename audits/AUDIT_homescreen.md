# Home Screen — Re-Audit (2026-05-14)

> **Note for Serra:** Documents path TCC-sandboxed. File at `audits/AUDIT_homescreen.md`. Zero state drift from parallel session; overcast gap from previous audit still open.

**Status:** WIRED-CROSSMODULE + LIVE — one schema gap blocking overcast→sky wiring.

---

## TL;DR (100 words)

Home screen WIRED-CROSSMODULE + LIVE. Zero regressions from parallel session work on goals/work/orchestrator modules. All five sky video conditions verified live; local .mp4 files + Mixkit CDN fallback confirmed. Weather pill (BigDataCloud + Open-Meteo) cached 1h, gracefully hides on API failure. Brain dump wired to `applyRoute()`, navigates to /dashboard /garden /settings. **One unresolved gap (flagged in previous audit):** overcast weather code [2,3,45,48] is NOT mapped to `getSkyVideoSrc(hour, overcast?)` call at HomeScreen.tsx:137 — passes hour alone. Schema issue: `WeatherSummary` interface drops the numeric code, stores only string label. Fixable in 2-4 lines if code is added to interface.

---

## Features

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Sky video (5 variants) | WORKING | All 5 .mp4 present (2.9-10MB); pickSkyKey() correct |
| 2 | Weather + location pill | WIRED-CROSSMODULE | BigDataCloud + Open-Meteo, 1h cache, hidden on fail |
| 3 | Sun orb | WORKING | 3 states (night/dawn-dusk/day) |
| 4 | "What's up?" headline | WORKING | DM Serif Display, fade-in |
| 5 | Mini Burhan corner | WORKING | 220×220 → /garden, keyboard a11y |
| 6 | Brain dump input | WORKING | BrainDumpInputInline → useApplyBrainDump → applyRoute |
| 7 | Time tracker pill | WORKING | work.focus_log append |
| 8 | Dashboard hint pulse | WORKING | aria-hidden decoration |
| 9 | Navigation | WORKING | /dashboard /garden /settings (no direct money/body/work) |

---

## Infrastructure

| # | Item | Status |
|---|---|---|
| A | Mixkit CDN fallback | WORKING (5 IDs: 26108/1610/4119/51102/9680) |
| B | playbackRate 0.25 guard | WORKING |
| C | Open-Meteo API | WORKING (no key) |
| D | BigDataCloud reverse-geocode | WORKING (no key) |
| E | Geolocation perm | WORKING (browser only; Capacitor native deferred) |
| F | Weather cache (localStorage 1h) | WORKING |
| G | WMO code mapping | WORKING |
| H | Imperial vs metric | WORKING (locale-aware) |

---

## Critical gap: overcast → sky video (UNRESOLVED)

**Location:** `HomeScreen.tsx:137`

```js
const sky = getSkyVideoSrc(hour);  // ❌ overcast NOT passed
```

**Should be:**
```js
const overcast = weather && weather.code in [2,3,45,48];  // WMO overcast/fog
const sky = getSkyVideoSrc(hour, overcast);
```

**Root cause:** `WeatherSummary` interface (`weather.ts:17-27`) stores `condition: string` label only, drops `code: number`. Fix:
1. Add `code: number` to interface
2. Preserve code in `weather.ts:171` instead of converting to label
3. Wire `HomeScreen.tsx:137` to pass overcast flag

**Effort:** 2-4 lines.

**Impact:** Cloudy days currently get hour-based sky (e.g. 3pm cloudy → clearDay video). Wrong aesthetic.

---

## State drift

ZERO changes to HomeScreen.tsx / weather.ts / sky video logic since previous audit. Parallel session work (goals/work/orchestrator/store.ts/encryption-boot) doesn't touch home flow.

---

## Top 3 next steps

1. Add `code: number` to WeatherSummary; preserve in getLocalWeather; pass overcast flag in HomeScreen (~4 lines)
2. Test overcast video selection end-to-end on cloudy day
3. Optional: Capacitor native geolocation via `deps.getPosition` for iOS accuracy

## BLOCKED-EXTERNAL
None.

*Re-audit by Claude (Opus 4.7), 2026-05-14.*
