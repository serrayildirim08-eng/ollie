/**
 * SettingsScreen — single-page settings (Sprint 5 · F4)
 *
 * Sections:
 *   - Account       email · sign-out · delete-account (confirm modal)
 *   - Notifications daily budget slider 1–10 (default 4) · per-category mute toggles
 *   - Privacy       necessary opt-in (locked-on) · marketing cookies · export · import
 *   - About         version · privacy policy link · terms link
 *
 * Consent rewrite (Sprint 6): the per-feature privacy toggles
 * (spending-research / cycle / astrology) have been replaced by the
 * two-toggle consent model written at sign-up by ConsentScreen.
 *   - necessary  — locked-ON in settings; only revocable by deleting the
 *                  account
 *   - marketing  — bidirectional, default ON
 *
 * Görev 1 (2026-05-15): both flags persist to the canonical @ollie/consent
 * `consent.state` row. The marketing toggle below reads/writes that row,
 * not the legacy `shared.consent.marketing` key.
 *
 * Voice: lowercase labels, sage active, DM Mono caps section headers.
 * Reached from HomeScreen.
 */

import React, { useEffect, useState } from 'react';
import { getString, type Locale } from '../i18n';
import type { AuthClient } from '@ollie/auth';
import { exportBackup, envelopeToFileBytes, defaultFilename, importBackup } from '@ollie/backup';
import { requestPermission, checkPermission } from '@ollie/notifications';
import {
  CONSENT_STORE_KEY,
  CONSENT_STORE_MODULE,
  getConsent,
  setConsent,
  setMarketingConsentSync,
  type ConsentState,
} from '@ollie/consent';
import { useStoreSlice, store } from '../store';
import { isBiometricSupported } from '../lib/biometric';
import {
  APP_LOCK_SLICE,
  APP_LOCK_ENABLED_KEY,
  setAppLockEnabled,
} from '../lib/app-lock';
import { SUPPORTED_COUNTRIES } from '../lib/country';
import { getAccount } from '../lib/account-boot';
import { readUserHash } from '../lib/user-hash';
import { getAppVersion } from '../lib/device';
import { generateInvite, type InviteRecord } from '../lib/invite';

const APP_VERSION = '0.0.1';
const PRIVACY_URL = 'https://ollie.app/privacy';
const TERMS_URL = 'https://ollie.app/terms';
const SUPPORT_URL = 'https://ollie.app/support';

type NotificationCategory = 'REMINDER' | 'PATTERN_ALERT' | 'CONTENT_DELIVERY';

const NOTIF_CATS: { id: NotificationCategory; label: string; hint: string }[] = [
  { id: 'REMINDER', label: 'reminders', hint: 'bill due · vet med · appt tomorrow' },
  { id: 'PATTERN_ALERT', label: 'pattern alerts', hint: 'detected pattern · savings · subscription' },
  { id: 'CONTENT_DELIVERY', label: 'content delivery', hint: 'opt-in morning digest · daily reading' },
];

interface NotificationBudget {
  daily_cap: number;
  muted_categories: NotificationCategory[];
  aggregation_window_ms?: number;
}

export interface SettingsScreenProps {
  auth: AuthClient | null;
  onBack: () => void;
  onSignedOut: () => void;
}

// ─── tokens ──────────────────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: '100vh',
    background: 'var(--bone)',
    color: 'var(--ink)',
    fontFamily: 'var(--font-system)',
    // Top/bottom padding folds in the iPhone safe areas so the header
    // clears the notch and content clears the home indicator.
    padding:
      'calc(32px + env(safe-area-inset-top, 0px)) 24px calc(96px + env(safe-area-inset-bottom, 0px))',
  } as React.CSSProperties,
  wrap: {
    maxWidth: '560px',
    margin: '0 auto',
  } as React.CSSProperties,
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '32px',
  } as React.CSSProperties,
  back: {
    background: 'none',
    border: 'none',
    color: 'var(--ink-soft)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--t-meta)',
    letterSpacing: 'var(--ls-caps-small)',
    textTransform: 'uppercase',
    cursor: 'pointer',
    padding: '8px 0',
  } as React.CSSProperties,
  title: {
    fontFamily: 'var(--font-editor)',
    fontSize: 'var(--t-h1)',
    fontWeight: 400,
    color: 'var(--ink)',
    margin: 0,
    lineHeight: 'var(--lh-headline)',
  } as React.CSSProperties,
  section: {
    margin: '40px 0 0',
    paddingTop: '24px',
    borderTop: '1px solid var(--rule)',
  } as React.CSSProperties,
  sectionHeader: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--t-kicker)',
    letterSpacing: 'var(--ls-caps)',
    textTransform: 'uppercase',
    color: 'var(--ink-faint)',
    margin: '0 0 16px',
  } as React.CSSProperties,
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '12px 0',
    borderBottom: '1px solid var(--rule-soft)',
  } as React.CSSProperties,
  rowLabel: {
    fontFamily: 'var(--font-system)',
    fontSize: 'var(--t-body)',
    color: 'var(--ink)',
    margin: 0,
  } as React.CSSProperties,
  rowHint: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--t-meta)',
    letterSpacing: 'var(--ls-caps-small)',
    textTransform: 'uppercase',
    color: 'var(--ink-faint)',
    margin: '4px 0 0',
  } as React.CSSProperties,
  rowValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--t-caption)',
    color: 'var(--ink-soft)',
  } as React.CSSProperties,
  linkBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--t-meta)',
    letterSpacing: 'var(--ls-caps-small)',
    textTransform: 'uppercase',
    cursor: 'pointer',
    padding: '4px 0',
  } as React.CSSProperties,
  destructive: {
    background: 'none',
    border: 'none',
    color: 'var(--umber)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--t-meta)',
    letterSpacing: 'var(--ls-caps-small)',
    textTransform: 'uppercase',
    cursor: 'pointer',
    padding: '4px 0',
  } as React.CSSProperties,
};

