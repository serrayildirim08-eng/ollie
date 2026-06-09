# Voice-library scanner · port complete

**Status:** restored and wired into CI. Any PR with banned phrases now fails the build.

---

## What landed

### `tools/banned-phrases.cjs`
Consolidates two legacy modules into one:
- `design-pitches/handoff/banned-phrases.js` (voice-library global + scoped bans)
- `tools/notification_scope_tests.js` (notification-context bans)

Exports `GLOBAL_BANS`, `SCOPED_BANS`, `scanForBanned(text, scope)`.

**Global bans** (fire everywhere user-facing copy lives):
cheerleading (`great job`, `awesome`, `crushing it`, `rockstar`, `good work`, `got this`)
· streak language (`streak`, `streak broken`, `don't break`, `N days in a row`, `keep streak`, `missed yesterday`)
· engagement pushes (`we miss you`, `come back`, `haven't X`, `N days since`, `where have you been`, `your friend`, `check in with`)
· burhan as push character (`burhan is sad/thirsty/lonely/dying/hungry`, `burhan needs/wants/misses you`)
· urgency theater (`limited time`, `today only`, `last chance`)
· hallmark crisis copy (`you matter to us`, `please reach out`)

**Scoped bans** (only fire in their scope):
- `push` — `!` in templates, 🎉 emoji, `great job today/tracking/logging`
- `confirmation` — celebration emoji
- `cycle` — `fertile day`, `chance of pregnancy`, `you have PMDD/PCOS`
- `bodyPantry` — `calorie/calories`, `BMI`, `weight loss`
- `pets` — `tontin/pinpon/your pet is sad/lonely/misses`, `you forgot`
- `habits` — `streak | chain | broke | broken` (extra strict — habits is the Volkow canary)

### `tools/scan-banned-phrases.cjs`
The CI runner. Walks `apps/`, `packages/`, scans:
1. **i18n JSON files** — every leaf string, scope inferred from keypath. `help.*` / `onboarding.*` / `legal.*` skip scoped bans (those branches describe rules — they need to say "calorie" to explain the rule).
2. **TS/TSX/JS string literals** — single-quote, double-quote, and template literals, with comments stripped. Global bans always fire.
3. **Notification-context windows** — lines within 30 of a marker like `NUDGE_TEMPLATES`, `pushTemplates`, `emit('void:reminder:scheduled')`, etc. get the extra `push`-scope bans.

Exit 0 = clean, exit 1 = violation. Verbose report on failure.

### `tools/banned-phrases.test.cjs`
18 `node:test` unit tests covering every ban category + invariants. Runs without dependencies (uses Node's built-in test runner).

### CI wiring
- `package.json` adds:
  - `scan:banned` — run the scanner standalone
  - `scan:banned:test` — run the scanner's own unit tests
  - `pretest` — runs both, so `pnpm test` fails immediately on a banned phrase before any vitest suite kicks off
- `.github/workflows/ci.yml` adds two jobs:
  - `voice-library-guard` — runs the scanner and its tests on every push + PR (no install, no deps — fast)
  - `build` — typecheck + test (which now includes the pretest scan)

### Allowlist
Inline `// notif-scope-allow` on the offending line OR up to 3 lines above.
Used for LLM system prompts and answer-engine factual replies — the two
legitimate cases identified in legacy void over 18 months.

Currently allowlisted:
- `packages/api/src/anthropic.ts:23` — `ROUTER_SYSTEM_PROMPT` LLM system prompt
- `packages/logic/src/prompts/index.ts:72` — `sleep-gap` in-app dump suggestion

---

## Verification

```
$ node tools/banned-phrases.test.cjs
ℹ tests 18 · pass 18 · fail 0

$ node tools/scan-banned-phrases.cjs
banned-phrase scanner: clean across 214 files.

$ pnpm test
[pretest hook] → 18/18 scanner tests pass
[pretest hook] → scanner clean across 214 files
… vitest suites run, 971 tests pass
```

Canary verification (a deliberate `great job today` string in
`packages/logic/src/_banned-canary.ts`):
```
✗ BANNED PHRASE VIOLATIONS — voice-library / notification-scope guard
  packages/logic/src/_banned-canary.ts:1  [global/great-job]
    why:  cheerleading copy · principle viii
1 violation across 1 file.
ELIFECYCLE Command failed with exit code 1.
```

Build correctly fails on banned phrase, passes once removed.

---

## To extend

To ban a new phrase:
1. Add an entry to `GLOBAL_BANS` (or `SCOPED_BANS.<scope>`) in `tools/banned-phrases.cjs`.
2. Add a unit test in `tools/banned-phrases.test.cjs`.
3. Run `pnpm scan:banned` — fix any new hits or allowlist them.
4. Log a decision-log entry in `design-pitches/decision-log.html` referencing the principle.

To extend the notification-context detector, edit the `CTX_OPEN` regex
in `tools/scan-banned-phrases.cjs`.

---

## What was lost in the legacy split (now restored)

| Legacy file | New home |
|---|---|
| `design-pitches/handoff/banned-phrases.js` | `tools/banned-phrases.cjs` |
| `tools/notification_scope_tests.js` | `tools/scan-banned-phrases.cjs` |
| CI wiring (was: never actually wired) | `package.json` pretest + `.github/workflows/ci.yml` |
