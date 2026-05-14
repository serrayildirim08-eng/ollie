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
 *   - shared.consent.necessary  — locked-ON in settings; only revocable
 *                                 by deleting the account
 *   - shared.consent.marketing  — bidirectional, default ON
 *
 * Voice: lowercase labels, sage active, DM Mono caps section headers.
 * Reached from HomeScreen.
 */

import React, { useState } from 'react';
import type { AuthClient } from '@ollie/auth';
import { exportBackup, envelopeToFileBytes, defaultFilename, importBackup } from '@ollie/backup';
import { useStoreSlice, store } from '../store';
import { SUPPORTED_COUNTRIES } from '../lib/country';
import { getAccount } from '../lib/account-boot';
import { readUserHash } from '../lib/user-hash';
import { getAppVersion } from '../lib/device';
import {
  hasSessionPassphrase,
  setSessionPassphrase,
  clearSessionPassphrase,
} from '../lib/encryption-boot';

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
    padding: '32px 24px 96px',
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

// ─── Privacy section ─────────────────────────────────────────────────────────

function PrivacySection() {
  // Consent rewrite (Sprint 6): two toggles only.
  //   - necessary: locked-ON. The only revocation path is delete-account.
  //   - marketing: bidirectional, default ON (set at sign-up by ConsentScreen).
  const [marketing, setMarketing] = useStoreSlice<boolean>('shared', 'consent.marketing', true);

  function handleMarketingChange(next: boolean) {
    setMarketing(next);
    // Consent audit — fire-and-forget. Gated on hasConsent(); every user
    // reaching Settings has consent.necessary=true so this always fires.
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

// ─── Encryption section ──────────────────────────────────────────────────────
//
// Wires the AES-GCM-256 snapshot path (work + goals) to a Settings-provided
// passphrase. The store.ts boot reads sessionStorage at launch; if missing,
// modules stay plaintext until the user saves a passphrase here. Saving
// re-invokes bootEncryption() so the encrypted snapshot is restored into the
// live store before the next render. Clearing requires a reload to drop the
// decrypted plaintext mirror — we warn the user before reload.
//
// Voice: dry editorial, no shame; sage accent on save. Min 8 chars. The
// confirm input prevents a typo'd passphrase from locking the user out.

function EncryptionSection() {
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  // Force a re-render after save/clear without subscribing to anything —
  // sessionStorage isn't reactive, so we read at render time + bump a tick
  // to refresh the status row.
  const [, setTick] = useState(0);
  const encrypted = hasSessionPassphrase();

  async function handleSave() {
    setErr('');
    if (pass.length < 8) {
      setErr('passphrase must be 8+ characters');
      return;
    }
    if (pass !== confirm) {
      setErr('confirm does not match');
      return;
    }
    setSaving(true);
    try {
      await setSessionPassphrase(store, pass);
      setPass('');
      setConfirm('');
      setOpen(false);
      setTick((t) => t + 1);
    } catch (e) {
      setErr('save failed: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleClear() {
    const ok = typeof window !== 'undefined'
      ? window.confirm(
          'clear passphrase? work + goals data on disk will stay encrypted but ollie won\'t decrypt them this session. the app will reload.',
        )
      : true;
    if (!ok) return;
    clearSessionPassphrase();
    if (typeof window !== 'undefined') window.location.reload();
  }

  return (
    <section style={styles.section} aria-label="encryption">
      <h2 style={styles.sectionHeader}>encryption</h2>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>status</p>
          <p style={styles.rowHint}>
            {encrypted
              ? 'work + goals snapshots encrypted at rest with your passphrase'
              : 'work + goals stored as plaintext on this device'}
          </p>
        </div>
        <span
          style={{
            ...styles.rowValue,
            color: encrypted ? 'var(--accent)' : 'var(--ink-faint)',
          }}
        >
          {encrypted ? 'encrypted' : 'plaintext'}
        </span>
      </div>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>{encrypted ? 'change passphrase' : 'set passphrase'}</p>
          <p style={styles.rowHint}>aes-gcm 256 · derived via pbkdf2 100k iterations</p>
        </div>
        <button
          type="button"
          onClick={() => { setOpen((o) => !o); setErr(''); }}
          style={styles.linkBtn}
        >
          {open ? 'cancel' : (encrypted ? 'change' : 'set')}
        </button>
      </div>

      {open && (
        <div
          style={{
            padding: '20px 0 4px',
            display: 'grid',
            gap: '12px',
          }}
        >
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={styles.rowHint}>passphrase · 8+ chars</span>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="new-password"
              aria-label="encryption passphrase"
              style={{
                padding: '10px 12px',
                background: 'var(--bone)',
                border: '1px solid var(--rule)',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-body)',
                color: 'var(--ink)',
                outline: 'none',
              }}
            />
          </label>
          <label style={{ display: 'grid', gap: '6px' }}>
            <span style={styles.rowHint}>confirm</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              aria-label="confirm passphrase"
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
              style={{
                padding: '10px 12px',
                background: 'var(--bone)',
                border: '1px solid var(--rule)',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-body)',
                color: 'var(--ink)',
                outline: 'none',
              }}
            />
          </label>
          {err && (
            <p style={{ ...styles.rowHint, color: 'var(--umber)' }}>{err}</p>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !pass || !confirm}
              style={{
                padding: '10px 20px',
                background: saving || !pass || !confirm ? 'transparent' : 'var(--accent)',
                color: saving || !pass || !confirm ? 'var(--ink-faint)' : 'var(--bone)',
                border: `1px solid ${saving || !pass || !confirm ? 'var(--rule)' : 'var(--accent)'}`,
                borderRadius: '20px',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-caption)',
                letterSpacing: 'var(--ls-caps)',
                textTransform: 'uppercase',
                cursor: saving || !pass || !confirm ? 'default' : 'pointer',
              }}
            >
              {saving ? 'saving…' : 'save'}
            </button>
          </div>
          <p style={{ ...styles.rowHint, marginTop: '4px', lineHeight: 1.5 }}>
            ollie can&apos;t recover this. write it down somewhere safe. losing the
            passphrase means losing the work + goals data on this device.
          </p>
        </div>
      )}

      {encrypted && !open && (
        <div style={styles.row}>
          <div>
            <p style={styles.rowLabel}>clear passphrase</p>
            <p style={styles.rowHint}>app reloads · data stays encrypted on disk</p>
          </div>
          <button type="button" onClick={handleClear} style={styles.destructive}>
            clear
          </button>
        </div>
      )}
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
        <NotificationsSection />
        <PrivacySection />
        <EncryptionSection />
        <AboutSection />
      </div>
    </main>
  );
}
