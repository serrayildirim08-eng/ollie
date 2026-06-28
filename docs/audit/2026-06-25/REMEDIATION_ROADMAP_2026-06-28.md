# Alpha Blocker Remediation — Roadmap (2026-06-28)

Source audit: `docs/audit/2026-06-25/REPORT.md` (299 findings, 8 P0). This roadmap targets only the **6 alpha-blocker clusters** from §2 of that report. Branch: `redesign/olive-neumorphic`.

Goal: unblock closed alpha. These are **lock-the-doors** fixes, not a refactor. Estimate: days, not weeks.

## The 6 blockers

| # | Blocker | Owner | Code-fixable? |
|---|---|---|---|
| 1 | Unauthenticated Anthropic proxy (`/brain-dump`, `/v1/messages`) | subagent | yes |
| 2 | account-delete deletes 0 rows / misses 5 tables | subagent | yes |
| 3 | Device data plaintext — `encryptedKv` has zero callers | subagent | yes |
| 4 | Queue/deploy will collapse next build | subagent (code) + Serra (deploy) | partial |
| 5 | Migration 0002 (uuid→text) prod-status unknown | Serra / me+Supabase MCP | no (prod DB) |
| 6 | No test-gate (CI doesn't block broken code) | subagent | yes |

---

## Blocker detail + done-definition

### #1 — Unauthenticated Anthropic proxy  (P0, c3)
**What:** `workers/ai-proxy` `/brain-dump` + `/v1/messages` accept requests with no auth; rate-limit key is caller-supplied `x-user-id` (spoofable). Anyone with the URL drains `ANTHROPIC_API_KEY` and can poison another user's quota.
**Fix:** require Clerk JWT verification on both routes (reuse existing T0 JWT verify); derive rate-limit key from verified `sub`, not header.
**Done:** unauthenticated request → 401; spoofed `x-user-id` ignored; verified-user happy path still works; rate-limit keyed on verified subject.

### #2 — account-delete is fake  (P0, c3)
**What:** `apps/api` 385-line delete compiles but (a) is undeployed and (b) cascade misses `dump_inbox`, `grocery_pantry`, `partner_*`, plus `research_corpus` + `raw_dumps`.
**Fix:** complete the cascade to cover every user-owned table; ensure the handler actually deletes rows for the authenticated user. (Deploy is Serra's step.)
**Done:** delete removes rows from ALL user tables (enumerate against schema); no orphan rows; covered by a test asserting row counts → 0.

### #3 — Device data plaintext  (P1, c3)
**What:** cycle/medication/mood/dump stored unencrypted in SQLite + localStorage. `encryptedKv` exists but has **zero callers**.
**Fix:** wire the sensitive read/write paths through `encryptedKv` (at-rest AES). Do not break existing plaintext reads — migrate-on-read where needed.
**Done:** sensitive modules read/write through encryptedKv; existing data still readable (migrate-on-read); no plaintext sensitive write remains for the wired modules.

### #4 — Queue/deploy collapse  (code part)
**What:** next deploy can break the build (CF Queues / deploy config). 
**Fix (subagent):** correct the queue/deploy config so a clean build/deploy is possible; document any binding/secret the deploy needs.
**Serra step:** run the actual deploy once config is fixed.
**Done (code):** config validates; CI/build dry-run passes; deploy steps documented for Serra.

### #3 DECISION (2026-06-28): key in OS keychain, automatic
Serra chose: **whole-device-DB encryption (SQLCipher), key stored in the OS keychain, zero user friction** (no passphrase). Protects against file-theft / other apps; unlocks automatically behind Face ID / device passcode. Build requirements: (a) SQLCipher PRAGMA key on the SQLite store; (b) key generated once + stored in iOS/macOS Keychain (NOT the current plaintext ollie-secure.bin); (c) migrate-on-read / one-shot rekey of existing plaintext data, no data loss; (d) handle the @ollie/store → browserAdapter → localStorage plaintext mirror of sensitive modules WITHOUT breaking the watcher read paths (the "great rewiring"); (e) no silent-autosave regression (the prior attempt's flaw). Final verification = device build by Serra (Rust/Cargo can't be fully verified headless).

### #6 — No test-gate  (CI)
**What:** GitHub Actions doesn't block merges on failing typecheck/lint/test. 215 test files exist but no gate enforces them.
**Fix:** add a CI job (typecheck + lint + `test TZ=UTC`) that runs on PRs to the main/redesign branch and blocks on failure.
**Done:** PR with a failing test cannot go green; passing PR goes green; runs the existing suites.

---

## Serra-only / prod

### #5 — Migration 0002 prod status  (most critical UNKNOWN)
Resolve with one query against prod: `SELECT pg_typeof(user_id) FROM encrypted_state LIMIT 1;`
- If `text` → applied, fine.
- If `uuid` → NOT applied → all client writes silently fail under Clerk; apply `20260618000002_identity_clerk_text.sql` immediately.
Can be run via Supabase MCP if the prod project is connected.

### Deploy + rotation (Serra)
- Deploy fixed account-delete (`apps/api`) and queue config (#2, #4).
- Rotate `GROQ_API_KEY` (on-disk in `workers/ai-proxy/.dev.vars`) + previously chat-exposed Voyage/Gemini/CF keys before inviting testers.

---

## Process

- All subagent fixes run in **isolated git worktrees**, one branch per blocker (`fix/blocker-*`). Nothing is merged or deployed automatically.
- Each fix is reviewed by an **independent adversarial auditor** (does it fix it? new bugs? security holes? incomplete?).
- Only audit-passed, disjoint diffs get consolidated onto `fix/alpha-blockers-2026-06-28`, where the **full suite runs once** in the real tree (deps present). Serra reviews + merges + deploys.

> Out of scope for this roadmap (v1 deferred): all UI/design-system debt, onboarding, error boundary, language picker, the 138 P2 / 83 P3 findings. Those come after the door-locks land.
