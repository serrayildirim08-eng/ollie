/**
 * ExportPanel — Settings → Data → Export entry point for the Money module.
 *
 * Two actions:
 *   1. Export CSV — full transaction dump, RFC 4180.
 *   2. Export annual ADHD-tax report (PDF) — editorial 4-page layout;
 *      see renderADHDTaxReportPDF.ts.
 *
 * Both paths are encrypted with a passphrase before download. There is
 * no plaintext escape hatch — tax records leave the device sealed.
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
import {
  renderADHDTaxReportPDF,
  type JsPDFFactory,
} from './renderADHDTaxReportPDF';

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
          boxSizing: 'border-box',
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
  /** Test seam — inject a fake jsPDF factory. Production defaults to dynamic-import. */
  jsPDFFactory?: JsPDFFactory;
  /** Test seam — override the year picker. */
  yearOverride?: number;
}

type PendingKind = 'csv' | 'annual';

// PDF bytes → base64 (so encryptExport, which takes a string, can wrap
// the binary payload inside its v1 envelope verbatim).
function bytesToBase64Local(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  const g: { btoa?: (s: string) => string } = globalThis as unknown as {
    btoa?: (s: string) => string;
  };
  if (typeof g.btoa === 'function') return g.btoa(bin);
  // Buffer fallback (Node / jsdom-without-btoa).
  return Buffer.from(bytes).toString('base64');
}

export function ExportPanel({ records: recordsProp, jsPDFFactory, yearOverride }: ExportPanelProps) {
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
        const year = yearOverride ?? new Date().getFullYear();
        const report = exportADHDTaxReport(records, year);
        // Render the 4-page PDF, then base64-wrap the bytes so the v1
        // envelope (which stores text) can carry the binary payload.
        const buf = (await renderADHDTaxReportPDF(report, {
          year,
          jsPDFFactory,
          output: 'arraybuffer',
        })) as ArrayBuffer;
        const pdfB64 = bytesToBase64Local(new Uint8Array(buf));
        const envelopeJson = await encryptExport(pdfB64, passphrase, CRYPTO, {
          contentType: 'application/pdf;encoding=base64',
        });
        triggerDownload(
          envelopeJson,
          `adhd-tax-report-${year}.enc`,
          'application/json',
        );
        setMessage(`exported ${year} report (encrypted).`);
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
          a four-page pdf. cover, month-by-month, categorized, year-over-year.
          encrypted in the same envelope as the csv path.
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