// ─── Toggle (sage active) ────────────────────────────────────────────────────

function Toggle({
  on,
  onChange,
  ariaLabel,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={() => onChange(!on)}
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        background: on ? 'var(--accent)' : 'var(--ink-ghost)',
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 200ms ease',
        padding: 0,
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '3px',
          left: on ? '22px' : '3px',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: 'var(--bone)',
          transition: 'left 200ms ease',
        }}
      />
    </button>
  );
}

// ─── LockedToggle — visually ON, non-interactive, lock hint ──────────────────

function LockedToggle({ ariaLabel }: { ariaLabel: string }) {
  return (
    <span
      role="switch"
      aria-checked="true"
      aria-disabled="true"
      aria-label={ariaLabel}
      title="locked — to disable, delete your account"
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        background: 'var(--accent)',
        position: 'relative',
        display: 'inline-block',
        flexShrink: 0,
        opacity: 0.85,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '3px',
          left: '22px',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: 'var(--bone)',
        }}
      />
      <svg
        aria-hidden="true"
        width="10"
        height="10"
        viewBox="0 0 12 12"
        style={{
          position: 'absolute',
          top: '7px',
          left: '26px',
          color: 'var(--accent)',
        }}
      >
        <rect x="2.5" y="5.5" width="7" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
        <path d="M4 5.5 V4 a2 2 0 0 1 4 0 V5.5" fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
    </span>
  );
}

// ─── Confirm modal ───────────────────────────────────────────────────────────

function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,20,15,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: '24px',
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bone)',
          borderRadius: '12px',
          padding: '28px',
          maxWidth: '420px',
          width: '100%',
          boxShadow: 'var(--sh-lg)',
        }}
      >
        <h2
          id="confirm-title"
          style={{
            fontFamily: 'var(--font-editor)',
            fontSize: 'var(--t-h3)',
            margin: '0 0 12px',
            color: 'var(--ink)',
            fontWeight: 400,
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontFamily: 'var(--font-system)',
            fontSize: 'var(--t-body)',
            color: 'var(--ink-soft)',
            margin: '0 0 24px',
            lineHeight: 'var(--lh-body)',
          }}
        >
          {body}
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '10px 20px',
              border: '1px solid var(--rule)',
              borderRadius: '20px',
              background: 'transparent',
              color: 'var(--ink)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-caption)',
              letterSpacing: 'var(--ls-caps)',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '10px 20px',
              border: '1px solid var(--umber)',
              borderRadius: '20px',
              background: 'var(--umber)',
              color: 'var(--bone)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-caption)',
              letterSpacing: 'var(--ls-caps)',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Account section ─────────────────────────────────────────────────────────

