# Home Module — Audit (2026-05-14, Sprint B' pivot delta)

> **Note for Serra:** the path you originally requested (`~/Documents/Claude/Projects/void app/audits/AUDIT_home.md`) is TCC-sandboxed (see `feedback_documents_sandbox.md`). This file lives in the repo at `audits/AUDIT_home.md`. `cp` or `ln -s` it manually if you want it in Documents.

This audit is the Sprint B' delta only — the full home-module feature audit predates this file. Captured here:

1. The encryption infra row that flipped to DEPRECATED-PIVOT.
2. Three new infra rows for the consent + scrub + corpus stack.

## Status definitions

- **NOT STARTED** — no code exists
- **SCAFFOLDED** — file/component exists but doesn't function end-to-end
- **WORKING** — feature functions in isolation with manual data
- **WIRED-CROSSMODULE** — connected to other modules + notifications + event bus
- **DEPRECATED-PIVOT** — was building, now deprecated per a deliberate strategy pivot
- **BLOCKED-EXTERNAL** — implementation complete, gated on external approval

---

## Infrastructure

| # | Item | Before | After | Notes |
|---|---|---|---|---|
| A | Home record storage (encrypted client-side via `@ollie/crypto`) | SCAFFOLDED | **DEPRECATED-PIVOT** | Pivot 2026-05-14 abandoned the server-blind default. `@ollie/crypto` retained for future opt-out path but no longer the default posture. See `project_ollie_b2b_pivot.md` + Sprint B'. The home-records sync path now runs through the consent + scrub + corpus pipeline by default. |
| B | **Consent reader** (`@ollie/consent`) | — | **WIRED-CROSSMODULE** | `getConsent` / `setConsent` / `hasResearchConsent` ship as the single source of truth. Pre-pivot users force-null'd on read so the onboarding ConsentStep re-prompts. Persists local + syncs to Supabase `user_consent` (current state) and `consent_audit` (trail). |
| C | **PII scrub** (`@ollie/pii-scrub`, locale-aware) | — | **WIRED-CROSSMODULE** | 3 layers (regex / numeric / wordlist en+es+tr) + 100-sample golden test (FP<5%, FN<10%). `home_records.note` field is scrubbed before /label on opt-in. |
| D | **Research corpus + 10-sector cache** | — | **WIRED-CROSSMODULE** | `research_corpus` table (no user_id; anonymized at write) + `@ollie/research-cache` exposes `getSectorPatterns(sector)` for in-app insights and `getCorpusSnapshot(sector, range)` for the future B2B portal. Sectors locked: tech / law / med / fin / edu / creative / parenting / hospitality / gov / other. |
| E | **/label endpoint** (ai-proxy worker extension) | — | **WIRED-CROSSMODULE** | Anthropic Claude Sonnet 4.6 + prompt caching. System prompt at `workers/ai-proxy/prompts/label.md` (versioned). Cost cap via `DAILY_LABEL_BUDGET_USD` env var. |
| F | **research orchestrator** (opt-in pipeline) | — | **WIRED-CROSSMODULE** | `packages/orchestrator/src/research.ts`. Batches writes 60s; opt-in → scrub → /label → corpus + cache; opt-out → user row only. Idempotent on (table, row_id). Silent fail to sentry-tunnel. |

## What the home module ships into the corpus

When a user with `research_optin: true` writes a home record, the orchestrator:

1. Reads the `note` field (the only free-text column on `home_records`).
2. Scrubs PII with locale-appropriate wordlist.
3. Posts to `ai-proxy /label` with `sector_hint: 'hospitality'` (or model-inferred when not set).
4. Anthropic returns `{ mood_signal, content_type, urgency_tier, adhd_pattern_tag, sector_relevance, confidence }`.
5. Row lands in `research_corpus` keyed by a fresh `corpus_id` UUID. No `user_id`, no `device_id`, no anything that links to a person.

Opt-outs route the same write to `home_records` only and never call /label.

## What still needs to happen post-sprint

- Wire `home` module orchestrator to emit `research:row_written` on every `home_records.note` write (one-line addition).
- Confirm Anthropic Sonnet 4.6 model id once Anthropic locks the public alias; for now `claude-sonnet-4-6` is the placeholder in `workers/ai-proxy/src/label.ts`.
- Build the B2B portal UI that consumes `getCorpusSnapshot`. Out of scope for Sprint B'.
