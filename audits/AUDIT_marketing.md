# Marketing Site (ollie.app) — Re-Audit (2026-05-14, post B2B pivot)

> **Note for Serra:** Documents path TCC-sandboxed. File at `audits/AUDIT_marketing.md`. **Critical change since previous audit:** B2B pivot (commit `6e7981e`) reframed privacy posture from zero-knowledge to opt-in anonymized research. Privacy policy + terms must be rewritten.

**Status:** NOT STARTED. **App Store HARD BLOCKER persists.**

---

## TL;DR (100 words)

ollie's marketing site **still does not exist**. Privacy + terms URLs hardcoded (`SettingsScreen.tsx:31-32` → `ollie.computer/{privacy,terms}`) but pages still missing → **App Store will reject**. Domain still unclear (`ollie.app` vs `ollie.computer`). **NEW:** B2B pivot (2026-05-14, commit 6e7981e) shifts privacy posture from zero-knowledge claims to opt-in anonymized research. Privacy policy MUST NOW disclose research corpus collection, PII scrub, Claude labeling, and third-party sharing. Terms must clarify research participation is optional + reversible going forward (past data stays). In-app consent mechanics solid (@ollie/consent, ConsentStep, pii-scrub). Fix priority: (1) write + deploy updated privacy/terms (3h blocking); (2) decide domain + update links (30m); (3) build public homepage (4-8h nice-to-have).

---

## App Store blockers (3 critical)

### ❌ Privacy policy URL — missing
- Hardcoded: `https://ollie.computer/privacy` (SettingsScreen.tsx:31)
- Page does not exist; returns 404
- **NEW**: Must now disclose opt-in research corpus + PII scrub + Claude labeling + third-party research partners
- Effort: 2.5h

### ❌ Terms of service URL — missing
- Hardcoded: `https://ollie.computer/terms` (SettingsScreen.tsx:32)
- Page does not exist; returns 404
- **NEW**: Must clarify research data deletion asymmetry (future opt-out yes; past corpus stays)
- Effort: 1.5h

### ❌ Support / Help Center URL — missing
- Not referenced anywhere in code
- Apple expects monitored support contact
- Options: email alias (`support@ollie.app`, 30m) OR public help page (~2h)

---

## Domain status — still unresolved

| Reference | Source |
|---|---|
| `ollie.computer/privacy` + `/terms` | SettingsScreen.tsx |
| `soporte@ollie.app` | packages/pii-scrub test golden samples |
| `app.ollie.ollie` (appId) | capacitor.config.json |

Open questions: which domain owned? renewal status? DNS provider? Production deploy target?

**Decision needed before App Store submission:** pick one (recommend `ollie.app`), verify ownership, update SettingsScreen.tsx URLs.

---

## B2B pivot impact (2026-05-14, commit 6e7981e)

### What changed
- "zero-knowledge" / "server-blind" claims stripped from auth/crypto/sync/apns-push
- `@ollie/consent` package created — manages two toggles (necessary locked ON + research_optin default OFF)
- `ConsentStep.tsx` in onboarding — research consent gate
- `@ollie/pii-scrub` package — removes names/emails/phone/address pre-corpus
- `@ollie/research-stream` + orchestrator wired (opt-in only)
- Sentry session replay included under necessary consent

### What privacy policy must disclose
- Data collection: module entries (Plaid txns, cycle, body, sleep, habits, goals), brain dumps (opt-in, PII-scrubbed)
- Third-party services: Plaid, Sentry, BigDataCloud, Open-Meteo, **Claude AI** (research labeling)
- Storage: device-first (encrypted), Supabase Postgres (synced users), `research_corpus` table (anonymized)
- User rights: export/import .json, delete account, toggle research_optin anytime
- Consent model: necessary (locked, app won't run without), research_optin (default OFF, revocable going forward)
- **Research data asymmetry:** opt-out stops FUTURE collection but past corpus stays anonymized
- GDPR/CCPA compliance
- Data breach notification: 30-day commitment

### What terms must cover
- User content ownership (journals, finance, research opt-ins)
- Permitted uses: personal tracking + voluntary research
- Prohibited: diagnosis, commercial resale
- Research corpus terms: anonymized, may be shared with research partners (name them or note TBD), revocable forward-only
- Warranty disclaimer, liability limits, termination policy

---

## Tier 1 (App Store blocking, ~5.5h total)

| Task | Effort | Blocker |
|---|---|---|
| Decide `ollie.app` vs `ollie.computer` | 1h | YES |
| Register domain if not owned | 10m | YES |
| Write + deploy updated privacy policy | 2.5h | YES |
| Write + deploy terms | 1.5h | YES |
| Setup `support@ollie.app` email + monitor | 30m | YES |
| Update SettingsScreen.tsx URLs to chosen domain | 5m | YES |

## Tier 2 (beta launch, ~14h)

- Public homepage: hero + features + privacy-forward CTA (4-8h)
- About page: ADHD-first + research mission framing (2-3h)
- FAQ covering research opt-in + data deletion (2-3h)
- Waitlist form → Supabase (2-3h)
- Email support infrastructure (1-2h)

## Tier 3 (post-beta, defer)

Blog, community, ASO, analytics, social media.

---

## Deltas from previous audit

| Item | Before | Today | Status |
|---|---|---|---|
| Privacy policy URL | Missing | Still missing | ❌ |
| Terms URL | Missing | Still missing | ❌ |
| Support URL | Missing | Still missing | ❌ |
| Domain clarity | Unclear | Still unclear | ❌ |
| Landing page | NOT STARTED | NOT STARTED | ❌ |
| **Privacy posture** | Zero-knowledge claims | **Pivot to opt-in research** | ⚠️ CRITICAL CHANGE |
| Consent mechanics | Generic | Two-toggle model | ✅ NEW |
| PII scrub | Not implemented | @ollie/pii-scrub live | ✅ NEW |
| Research corpus | Not in schema | Wired via orchestrator | ✅ NEW |
| Claude labeling | Not mentioned | ConsentStep + /label endpoint | ✅ NEW |

---

## Tech recommendation

**Option A (recommended):** Astro deployed to Vercel — fast static, markdown-friendly for FAQ, free tier.  
**Option B:** Next.js for future dynamic content.  
**Option C:** No-code (Webflow/Framer) — fastest 1-2 days, less dev time.

---

## Top 3 next steps

1. Decide domain (recommend `ollie.app`), verify ownership, update SettingsScreen.tsx (1h + 5m)
2. Write + deploy updated privacy policy + terms (covering research pivot) (4h)
3. Setup `support@ollie.app` email alias + monitor (30m)

**App Store unblocking total: ~5.5 hours.**

## BLOCKED-EXTERNAL
None (all internal decisions + writing).

*Re-audit by Claude (Opus 4.7), 2026-05-14, post B2B pivot.*
