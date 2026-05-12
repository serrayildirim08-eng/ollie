/**
 * SettingsScreen — single-page settings (Sprint 5 · F4)
 *
 * Sections:
 *   - Account       email · sign-out · delete-account (confirm modal)
 *   - Notifications daily budget slider 1–10 (default 4) · per-category mute toggles
 *   - Privacy       spending-research (gates /garden) · cycle opt-in ·
 *                   astrology opt-in (gates daily reading notif) · export · import
 *   - About         version · privacy policy link · terms link
 *
 * Voice: lowercase labels, sage active, DM Mono caps section headers.
 * Reached from HomeScreen.
 */

import React, { useState } from 'react';
import type { AuthClient } from '@ollie/auth';
import { exportBackup, envelopeToFileBytes, defaultFilename, importBackup } from '@ollie/backup';
import { useStoreSlice, store } from '../store';
import { SUPPORTED_COUNTRIES } from '../lib/country';

const APP_VERSION = '0.0.1';
const PRIVACY_URL = 'https://ollie.computer/privacy';
const TERMS_URL = 'https://ollie.computer/terms';

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

  async function handleSignOut() {
    if (!auth) return;
    await auth.signOut();
    onSignedOut();
  }

  function handleDeleteAccount() {
    // Local-first delete: clear all modules from localStorage. The
    // Supabase row is left orphaned (no server delete endpoint in
    // current API surface) — that's documented and acceptable for
    // alpha. Future: add api.deleteUser().
    try {
      if (typeof localStorage !== 'undefined') {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('ollie:')) keys.push(k);
        }
        for (const k of keys) localStorage.removeItem(k);
      }
    } catch { /* non-fatal */ }
    setConfirmDelete(false);
    onSignedOut();
    // Hard reload to drop in-memory state.
    if (typeof window !== 'undefined') window.location.reload();
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
          <p style={styles.rowHint}>removes local data · encrypted server row stays orphaned</p>
        </div>
        <button type="button" onClick={() => setConfirmDelete(true)} style={styles.destructive}>
          delete
        </button>
      </div>

      <ConfirmModal
        open={confirmDelete}
        title="delete account?"
        body="this wipes ollie's local data from this device. the encrypted server row stays but is unreadable without your passphrase. there is no undo."
        confirmLabel="delete"
        onConfirm={handleDeleteAccount}
        onCancel={() => setConfirmDelete(false)}
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
  const [spendingResearch, setSpendingResearch] = useStoreSlice<boolean>('shared', 'consent.spending_research', false);
  const [cycleOptIn, setCycleOptIn] = useStoreSlice<boolean>('shared', 'consent.cycle', false);
  const [astroOptIn, setAstroOptIn] = useStoreSlice<boolean>('shared', 'consent.astrology', false);
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
          <p style={styles.rowLabel}>spending research</p>
          <p style={styles.rowHint}>anonymous · gates /garden access</p>
        </div>
        <Toggle on={spendingResearch} onChange={setSpendingResearch} ariaLabel="spending research opt-in" />
      </div>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>cycle tracking</p>
          <p style={styles.rowHint}>menstrual cycle patterns surface in dashboard</p>
        </div>
        <Toggle on={cycleOptIn} onChange={setCycleOptIn} ariaLabel="cycle tracking opt-in" />
      </div>

      <div style={styles.row}>
        <div>
          <p style={styles.rowLabel}>astrology</p>
          <p style={styles.rowHint}>gates daily reading · transit pings</p>
        </div>
        <Toggle on={astroOptIn} onChange={setAstroOptIn} ariaLabel="astrology opt-in" />
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
        <AboutSection />
      </div>
    </main>
  );
}
