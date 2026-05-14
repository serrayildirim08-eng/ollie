/**
 * ImpulsePauseModal — 24-hour hold sheet for non-essential variable purchases.
 *
 * Opt-in only. Surfaces after the user has filled out the transaction draft
 * but before it commits. Shows:
 *   - amount
 *   - % of this-month variable spend it represents
 *   - up to 5 similar past purchases (last 90d, same merchant or category)
 *   - 24h countdown timer
 *
 * Mirrors the deadpan voice + DM-Mono/DM-Serif palette of FinanceModule.
 *
 * Persistence is owned by FinanceModule via the `finance.pendingPauses` store
 * slice; this component is presentational + emits two callbacks.
 *
 * Brand voice locked: "hold 24 hours", "didn't buy", "saved". No
 * encouragement, no exclamation, no second-person address.
 */

import React, { useEffect, useMemo, useState } from 'react';

// ─── shared types ──────────────────────────────────────────────────────────

export interface PendingPause {
  /** stable id, mkId('pause-…') */
  id: string;
  amount: number;
  merchant: string;
  category: string;
  /** when pause started */
  ts: number;
  /** when 24h window closes */
  expires_at: number;
  /** snapshot to commit on "bought" outcome */
  draft: {
    returnable_until: number | null;
  };
}

export interface SimilarPurchase {
  ts: number;
  amount: number;
  merchant: string;
  category: string;
}

interface Props {
  open: boolean;
  pause: PendingPause | null;
  /** % (0–100) of this-month variable spend the pending amount represents */
  variableBudgetPct: number | null;
  /** sample of similar past purchases, last 90d, same merchant or category */
  similar: SimilarPurchase[];
  /** "didn't buy" — increments saved counter, drops the pause */
  onSkip: (pause: PendingPause) => void;
  /** "bought anyway" — commits as a transaction immediately */
  onPurchase: (pause: PendingPause) => void;
  /** dismiss without resolving — pause stays pending in store */
  onClose: () => void;
}

// ─── palette (mirrors FinanceModule "T" tokens) ────────────────────────────

const T = {
  text:    'rgba(255,255,255,0.88)',
  muted:   'rgba(255,255,255,0.48)',
  faint:   'rgba(255,255,255,0.28)',
  border:  'rgba(255,255,255,0.08)',
  paper:   'rgba(255,255,255,0.03)',
  accent:  '#C8A26A',
  inputBg: 'rgba(255,255,255,0.06)',
} as const;

// ─── helpers ───────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));
}

function fmtCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '00 : 00 : 00';
  const total = Math.floor(msRemaining / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)} : ${pad(m)} : ${pad(s)}`;
}

function fmtRelativeDate(ts: number, now: number): string {
  const days = Math.max(0, Math.floor((now - ts) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ─── styles ────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.62)',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const sheet: React.CSSProperties = {
  width: '100%',
  maxWidth: 460,
  background: '#14130F',
  border: `1px solid ${T.border}`,
  borderRadius: 18,
  padding: '32px 32px 26px',
  boxSizing: 'border-box',
  color: T.text,
  fontFamily: "'DM Sans', sans-serif",
  position: 'relative',
};

const closeBtn: React.CSSProperties = {
  position: 'absolute',
  top: 14,
  right: 16,
  background: 'transparent',
  border: 'none',
  color: T.faint,
  fontFamily: "'DM Mono', monospace",
  fontSize: 18,
  cursor: 'pointer',
  padding: '4px 8px',
  lineHeight: 1,
};

const labelStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 9,
  letterSpacing: '0.24em',
  textTransform: 'uppercase',
  color: T.muted,
};

const heroStyle: React.CSSProperties = {
  fontFamily: "'DM Serif Display', serif",
  fontSize: 40,
  fontWeight: 400,
  color: T.text,
  margin: '8px 0 0',
  lineHeight: 1,
};

const subStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 11,
  letterSpacing: '0.08em',
  color: T.muted,
  marginTop: 8,
};

const countdownStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 22,
  letterSpacing: '0.14em',
  color: T.accent,
  textAlign: 'center',
  padding: '14px 0',
};

const sectionDivider: React.CSSProperties = {
  borderTop: `1px solid ${T.border}`,
  margin: '20px 0 14px',
};

const buttonRow: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  marginTop: 18,
  flexWrap: 'wrap',
};

const primaryBtn: React.CSSProperties = {
  flex: '1 1 auto',
  background: 'transparent',
  color: T.text,
  border: `1px solid ${T.accent}`,
  borderRadius: 24,
  padding: '12px 18px',
  fontFamily: "'DM Mono', monospace",
  fontSize: 10,
  letterSpacing: '0.20em',
  textTransform: 'uppercase' as const,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  ...primaryBtn,
  borderColor: T.border,
  color: T.muted,
};

// ─── component ─────────────────────────────────────────────────────────────

export function ImpulsePauseModal({
  open,
  pause,
  variableBudgetPct,
  similar,
  onSkip,
  onPurchase,
  onClose,
}: Props): JSX.Element | null {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!open || !pause) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, pause]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const msRemaining = useMemo(() => {
    if (!pause) return 0;
    return Math.max(0, pause.expires_at - now);
  }, [pause, now]);

  if (!open || !pause) return null;

  const expired = msRemaining <= 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="impulse hold"
      style={overlay}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={sheet}>
        <button type="button" aria-label="close" onClick={onClose} style={closeBtn}>×</button>

        <div style={labelStyle}>hold 24 hours</div>
        <h2 style={heroStyle}>${fmtMoney(pause.amount)}.</h2>
        <div style={subStyle}>
          {pause.merchant ? `${pause.merchant.toLowerCase()} · ` : ''}{pause.category}
          {variableBudgetPct != null && (
            <> · {variableBudgetPct < 1 ? '<1' : Math.round(variableBudgetPct)}% of this month's variable</>
          )}
        </div>

        <div aria-live="polite" style={countdownStyle}>
          {expired ? 'window passed' : fmtCountdown(msRemaining)}
        </div>

        {similar.length > 0 && (
          <>
            <div style={sectionDivider} />
            <div style={labelStyle}>similar · last 90 days</div>
            <div style={{ marginTop: 10 }}>
              {similar.slice(0, 5).map((s, i) => (
                <div
                  key={`${s.ts}-${i}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '6px 0',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    color: T.muted,
                    letterSpacing: '0.04em',
                    borderBottom: i < Math.min(similar.length, 5) - 1 ? `1px solid ${T.border}` : 'none',
                  }}
                >
                  <span>
                    ${fmtMoney(s.amount)}
                    {s.merchant ? ` · ${s.merchant.toLowerCase()}` : ''}
                  </span>
                  <span>{fmtRelativeDate(s.ts, now)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={buttonRow}>
          <button
            type="button"
            onClick={() => onSkip(pause)}
            style={primaryBtn}
          >
            didn't buy
          </button>
          <button
            type="button"
            onClick={() => onPurchase(pause)}
            style={secondaryBtn}
          >
            bought anyway
          </button>
        </div>

        <div style={{ ...labelStyle, marginTop: 14, color: T.faint, letterSpacing: '0.18em' }}>
          pause stays pending if you close this. resolve later from the held list.
        </div>
      </div>
    </div>
  );
}

// ─── pure helpers exported for tests + the FinanceModule wiring ────────────

/**
 * Sum of variable-category transaction outflows from the current month.
 * "variable" = not in `bills` and not in `subscriptions`. Includes
 * groceries, coffee, takeout, transport, other.
 */
export function thisMonthVariableTotal(
  transactions: Array<{ ts: number; amount: number; category: string; direction?: 'in' | 'out' }>,
  now: number,
): number {
  const d = new Date(now);
  const startOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  let total = 0;
  for (const t of transactions) {
    if (t.ts < startOfMonth) continue;
    if (t.direction === 'in') continue;
    if (t.category === 'bills' || t.category === 'subscriptions') continue;
    total += t.amount;
  }
  return total;
}

export function pctOfVariable(amount: number, monthVariable: number): number | null {
  if (monthVariable <= 0) return null;
  return (amount / (monthVariable + amount)) * 100;
}

export function findSimilarPurchases(
  transactions: Array<{ ts: number; amount: number; merchant: string; category: string }>,
  draft: { merchant: string; category: string },
  now: number,
  windowDays = 90,
): SimilarPurchase[] {
  const cutoff = now - windowDays * 86_400_000;
  const merch = draft.merchant.trim().toLowerCase();
  const out: SimilarPurchase[] = [];
  for (const t of transactions) {
    if (t.ts < cutoff) continue;
    const m = (t.merchant ?? '').trim().toLowerCase();
    const merchantMatch = merch.length > 0 && m.length > 0 && (m === merch || m.includes(merch) || merch.includes(m));
    const categoryMatch = !merch && t.category === draft.category; // only fall back to category if no merchant
    if (merchantMatch || categoryMatch) {
      out.push({ ts: t.ts, amount: t.amount, merchant: t.merchant, category: t.category });
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

/**
 * Eligibility: only non-essential variable categories surface the hold.
 * bills, subscriptions, groceries → no hold prompt.
 */
export function isHoldEligible(category: string): boolean {
  return category === 'coffee' || category === 'takeout' || category === 'transport' || category === 'other';
}