function AccountSection({
  auth,
  onSignedOut,
}: {
  auth: AuthClient | null;
  onSignedOut: () => void;
}) {
  const session = auth?.state().session ?? null;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleSignOut() {
    if (!auth) return;
    await auth.signOut();
    onSignedOut();
  }

  async function handleDeleteAccount() {
    if (!auth) return;
    // Server-cascade deletion (Sprint B'). The auth client posts the
    // user's JWT + confirm token to `/account/delete`, which cascades
    // every user-scoped table via service-role and then deletes the
    // auth.users row last. The client only wipes local data AFTER the
    // server reports success — if the server fails the user keeps
    // their local data and can retry without losing access.
    setDeleting(true);
    setDeleteError(null);
    try {
      const r = await auth.deleteAccount();
      if (!r.ok) {
        const msg =
          r.code === 'no-endpoint'
            ? 'account deletion is not enabled in this build'
            : r.code === 'unauthorized'
            ? 'session expired — sign in again and retry'
            : r.code === 'network'
            ? 'network error — check your connection and retry'
            : r.code === 'cascade-failed' || r.code === 'auth-delete-failed'
            ? 'partial deletion — please retry'
            : r.message;
        setDeleteError(msg);
        setDeleting(false);
        return;
      }
      setConfirmDelete(false);
      setDeleting(false);
      onSignedOut();
      if (typeof window !== 'undefined') window.location.reload();
    } catch (err) {
      setDeleteError('deletion failed: ' + (err as Error).message);
      setDeleting(false);
    }
  }

  return (
    <section style={styles.section} aria-label="account">
      <h2 style={styles.sectionHeader}>account</h2>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>email</p>
        </div>
        <span style={styles.rowValue}>{session?.email ?? '—'}</span>
      </div>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>sign out</p>
          <p style={styles.rowHint}>keep data on this device · re-enter passphrase to unlock</p>
        </div>
        <button type="button" onClick={() => void handleSignOut()} style={styles.linkBtn} disabled={!auth}>
          sign out
        </button>
      </div>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>delete account</p>
          <p style={styles.rowHint}>erases local data and every server row · final</p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          style={styles.destructive}
          disabled={!auth || !session}
        >
          delete
        </button>
      </div>

      {deleteError && (
        <p
          role="alert"
          style={{ ...styles.rowHint, color: 'var(--umber)', marginTop: '8px' }}
        >
          {deleteError}
        </p>
      )}

      <ConfirmModal
        open={confirmDelete}
        title="delete account?"
        body="this erases ollie's data on this device AND every row tied to your account on ollie's server. anonymized research contributions you opted into stay in the corpus. there is no undo."
        confirmLabel={deleting ? 'deleting…' : 'delete'}
        onConfirm={() => { if (!deleting) void handleDeleteAccount(); }}
        onCancel={() => { if (!deleting) setConfirmDelete(false); }}
      />
    </section>
  );
}

// ─── Notifications section ───────────────────────────────────────────────────

function NotificationsSection() {
  const [budget, setBudget] = useStoreSlice<NotificationBudget>(
    'shared',
    'settings.notification_budget',
    { daily_cap: 4, muted_categories: [], aggregation_window_ms: 30 * 60 * 1000 },
  );
  const cap = budget?.daily_cap ?? 4;
  const muted = budget?.muted_categories ?? [];

  // OS push permission — the escape hatch the priming screen promises.
  // 'checking' until the first non-prompting read resolves.
  const [perm, setPerm] = useState<'granted' | 'denied' | 'default' | 'checking'>('checking');

  useEffect(() => {
    let alive = true;
    void checkPermission().then((p) => { if (alive) setPerm(p); });
    return () => { alive = false; };
  }, []);

  async function handleEnable() {
    setPerm(await requestPermission());
  }

  function setCap(value: number) {
    setBudget({ ...budget, daily_cap: value });
  }

  function toggleMute(cat: NotificationCategory) {
    const next = muted.includes(cat) ? muted.filter((c) => c !== cat) : [...muted, cat];
    setBudget({ ...budget, muted_categories: next });
  }

  return (
    <section style={styles.section} aria-label="notifications">
      <h2 style={styles.sectionHeader}>notifications</h2>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>push notifications</p>
          <p style={styles.rowHint}>
            {perm === 'granted'
              ? 'on. ollie can reach you when something needs you.'
              : perm === 'denied'
                ? 'blocked. turn them on in your phone settings → ollie.'
                : 'off. ollie can only nudge you inside the app.'}
          </p>
        </div>
        {perm === 'granted' ? (
          <span style={styles.rowValue}>on</span>
        ) : perm === 'denied' ? (
          <span style={{ ...styles.rowValue, color: 'var(--ink-faint)' }}>blocked</span>
        ) : perm === 'checking' ? (
          <span style={styles.rowValue}>·</span>
        ) : (
          <button type="button" onClick={() => void handleEnable()} style={styles.linkBtn}>
            turn on
          </button>
        )}
      </div>

      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--rule-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <p style={styles.rowLabel}>daily budget</p>
          <span style={styles.rowValue}>{cap} / day</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          value={cap}
          onChange={(e) => setCap(Number(e.target.value))}
          aria-label="daily notification budget"
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
        <p style={styles.rowHint}>cap on push + in-app pings per day</p>
      </div>

      {NOTIF_CATS.map((c) => {
        const isMuted = muted.includes(c.id);
        return (
          <div key={c.id} style={styles.row}>
            <div>
              <p style={styles.rowLabel}>{c.label}</p>
              <p style={styles.rowHint}>{c.hint}</p>
            </div>
            <Toggle
              on={!isMuted}
              onChange={() => toggleMute(c.id)}
              ariaLabel={`${c.label} ${isMuted ? 'muted' : 'on'}`}
            />
          </div>
        );
      })}
    </section>
  );
}

// ─── Health section ───────────────────────────────────────────────────────────
//
// Surfaces shared.settings.birth_control_enabled — lifted from CycleModule.
// Gates the pill log section and daily pill check notification.

