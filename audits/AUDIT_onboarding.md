# Onboarding Flow — Re-Audit (2026-05-14, Sprint B' state)

> **Note for Serra:** Documents path TCC-sandboxed. File at `audits/AUDIT_onboarding.md`. Verified state post Sprint 6 ConsentScreen + Sprint B' pivot.

**Status:** ALIGNED — no breaking deltas post-pivot. All 8 screens functional.

---

## TL;DR (100 words)

Onboarding flow correctly implements Sprint 6 consent rewrite + Sprint B' pivot. All 8 screens render: welcome / pets / pantry / subs / banklink+healthkit / work / cycle / burhan. Routing order verified: AuthFlow → ConsentScreen (necessary master gate) → ConsentStep (research opt-in, sentinel null for re-prompt) → OnboardingScreen. commitAll writes to 5 store modules (shared/pets/grocery/finance). BankLink + HealthKit hide gracefully behind env flags. Pre-pivot user migration wired (research_optin: null re-prompts). One gap: **day-30 prompt not implemented** — retention.ts tracks d1/d7 but no d30 fired event or UI handler. Copy locked + audit-passed.

---

## 8 screens

| # | Screen | Status | Notes |
|---|---|---|---|
| 0 | Welcome (name + country) | ✓ | Locale autodetect; INTL fallback |
| 1 | Pets (yes/no + draft) | ✓ | Commits only when hasPets===true |
| 2 | Pantry (12 staples, tap-remove) | ✓ | |
| 3 | Subscriptions (10 defaults, tap-confirm) | ✓ | Audit disclosure |
| 4 | BankLink + HealthKit | ✓ (gated) | Plaid: VITE_PLAID_SYNC_WORKER_URL; HK: VITE_HEALTHKIT_ENABLED + Capacitor |
| 5 | Work Time | ✓ | 5 chips |
| 6 | Cycle | ✓ | 4 options (yes/no/not_anymore/postpartum) |
| 7 | Burhan seedling | ✓ | finish() → commitAll() |

---

## Routing (App.tsx)

```
!authed → AuthFlow
authed & !consentGiven → ConsentScreen (necessary one-way)
consentGiven & researchOptin===null → ConsentStep (source: 'onboarding'|'reprompt')
!onboarded → OnboardingScreen
fully → HomeScreen
```

---

## commitAll writes

Store modules: `shared` (name, settings.*), `pets`, `grocery.pantry`, `finance.subscriptions`. Pre-pivot consent flags (cycle/astrology/spending_research) REMOVED per Sprint 6.

---

## @ollie/consent

```ts
type ConsentState = {
  necessary: true;
  marketing: boolean;
  research_optin: boolean | null;  // null = re-prompt sentinel
  set_at: number; v: 1;
};
```

Pre-pivot migration: `set_at < CONSENT_PIVOT_TS (2026-05-14)` → forces `research_optin: null` on read → ConsentStep re-prompts.

---

## Hypotheses (re-verified)

| Hypothesis | Outcome |
|---|---|
| 8-screen flow + passphrase NOT in onboarding | ✓ CONFIRMED (passphrase is in AuthFlow per Pattern A) |
| Day-30 prompt not implemented | ✓ CONFIRMED (retention.ts has tracking, no UI handler) |
| ConsentScreen BEFORE onboarding | ✓ CONFIRMED |
| Pre-pivot migration wired | ✓ CONFIRMED |
| Sprint 6 consent rewrite landed cleanly | ✓ CONFIRMED |

---

## Top 3 next steps

1. Decide if day-30 prompt needed; if yes, wire `void:retention:d30_returned` handler
2. Optional: full-flow integration test (currently unit tests on commitAll only)
3. Production env flags: VITE_PLAID_SYNC_WORKER_URL + VITE_HEALTHKIT_ENABLED=1 once approvals land

## BLOCKED-EXTERNAL
- HealthKit consent step gated on Apple Dev approval

*Re-audit by Claude (Opus 4.7), 2026-05-14.*
