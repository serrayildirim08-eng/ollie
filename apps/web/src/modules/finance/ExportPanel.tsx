/**
 * ExportPanel — Settings → Data → Export entry point for the Money module.
 *
 * Two actions:
 *   1. Export CSV — full transaction dump, RFC 4180.
 *   2. Export annual ADHD-tax report — structured data only for now;
 *      the PDF rendering target is parked until a tiny PDF lib (jspdf
 *      or pdfmake) is added to package.json. Until then this button
 *      downloads a .json with the report structure so the user can
 *      hand it to a CPA or import to Numbers/Excel.
 *
 * Encryption: passphrase required (UX rule — tax records).
 *
 * Banned-phrase audit: lowercase factual copy throughout.
 */

import React, { useState } from 'react';
import type { FinanceRecord } from '@ollie/logic/finance';
import {
  exportToCSV,
  exportADHDTaxReport,
  encryptExport,
} from '@ollie/logic/finance';
import type { CryptoPrimitives } from '@ollie/logic/finance';
import {
  randomSalt,
  deriveKey,
  encryptData,
  bytesToBase64,
} from '@ollie/crypto';
import { useStoreSlice } from '../../store';

// ─── style tokens (match FinanceModule dark palette) ─────────────────────

const T = {
  text:    'rgba(255,255,255,0.88)',
  muted:   'rgba(255,255,255,0.48)',
  faint:   'rgba(255,255,255,0.28)',
  border:  'rgba(255,255,255,0.08)',
  paper:   'rgba(255,255,255,0.03)',
  accent:  '#C8A26A',
  inputBg: 'rgba(255,255,255,0.06)',
} as const;

const labelStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 9,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: T.muted,
};

const buttonStyle: React.CSSProperties = {
  background: T.inputBg,
  border: `1px solid ${T.border}`,
  color: T.text,
  padding: '10px 14px',
  borderRadius: 8,
  fontFamily: "'DM Mono', monospace",
  fontSize: 11,
  cursor: 'pointer',
  letterSpacing: '0.05em',
};