export function HealthSection() {
  const [birthControl, setBirthControl] = useStoreSlice<boolean>(
    'shared',
    'settings.birth_control_enabled',
    false,
  );
  const [sharedSettings] = useStoreSlice<{ locale?: string }>('shared', 'settings', {});
  const locale: Locale = sharedSettings?.locale === 'es' ? 'es' : 'en';

  return (
    <section style={styles.section} aria-label={getString(locale, 'settings.health.section_header')}>
      <h2 style={styles.sectionHeader}>{getString(locale, 'settings.health.section_header')}</h2>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>{getString(locale, 'settings.health.birth_control_label')}</p>
          <p style={styles.rowHint}>{getString(locale, 'settings.health.birth_control_hint')}</p>
        </div>
        <Toggle
          on={birthControl}
          onChange={setBirthControl}
          ariaLabel={getString(locale, 'settings.health.birth_control_label')}
        />
      </div>
    </section>
  );
}

// ─── Finance section ──────────────────────────────────────────────────────────
//
// Surfaces finance.taxProfile.selfEmployed — previously store-only.
// When enabled, monthly tax set-aside reminders fire on the 1st.
// Sub-radio selects jurisdiction: us / uk / eu (writes finance.taxProfile.calculator.kind).

type TaxJurisdiction = 'us' | 'uk' | 'eu';

interface TaxProfile {
  selfEmployed: boolean;
  calculator?: { kind: TaxJurisdiction };
}

const TAX_JURISDICTIONS: { id: TaxJurisdiction; label: string }[] = [
  { id: 'us', label: 'us' },
  { id: 'uk', label: 'uk' },
  { id: 'eu', label: 'eu' },
];

