# Settings — Re-Audit (2026-05-14, post body Item C sprint)

> **Note for Serra:** Documents path TCC-sandboxed. File at `audits/AUDIT_settings.md`. Sprint Item C added `birth_control_enabled` to CycleModule but **NOT surfaced in SettingsScreen**.

**Status:** WIRED-MOSTLY (4/12 features WORKING; 8 NOT STARTED)

---

## TL;DR (100 words)

Settings screen WIRED-MOSTLY: 4/12 core features fully working (account, notifications budget+categories, privacy bidirectional, encrypted .json backup). Major gaps: subscription management (Stripe/IAP not started), voice control (no toggle), HealthKit status (no display), language selector (i18n not wired), quiet hours (only global budget today). **New delta:** birth_control_enabled toggle added to CycleModule.SettingsPanel in Sprint Item C but NOT surfaced in SettingsScreen — module-local. Same for taxProfile.selfEmployed (store-only). CSV/PDF export variants skeleton-only. Recommend: lift birth_control_enabled to `shared.settings`, prioritize subscription display + cancel flow, wire taxProfile UI.

---

## Features

### ✓ WORKING (4)

| # | Feature | Notes |
|---|---|---|
| 1 | Account info | Email, sign-out, delete (ConfirmModal) |
| 2 | Privacy toggles | consent.necessary (LockedToggle), consent.marketing (bidirectional, fires consent_audit), country selector |
| 3 | Notifications budget + categories | Slider 1-10 (default 4), 3 category mute toggles (REMINDER/PATTERN_ALERT/CONTENT_DELIVERY) |
| 4 | Export backup | AES-GCM passphrase-encrypted .json export + import |

### ✗ NOT STARTED (8)

| # | Feature | Effort |
|---|---|---|
| 5 | Subscription mgmt (Stripe/IAP) | High |
| 6 | Voice settings (Hey Ollie, push-to-talk) | Medium |
| 7 | HealthKit connection status | Low |
| 8 | Language selector | Medium |
| 9 | Quiet hours time-picker | Medium |
| 10 | CSV/PDF/all-data export variants | Medium |
| 11 | Device enumeration / sync status | High |
| 12 | birth_control_enabled + taxProfile UI | Low |

---

## birth_control_enabled — module-local (Sprint C delta)

- Stored at `cycle.settings.birth_control_enabled` (default false)
- Checkbox in CycleModule.SettingsPanel (modal overlay; NOT SettingsScreen)
- Gates PillLogSection + pill-type selector
- 9 test cases passing (`CycleModule.pill.test.tsx`)

**To surface in SettingsScreen:** lift to `shared.settings.birth_control_enabled`, add row in PrivacySection. Low effort, high clarity.

---

## Account deletion — client-only

Scan localStorage `void.state.*` prefix wipes device. **Server row orphaned.** Apple App Store privacy review concern. Needs server endpoint (half-day).

---

## Top 3 next steps

1. Lift `birth_control_enabled` to `shared.settings` + SettingsScreen row (low effort)
2. taxProfile.selfEmployed toggle in Finance section (unblocks body tax-setaside push)
3. Subscription display: plan + billing date from Supabase (Stripe cancel blocked on prod approval)

## BLOCKED-EXTERNAL
- Stripe production approval (subscription cancel)
- Apple IAP review (iOS subscription)

*Re-audit by Claude (Opus 4.7), 2026-05-14.*
