# P0 Decisions — audit remediation (locked 2026-06-18)

These resolve the 6 forks that gate the fix roadmap. Locked by Serra.

| # | Fork | Decision | Effort | Who applies |
|---|------|----------|--------|-------------|
| 1 | Identity model (#22) | **A — Clerk-text everywhere.** Retype the 6 legacy `uuid`/`auth.users` tables to `text` user_id, drop the auth.users FK, RLS on `auth.jwt()->>'sub'` or service-role-only. App already speaks Clerk → one identity. | L | migrations → Serra applies to prod |
| 2 | Sync wire-format (#1) | **A — client-side hex.** Convert base64 → Postgres `\x` hex before upsert; keep `bytea` columns + the 12-byte IV CHECK. No prod migration. | S | agent (client code) |
| 3 | At-rest encryption (#30/#108) | **A — field-level column encryption** via the existing `encryptedKv` envelope for sensitive columns; stop the plaintext localStorage mirror. SQLCipher deferred to beta. | M | agent (+ review) |
| 4 | Multi-device crypto (#73) | **B — build real multi-device.** Per-account shared salt (server-stored or recovery-handoff) so all devices derive the same key. NOT gated to single-device. Bigger track. | L/XL | agent (+ review) + Serra on key-handoff UX |
| 5 | Routing-cache backend (#24) | **A — apply the new `routing_cache_lookup` migration to prod** + add the missing column. Revives the cache (feed-me + /route/:module cost). | S | migration → Serra applies to prod |
| 6 | Research-stream consent (#62) | **Leave as-is — do NOT touch.** No consent re-gating this round (Serra call). Mark #62 won't-fix-now. | — | none |

## What these unblock
- 1A → unblocks #63, #67, #68, #75, #102, #109, #112, #113 (all identity/RLS-dependent).
- 2A → #1 (+ related sync write findings).
- 5A → #9, #75 (cache-dependent cost findings).
- 4B → promotes the multi-device-crypto work from "deferred" to a real workstream (packages/auth + sync + onboarding key-handoff). Slot as its own track; NOT alpha-P1-blocking.
- 6 → #62 dropped from scope this round.

## Execution note
P1 auto-fixes (rate-limits, dumpId, sync-hex client code) run via the phase executor in isolated worktrees → human review → integrate. The two prod migrations (identity retype #1-decision, routing_cache #5) are authored by agents but APPLIED by Serra (credentials). 4B is scoped separately after P1.