export function FinanceSection() {
  const [taxProfile, setTaxProfile] = useStoreSlice<TaxProfile>(
    'finance',
    'taxProfile',
    { selfEmployed: false },
  );
  const [sharedSettings] = useStoreSlice<{ locale?: string }>('shared', 'settings', {});
  const locale: Locale = sharedSettings?.locale === 'es' ? 'es' : 'en';

  const selfEmployed = taxProfile?.selfEmployed ?? false;
  const jurisdiction: TaxJurisdiction = taxProfile?.calculator?.kind ?? 'us';

  function handleSelfEmployedChange(next: boolean) {
    setTaxProfile({ ...taxProfile, selfEmployed: next });
  }

  function handleJurisdictionChange(next: TaxJurisdiction) {
    setTaxProfile({ ...taxProfile, calculator: { kind: next } });
  }

  return (
    <section style={styles.section} aria-label={getString(locale, 'settings.finance.section_header')}>
      <h2 style={styles.sectionHeader}>{getString(locale, 'settings.finance.section_header')}</h2>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>{getString(locale, 'settings.finance.self_employed_label')}</p>
          <p style={styles.rowHint}>{getString(locale, 'settings.finance.self_employed_hint')}</p>
        </div>
        <Toggle
          on={selfEmployed}
          onChange={handleSelfEmployedChange}
          ariaLabel={getString(locale, 'settings.finance.self_employed_label')}
        />
      </div>

      {selfEmployed && (
        <div style={{ ...styles.row, flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
          <p style={styles.rowLabel}>{getString(locale, 'settings.finance.tax_jurisdiction_label')}</p>
          <div
            role="radiogroup"
            aria-label="tax jurisdiction"
            style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}
          >
            {TAX_JURISDICTIONS.map((j) => {
              const active = jurisdiction === j.id;
              return (
                <button
                  key={j.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => handleJurisdictionChange(j.id)}
                  style={{
                    padding: '6px 16px',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--rule)'}`,
                    borderRadius: '20px',
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? 'var(--bone)' : 'var(--ink-soft)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--t-caption)',
                    letterSpacing: 'var(--ls-caps)',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    transition: 'background 150ms ease, color 150ms ease',
                  }}
                >
                  {j.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Privacy section ─────────────────────────────────────────────────────────

function PrivacySection() {
  // Consent rewrite (Sprint 6): two toggles only.
  //   - necessary: locked-ON. The only revocation path is delete-account.
  //   - marketing: bidirectional, default ON (set at sign-up by ConsentScreen).
  //
  // Görev 1 (2026-05-15): the marketing flag lives on the canonical
  // @ollie/consent `consent.state` row. We subscribe to that row reactively
  // and derive `marketing` from it; the toggle writes back through
  // setMarketingConsentSync so App.tsx + every other reader stay in sync.
  const [consentRow] = useStoreSlice<ConsentState | null>(
    CONSENT_STORE_MODULE,
    CONSENT_STORE_KEY,
    null,
  );
  const marketing = consentRow?.marketing ?? true;

  function handleMarketingChange(next: boolean) {
    // Canonical write — round-trips through @ollie/consent and the
    // configured Supabase sync sink. The useStoreSlice subscription above
    // re-renders this section when the consent.state row changes.
    setMarketingConsentSync(store, next);
    // Consent audit — fire-and-forget. Gated on hasConsent(); every user
    // reaching Settings has necessary=true so this always fires.
    const account = getAccount();
    if (!account?.research.hasConsent()) return;
    const userHash = readUserHash();
    if (!userHash) return;
    account.research.trackTable('consent_audit', {
      user_hash: userHash,
      consent_necessary: true,
      consent_marketing: next,
      consented_at: new Date().toISOString(),
      event_source: 'settings_change',
      user_agent: typeof navigator !== 'undefined'
        ? navigator.userAgent.slice(0, 200)
        : '',
      app_version: getAppVersion(),
    });
  }
  const [country, setCountry] = useStoreSlice<string>('shared', 'settings.country', 'INTL');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  async function handleExport() {
    const pass = typeof window !== 'undefined'
      ? window.prompt('passphrase to encrypt this backup (16+ chars):')
      : null;
    if (!pass || pass.length < 16) {
      setImportMsg('passphrase must be 16+ chars');
      return;
    }
    setExporting(true);
    try {
      const env = await exportBackup(store, pass, { exportedBy: 'ollie/' + APP_VERSION });
      const bytes = envelopeToFileBytes(env);
      // Copy the Uint8Array view into a fresh ArrayBuffer to avoid TS
      // SharedArrayBuffer-or-ArrayBuffer ambiguity in modern lib.dom.
      const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultFilename(env);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setImportMsg('backup exported');
    } catch (e) {
      setImportMsg('export failed: ' + (e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(file: File) {
    const pass = typeof window !== 'undefined'
      ? window.prompt('passphrase for this backup:')
      : null;
    if (!pass) return;
    setImporting(true);
    setImportMsg('');
    try {
      const text = await file.text();
      const r = await importBackup(store, text, pass, { mode: 'replace' });
      if (r.ok) {
        setImportMsg(`imported · ${r.applied_modules.length} modules`);
      } else {
        setImportMsg('import failed: ' + r.message);
      }
    } catch (e) {
      setImportMsg('import failed: ' + (e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <section style={styles.section} aria-label="privacy">
      <h2 style={styles.sectionHeader}>privacy</h2>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>necessary opt-in</p>
          <p style={styles.rowHint}>to disable, delete your account</p>
        </div>
        <LockedToggle ariaLabel="necessary opt-in (locked on)" />
      </div>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>marketing cookies</p>
          <p style={styles.rowHint}>change anytime</p>
        </div>
        <Toggle on={marketing} onChange={handleMarketingChange} ariaLabel="marketing cookies" />
      </div>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>country</p>
          <p style={styles.rowHint}>drives crisis hotline selection</p>
        </div>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          aria-label="country"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-caption)',
            padding: '6px 8px',
            border: '1px solid var(--rule)',
            borderRadius: '6px',
            background: 'transparent',
            color: 'var(--ink)',
          }}
        >
          {SUPPORTED_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </div>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>export backup</p>
          <p style={styles.rowHint}>encrypted .json · save somewhere safe</p>
        </div>
        <button
          type="button"
          onClick={() => void handleExport()}
          style={styles.linkBtn}
          disabled={exporting}
        >
          {exporting ? 'exporting…' : 'export'}
        </button>
      </div>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>import backup</p>
          <p style={styles.rowHint}>replaces current data · requires passphrase</p>
        </div>
        <label style={{ ...styles.linkBtn, display: 'inline-block' }}>
          {importing ? 'importing…' : 'import'}
          <input
            type="file"
            accept=".json,application/json"
            aria-label="import backup file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
            }}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {importMsg && (
        <p style={{ ...styles.rowHint, marginTop: '8px', color: 'var(--ink-soft)' }}>
          {importMsg}
        </p>
      )}

      {/* Subscription audit disclosure — full text. Surfaces under
          privacy so users see exactly what the audit feature does
          before encountering it in the money module. Plain prose, no
          exclamation marks. */}
      <div style={{ ...styles.row, alignItems: 'flex-start', paddingTop: '20px' }}>
        <div>
          <p style={styles.rowLabel}>subscription audit</p>
          <p style={{ ...styles.rowHint, lineHeight: 1.55, maxWidth: 520 }}>
            ollie audits your subscriptions by comparing two things you
            already share with it: how often you&apos;re charged, and how
            often you write about them. nothing leaves your device for
            this. we cannot see what you do inside netflix — only that
            netflix shows up in your charge history and not in your
            words.
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── Invite section (Task 21) ────────────────────────────────────────────────
//
// "INVITE A FRIEND" — generate up to 5 invite codes per week. Codes ride
// a 13-char `olli-xxxx-yyyy` shape from the worker. Persists the latest
// active code locally so the lawyer-style copy ("max 5 invites this week.
// resets sunday.") survives a reload.
//
// Voice: lowercase, dry, no exclamation, no "great job". Frosted sage
// accent on the active code, soft hairline rule between rows.

interface InviteCacheEntry extends InviteRecord {
  generated_at: number;
  week_start: number;
}

interface InviteCache {
  active?: InviteCacheEntry | null;
  week_count: number;
  week_start: number;
}

const WEEKLY_INVITE_CAP = 5;

function startOfIsoWeek(now: number): number {
  // Sunday → Saturday rollover (matches "resets sunday" copy).
  const d = new Date(now);
  const day = d.getDay(); // 0=sun
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function freshCache(now: number): InviteCache {
  return { active: null, week_count: 0, week_start: startOfIsoWeek(now) };
}

function InviteSection() {
  const [cache, setCache] = useStoreSlice<InviteCache>(
    'shared',
    'invite.cache',
    freshCache(Date.now()),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Roll over the week when sunday flips.
  useEffect(() => {
    const todayStart = startOfIsoWeek(Date.now());
    if (cache.week_start !== todayStart) {
      setCache({ active: null, week_count: 0, week_start: todayStart });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expire the active code once `expires_at` has passed.
  useEffect(() => {
    const active = cache.active;
    if (!active) return;
    if (active.expires_at && active.expires_at < Date.now()) {
      setCache({ ...cache, active: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache.active?.code]);

  function showFlash(msg: string): void {
    setFlash(msg);
    setTimeout(() => setFlash((prev) => (prev === msg ? null : prev)), 2400);
  }

  async function handleGenerate(): Promise<void> {
    if (busy) return;
    if (cache.week_count >= WEEKLY_INVITE_CAP) {
      setError('max 5 invites this week. resets sunday.');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await generateInvite();
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    const entry: InviteCacheEntry = {
      code: r.code,
      share_url: r.share_url,
      expires_at: r.expires_at,
      remaining: r.remaining,
      generated_at: Date.now(),
      week_start: cache.week_start,
    };
    setCache({
      active: entry,
      // Trust the server's `remaining` (cap minus used) when present;
      // otherwise increment locally.
      week_count:
        typeof r.remaining === 'number'
          ? Math.max(0, WEEKLY_INVITE_CAP - r.remaining)
          : cache.week_count + 1,
      week_start: cache.week_start,
    });
  }

  async function handleCopy(active: InviteCacheEntry): Promise<void> {
    try {
      // Try native share first — Safari iOS + Chrome Android.
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav && typeof nav.share === 'function') {
        try {
          await nav.share({
            title: 'ollie',
            text: 'try ollie',
            url: active.share_url,
          });
          showFlash('shared');
          return;
        } catch {
          // User cancelled the share sheet — fall through to clipboard.
        }
      }
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(active.share_url);
        showFlash('copied to clipboard');
      } else {
        showFlash('copy unsupported · long-press the code');
      }
    } catch {
      showFlash('copy failed');
    }
  }

  const active = cache.active ?? null;
  const remaining = Math.max(0, WEEKLY_INVITE_CAP - cache.week_count);
  const atCap = cache.week_count >= WEEKLY_INVITE_CAP;

  return (
    <section style={styles.section} aria-label="invite a friend">
      <h2 style={styles.sectionHeader}>invite a friend</h2>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>{cache.week_count} / {WEEKLY_INVITE_CAP} invites this week</p>
          <p style={styles.rowHint}>
            {atCap
              ? 'max 5 invites this week. resets sunday.'
              : `${remaining} remaining · resets sunday`}
          </p>
        </div>
      </div>

      {active ? (
        <>
          <div style={{ ...styles.row, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <p style={styles.rowLabel}>active code</p>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--t-h3)',
                  letterSpacing: 'var(--ls-caps)',
                  textTransform: 'uppercase',
                  color: 'var(--accent)',
                  margin: '6px 0 0',
                }}
              >
                {active.code}
              </p>
              <p style={styles.rowHint}>{active.share_url}</p>
            </div>
            <button
              type="button"
              onClick={() => void handleCopy(active)}
              style={styles.linkBtn}
              aria-label="copy invite link"
            >
              copy link
            </button>
          </div>
          <div style={styles.row}>
            <div>
              <p style={styles.rowLabel}>new code</p>
              <p style={styles.rowHint}>generate replaces the active code</p>
            </div>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              style={styles.linkBtn}
              disabled={busy || atCap}
            >
              {busy ? '…' : 'generate'}
            </button>
          </div>
        </>
      ) : (
        <div style={styles.row}>
          <div>
            <p style={styles.rowLabel}>generate invite</p>
            <p style={styles.rowHint}>13-char code · expires in 7 days</p>
          </div>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            style={styles.linkBtn}
            disabled={busy || atCap}
            aria-label="generate invite code"
          >
            {busy ? '…' : 'generate'}
          </button>
        </div>
      )}

      {flash && (
        <p
          role="status"
          style={{
            ...styles.rowHint,
            color: 'var(--accent)',
            marginTop: 8,
          }}
        >
          {flash}
        </p>
      )}
      {error && (
        <p
          role="alert"
          style={{ ...styles.rowHint, color: 'var(--umber)', marginTop: 8 }}
        >
          {error}
        </p>
      )}

      <p
        style={{
          ...styles.rowHint,
          marginTop: 20,
          lineHeight: 1.55,
          maxWidth: 520,
          color: 'var(--ink-faint)',
        }}
      >
        ollie is in private beta. invites carry your touch.
      </p>
    </section>
  );
}

// ─── Research data section (Sprint B'' · 2026-05-14) ────────────────────────
//
// The in-app off-switch + on-switch for the research opt-in flag set at
// onboarding by ConsentStep. Round-trips through @ollie/consent so the
// in-memory cache, local store, and durable Supabase audit row (via the
// configureConsent({ sync }) sink wired in App.tsx) all agree.
//
// Banned-phrase clean: no "miss", "streak", "great job", "you should".
// Voice mirrors ConsentStep — lowercase, dry, no exclamation marks.
//
// Inline confirmation (NOT a modal) appears below the toggle for one
// render after a flip so the user gets a quiet ack without losing
// scroll position.
//
// Exported so SettingsScreen.research.test.tsx can mount this section
// in isolation — importing the full SettingsScreen would pull
// '@ollie/store/react' transitively, which vitest can't resolve in this
// workspace shape. Same trick OnboardingScreen uses for sub-screen tests.

export interface ResearchSectionProps {
  /** Stable user id — used as the key into the consent store. Local-dev
   *  builds with no Supabase session pass 'local-dev' so the toggle still
   *  round-trips through the consent package. */
  userId: string;
}

export function ResearchSection({ userId }: ResearchSectionProps) {
  // Three-state mirror of ConsentState.research_optin (true | false | null).
  // null means we haven't hydrated yet — guard the toggle so the user can't
  // flip a stale default to true and overwrite a real opt-out.
  const [optin, setOptin] = useState<boolean | null>(null);
  // The most recent flip direction drives the inline confirmation line.
  // 'just-on'  → showing the on-ack
  // 'just-off' → showing the off-ack
  // null       → no recent change, hide the line.
  const [flipDirection, setFlipDirection] = useState<
    'just-on' | 'just-off' | null
  >(null);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state: ConsentState = await getConsent(userId);
        if (cancelled) return;
        // Treat null (never-prompted sentinel) as off in the UI; the
        // App-level router would normally pull a never-prompted user
        // back into ConsentStep before they ever reach settings, but if
        // it doesn't, default-deny is the right read.
        setOptin(state.research_optin === true);
      } catch {
        if (!cancelled) setOptin(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  async function handleToggle(next: boolean) {
    if (saving) return;
    // Lock the previous value while we await the round-trip. Visual
    // state is the optimistic value; rollback on throw.
    const prev = optin;
    setOptin(next);
    setSaving(true);
    try {
      await setConsent(userId, { research_optin: next });
      setFlipDirection(next ? 'just-on' : 'just-off');
    } catch {
      // setConsent should never reject in practice — local write is sync.
      // Rollback to the prior visual state if it does.
      setOptin(prev);
    } finally {
      setSaving(false);
    }
  }

  const checked = optin === true;
  const hydrated = optin !== null;

  return (
    <section style={styles.section} aria-label="research data">
      <h2 style={styles.sectionHeader}>research data</h2>

      <div style={{ ...styles.row, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, paddingRight: '16px' }}>
          <p style={styles.rowLabel}>research opt-in</p>
          <p
            style={{
              ...styles.rowHint,
              textTransform: 'none',
              letterSpacing: 'normal',
              fontFamily: 'var(--font-system)',
              fontSize: 'var(--t-caption)',
              color: 'var(--ink-soft)',
              lineHeight: 'var(--lh-caption)',
              maxWidth: 520,
              marginTop: '6px',
            }}
          >
            your anonymized text helps us find adhd patterns. off-switch any
            time. existing data stays unless you delete via support.
          </p>
        </div>
        <Toggle
          on={checked}
          onChange={(v) => { if (hydrated) void handleToggle(v); }}
          ariaLabel="research opt-in"
        />
      </div>

      {flipDirection === 'just-on' && (
        <p
          role="status"
          aria-live="polite"
          data-testid="research-confirm"
          style={{
            ...styles.rowHint,
            textTransform: 'none',
            letterSpacing: 'normal',
            fontFamily: 'var(--font-system)',
            fontSize: 'var(--t-caption)',
            color: 'var(--ink-soft)',
            lineHeight: 'var(--lh-caption)',
            marginTop: '12px',
            maxWidth: 520,
          }}
        >
          on. anonymized text helps train ollie. cmd-Z this anytime.
        </p>
      )}

      {flipDirection === 'just-off' && (
        <p
          role="status"
          aria-live="polite"
          data-testid="research-confirm"
          style={{
            ...styles.rowHint,
            textTransform: 'none',
            letterSpacing: 'normal',
            fontFamily: 'var(--font-system)',
            fontSize: 'var(--t-caption)',
            color: 'var(--ink-soft)',
            lineHeight: 'var(--lh-caption)',
            marginTop: '12px',
            maxWidth: 520,
          }}
        >
          off. no new text gets labeled. previously sent data stays — email
          support to delete.
        </p>
      )}
    </section>
  );
}

// ─── Security section (app-lock · 2026-05-18) ───────────────────────────────
//
// The opt-in for the app-lock curtain — a Face ID / fingerprint re-entry
// screen over the whole app on cold boot and resume-after-idle.
//
// DEFAULT OFF. Nobody gets surprise-locked: the user turns this on
// deliberately. When the device reports no biometric support the toggle
// reads as disabled with a quiet hint, rather than offering a switch that
// could only fail.
//
// Honest framing in the hint copy: the user is already signed in, the
// lock is a privacy curtain, not encryption. See lib/app-lock.ts.
//
// Exported so SecuritySection.test.tsx can mount it in isolation, same as
// ResearchSection — importing the whole SettingsScreen pulls store/react
// transitively, which vitest can't resolve in this workspace shape.

export function SecuritySection() {
  // The feature flag lives in shared.app_lock.enabled. Read it reactively
  // so an external flip (e.g. setAppLockEnabled clearing it) re-renders.
  const [enabled] = useStoreSlice<boolean>(
    APP_LOCK_SLICE,
    APP_LOCK_ENABLED_KEY,
    false,
  );

  // Resolve biometric support once. isBiometricSupported() is a sync
  // capability probe (WebAuthn presence / Capacitor native shell) — it
  // does NOT prompt, so it is safe to call on every render.
  const [supported] = useState<boolean>(() => isBiometricSupported());

  function handleChange(next: boolean) {
    if (!supported) return; // guarded — the toggle is non-interactive anyway
    // setAppLockEnabled also clears any live `locked` flag when turning
    // off, so the user can't strand themselves behind the curtain.
    setAppLockEnabled(next);
  }

  return (
    <section style={styles.section} aria-label="security">
      <h2 style={styles.sectionHeader}>security</h2>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>unlock with face id / fingerprint</p>
          <p style={styles.rowHint}>
            {supported
              ? 'covers ollie with a quick unlock when you open it or return to it after a while. you stay signed in — this just keeps your screen private.'
              : 'this device has no face id or fingerprint set up.'}
          </p>
        </div>
        {supported ? (
          <Toggle
            on={enabled}
            onChange={handleChange}
            ariaLabel="unlock with face id or fingerprint"
          />
        ) : (
          <span
            role="switch"
            aria-checked="false"
            aria-disabled="true"
            aria-label="unlock with face id or fingerprint (unavailable on this device)"
            title="no biometrics available on this device"
            style={{
              width: '44px',
              height: '24px',
              borderRadius: '12px',
              background: 'var(--ink-ghost)',
              position: 'relative',
              display: 'inline-block',
              flexShrink: 0,
              opacity: 0.4,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: '3px',
                left: '3px',
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: 'var(--bone)',
              }}
            />
          </span>
        )}
      </div>
    </section>
  );
}

// ─── About section ───────────────────────────────────────────────────────────

function AboutSection() {
  return (
    <section style={styles.section} aria-label="about">
      <h2 style={styles.sectionHeader}>about</h2>

      <div style={styles.row}>
        <p style={styles.rowLabel}>version</p>
        <span style={styles.rowValue}>{APP_VERSION}</span>
      </div>

      <div style={styles.row}>
        <p style={styles.rowLabel}>privacy policy</p>
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.linkBtn as React.CSSProperties}
        >
          read
        </a>
      </div>

      <div style={styles.row}>
        <p style={styles.rowLabel}>terms</p>
        <a
          href={TERMS_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.linkBtn as React.CSSProperties}
        >
          read
        </a>
      </div>

      <div style={styles.row}>
        <p style={styles.rowLabel}>support</p>
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.linkBtn as React.CSSProperties}
        >
          contact
        </a>
      </div>
    </section>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────

export function SettingsScreen({ auth, onBack, onSignedOut }: SettingsScreenProps) {
  // Stable user id for @ollie/consent. Mirrors the derivation in App.tsx
  // (Sprint B' router): pre-auth / local-dev builds fall back to
  // 'local-dev' so the toggle still round-trips through the package
  // even when Supabase is unwired.
  const userId = auth?.state().session?.user_id ?? 'local-dev';
  return (
    <main style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.topBar}>
          <button type="button" onClick={onBack} style={styles.back} aria-label="back">
            ← back
          </button>
        </div>

        <h1 style={styles.title}>settings.</h1>

        <AccountSection auth={auth} onSignedOut={onSignedOut} />
        <InviteSection />
        <NotificationsSection />
        <HealthSection />
        <FinanceSection />
        <PrivacySection />
        <SecuritySection />
        <ResearchSection userId={userId} />
        <AboutSection />
      </div>
    </main>
  );
}