const inputStyle: React.CSSProperties = {
  background: T.inputBg,
  border: `1px solid ${T.border}`,
  color: T.text,
  padding: '8px 10px',
  borderRadius: 8,
  fontFamily: "'DM Mono', monospace",
  fontSize: 11,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const MIN_PASSPHRASE = 16;

// ─── crypto primitives bound to the real @ollie/crypto ───────────────────

const CRYPTO: CryptoPrimitives = {
  randomSalt,
  deriveKey,
  encryptData,
  bytesToBase64,
};

// ─── helpers ─────────────────────────────────────────────────────────────

function triggerDownload(content: string, filename: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function todayISO(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

// ─── passphrase modal ────────────────────────────────────────────────────

interface PassphraseModalProps {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (passphrase: string) => void;
}

function PassphraseModal({ open, busy, onCancel, onSubmit }: PassphraseModalProps) {
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(false);
  const tooShort = value.length > 0 && value.length < MIN_PASSPHRASE;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="passphrase to encrypt this export"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#0E0C14',
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: 24,
          width: 'min(440px, 92vw)',
        }}
      >
        <p style={{ ...labelStyle, marginBottom: 12 }}>encrypt this export</p>
        <p style={{ color: T.muted, fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
          choose a passphrase. you will need it to open this file later.
          16+ characters. ollie cannot recover it for you.
        </p>
        <input
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="16+ character passphrase"
          aria-label="passphrase"
          autoFocus
          disabled={busy}
          style={inputStyle}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <input
            id="show-pp"
            type="checkbox"
            checked={shown}
            onChange={(e) => setShown(e.target.checked)}
            disabled={busy}
          />
          <label htmlFor="show-pp" style={{ color: T.muted, fontSize: 11 }}>
            show
          </label>
          {tooShort && (
            <span style={{ color: T.accent, fontSize: 11, marginLeft: 'auto' }}>
              {MIN_PASSPHRASE - value.length} more
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{ ...buttonStyle, color: T.muted }}
          >
            cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(value)}
            disabled={busy || value.length < MIN_PASSPHRASE}
            style={{
              ...buttonStyle,
              color: value.length >= MIN_PASSPHRASE ? T.text : T.faint,
              borderColor: value.length >= MIN_PASSPHRASE ? T.accent : T.border,
            }}
          >
            {busy ? 'encrypting...' : 'encrypt + download'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ExportPanel ─────────────────────────────────────────────────────────

export interface ExportPanelProps {
  /** Optional override (used in tests). Defaults to store slice. */
  records?: FinanceRecord[];
}

type PendingKind = 'csv' | 'annual';

export function ExportPanel({ records: recordsProp }: ExportPanelProps) {
  const [storeRecords] = useStoreSlice<FinanceRecord[]>('finance', 'records', []);
  const records = recordsProp ?? storeRecords;

  const [pending, setPending] = useState<PendingKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>('');

  async function handleEncryptAndDownload(passphrase: string) {
    if (!pending) return;
    setBusy(true);
    setMessage('');
    try {
      const today = todayISO();
      if (pending === 'csv') {
        const csv = exportToCSV(records);
        const envelopeJson = await encryptExport(csv, passphrase, CRYPTO, {
          contentType: 'text/csv',
        });
        triggerDownload(
          envelopeJson,
          `ollie-finance-${today}.csv.enc.json`,
          'application/json',
        );
        setMessage(`exported ${records.length} records (encrypted).`);
      } else if (pending === 'annual') {
        const year = new Date().getFullYear();
        const report = exportADHDTaxReport(records, year);
        // PDF rendering deferred — see note at top of file. Until a PDF
        // lib lands we ship the structured JSON so the report is still
        // useful at tax time.
        const envelopeJson = await encryptExport(
          JSON.stringify(report, null, 2),
          passphrase,
          CRYPTO,
          { contentType: 'application/json' },
        );
        triggerDownload(
          envelopeJson,
          `ollie-tax-report-${year}.json.enc.json`,
          'application/json',
        );
        setMessage(`exported ${year} report (encrypted). pdf rendering coming.`);
      }
      setPending(null);
    } catch (e) {
      setMessage('export failed. ' + ((e as Error)?.message ?? 'unknown error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="finance export"
      style={{
        padding: 16,
        background: T.paper,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
      }}
    >
      <p style={labelStyle}>export</p>
      <p style={{ color: T.muted, fontSize: 12, lineHeight: 1.6, margin: '8px 0 16px' }}>
        all exports are encrypted with a passphrase you choose. tax records stay on
        your device until you share them.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          type="button"
          onClick={() => setPending('csv')}
          aria-label="export csv"
          style={buttonStyle}
        >
          export csv ({records.length} records)
        </button>
        <button
          type="button"
          onClick={() => setPending('annual')}
          aria-label="export annual adhd-tax report"
          style={buttonStyle}
        >
          export annual adhd-tax report (pdf)
        </button>
        <p style={{ color: T.faint, fontSize: 10, lineHeight: 1.5, margin: '4px 0 0' }}>
          pdf rendering is in progress. for now the annual report exports as
          structured json so a cpa or spreadsheet can open it.
        </p>
      </div>

      {message && (
        <p
          role="status"
          style={{
            color: T.text,
            fontSize: 11,
            marginTop: 16,
            padding: '8px 10px',
            background: T.inputBg,
            borderRadius: 6,
            fontFamily: "'DM Mono', monospace",
          }}
        >
          {message}
        </p>
      )}

      <PassphraseModal
        open={pending != null}
        busy={busy}
        onCancel={() => {
          if (!busy) setPending(null);
        }}
        onSubmit={handleEncryptAndDownload}
      />
    </section>
  );
}

export default ExportPanel;
