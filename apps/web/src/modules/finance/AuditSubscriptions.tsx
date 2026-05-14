/**
 * AuditSubscriptions — Money module v2 surface.
 *
 * Heuristic subscription dormancy audit. For each active subscription,
 * cross-references the user's charge history with their brain-dump
 * mentions to surface "you've been paying for this but stopped writing
 * about it" candidates.
 *
 * Data flow (all on-device):
 *   - finance.subscriptions       → StoredSub[]    (user-managed list)
 *   - finance.records             → FinanceRecord[] (charge log)
 *   - dump.items                  → DumpEntry[]   (already-decrypted)
 *   - finance.audit.cancelled     → cancellation receipts
 *   - finance.audit.snoozes       → per-sub snooze deadlines (mirrored
 *                                   onto the sub row via snoozeUntil)
 *
 * Voice contract: lowercase, no exclamation marks, no "you should",
 * sourced evidence statements. All copy via getString(locale, ...).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  scoreDormancy,
  summarize,
  getCancelUrl,
  isAppleManaged,
  type DormancySignal,
  type StoredSubLike,
  type BrainDumpEntry,
} from '@ollie/logic/finance';
import type { FinanceRecord } from '@ollie/logic/finance';
import { emit } from '@ollie/events';
import { getString, type Locale } from '../../i18n';
import { useStoreSlice } from '../../store';

// ─── types ─────────────────────────────────────────────────────────────

interface StoredSub {
  id: string;
  name: string;
  amount: number;
  period: 'monthly' | 'yearly';
  marked_to_cancel_at?: number | null;
  ts: number;
  // audit-feature extensions; older rows omit these
  snoozeUntil?: number | null;
  alias_key?: string | null;
  cancel_state?: 'active' | 'cancelled_pending' | 'cancelled_confirmed';
  cancel_claimed_at?: number;
}

interface CancellationReceipt {
  sub_id: string;
  sub_name: string;
  monthly_amount: number;
  cancelled_at: number;
}

interface ManualReviewState {
  // sub_id -> { ts, answer } where answer 'yes' = used recently,
  // 'no' = stopped. Stored to persist user responses to the manual
  // yes/no card across sessions.
  [subId: string]: { ts: number; answer: 'yes' | 'no' };
}

interface ReturnPrompt {
  sub_id: string;
  sub_name: string;
  cancel_claimed_at: number;
}

// ─── shared style helpers (v2 design system, all tokens via CSS vars) ──

const inkAnchor: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--ink)',
  color: 'var(--accent)',
  width: 32,
  height: 32,
  fontFamily: 'var(--font-editor)',
  fontSize: 18,
  fontVariantNumeric: 'tabular-nums lining-nums',
  letterSpacing: '-0.02em',
  borderRadius: 2,
};

const marginalia: React.CSSProperties = {
  fontFamily: 'var(--font-editor)',
  fontSize: 24,
  color: 'var(--ink-ghost)',
  lineHeight: 1,
  marginRight: 12,
};

const eyebrow: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'lowercase',
  color: 'var(--ink-soft)',
  fontWeight: 500,
};

const meta: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  letterSpacing: '0.18em',
  textTransform: 'lowercase',
  color: 'var(--ink-faint)',
};

const bodyText: React.CSSProperties = {
  fontFamily: 'var(--font-system)',
  fontSize: 17,
  color: 'var(--ink-soft)',
  lineHeight: 1.55,
};

const amount: React.CSSProperties = {
  fontFamily: 'var(--font-system)',
  fontSize: 17,
  fontWeight: 500,
  letterSpacing: '-0.005em',
  fontVariantNumeric: 'tabular-nums lining-nums',
  color: 'var(--ink)',
};

const heroNumeral: React.CSSProperties = {
  fontFamily: 'var(--font-editor)',
  fontSize: 76,
  lineHeight: 1,
  letterSpacing: '-0.022em',
  color: 'var(--ink)',
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const sectionHeading: React.CSSProperties = {
  fontFamily: 'var(--font-editor)',
  fontSize: 22,
  color: 'var(--ink)',
  letterSpacing: '-0.010em',
  lineHeight: 1.2,
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.10em',
  padding: '8px 14px',
  borderRadius: 0,
  cursor: 'pointer',
  minHeight: 44,
  textAlign: 'left',
};

const primaryBtn: React.CSSProperties = {
  ...ghostBtn,
  border: '1px solid var(--accent)',
  color: 'var(--accent)',
};

// ─── helpers ───────────────────────────────────────────────────────────

function fmtMonthly(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0.00';
  return n.toFixed(2);
}

function pluralOne(locale: Locale, base: string, n: number, ...args: string[]): string {
  const key = n === 1 ? `${base}_one` : `${base}_many`;
  let s = getString(locale, key);
  if (n !== 1) s = s.replace('${0}', String(n));
  // Substitute remaining args
  if (n === 1) {
    args.forEach((v, i) => { s = s.replace(`\${${i}}`, v); });
  } else {
    args.forEach((v, i) => { s = s.replace(`\${${i + 1}}`, v); });
  }
  return s;
}

function buildEvidence(locale: Locale, sig: DormancySignal): string {
  switch (sig.recommendation) {
    case 'cancel_candidate': {
      if (sig.daysSinceMention != null) {
        return pluralOne(
          locale,
          'finance.audit.evidence_paid_unwritten',
          sig.chargesIn90d,
          String(sig.daysSinceMention),
        );
      }
      return pluralOne(
        locale,
        'finance.audit.evidence_paid_never_written',
        sig.chargesIn90d,
      );
    }
    case 'review': {
      if (sig.daysSinceMention != null) {
        return pluralOne(
          locale,
          'finance.audit.evidence_review',
          sig.mentionsIn90d,
          String(sig.daysSinceMention),
        );
      }
      return pluralOne(locale, 'finance.audit.evidence_review', sig.mentionsIn90d);
    }
    case 'active':
      return getString(locale, 'finance.audit.evidence_active');
    case 'too_soon':
      return getString(locale, 'finance.audit.evidence_too_soon')
        .replace('${0}', String(sig.daysSinceCreated));
    case 'inconclusive':
      if (!sig.aliasKey) {
        return getString(locale, 'finance.audit.evidence_inconclusive_uncatalogued');
      }
      return getString(locale, 'finance.audit.evidence_inconclusive_no_charges');
  }
}

function urlDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Open an external URL. Prefer Capacitor Browser when running inside
 * the native shell — it gives an SFSafariViewController on iOS that
 * keeps the user inside the app. Falls back to window.open on plain
 * web. Capacitor Browser is loaded dynamically so the web app does not
 * require the plugin to be installed.
 */
async function openExternal(url: string): Promise<void> {
  try {
    // Indirect dynamic import keeps TS module resolution out of the
    // way — the @capacitor/browser package is loaded at runtime only
    // when the native shell has installed it. On plain web the import
    // throws and we fall through to window.open.
    const moduleId = '@capacitor/browser';
    const mod = await (Function('m', 'return import(m)') as (m: string) => Promise<unknown>)(moduleId)
      .catch(() => null);
    const browser = (mod as { Browser?: { open?: (opts: { url: string }) => Promise<void> } } | null)?.Browser;
    if (browser && typeof browser.open === 'function') {
      await browser.open({ url });
      return;
    }
  } catch {
    // fall through to window.open
  }
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(url, '_blank', 'noopener');
  }
}

/**
 * Subscribe to Capacitor App `appStateChange`. When the app returns to
 * the foreground after a cancel-flow detour, the caller surfaces the
 * "did you cancel?" prompt. Loaded dynamically; no-op on plain web.
 */
function useCapacitorReturnTrigger(onReturn: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import(
          /* @vite-ignore */ '@capacitor/app'
        ).catch(() => null);
        if (cancelled || !mod || typeof mod.App?.addListener !== 'function') return;
        const handle = await mod.App.addListener('appStateChange', (state: { isActive?: boolean }) => {
          if (state && state.isActive) onReturn();
        });
        if (cancelled) {
          try { handle?.remove?.(); } catch { /* noop */ }
          return;
        }
        cleanup = () => { try { handle?.remove?.(); } catch { /* noop */ } };
      } catch {
        // dynamic import failed; window focus fallback below
      }
    })();
    // Web fallback — window focus event
    const onFocus = () => onReturn();
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      if (cleanup) cleanup();
      if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
    };
  }, [enabled, onReturn]);
}

// ─── component ─────────────────────────────────────────────────────────

export interface AuditSubscriptionsProps {
  onBack?: () => void;
}

export function AuditSubscriptions({ onBack }: AuditSubscriptionsProps) {
  const [settings] = useStoreSlice<{ locale?: string }>('shared', 'settings', {});
  const localeRaw = settings?.locale ?? 'en';
  const locale: Locale = localeRaw === 'es' ? 'es' : 'en';
  const t = (k: string) => getString(locale, `finance.audit.${k}`);

  const [subs, setSubs] = useStoreSlice<StoredSub[]>('finance', 'subscriptions', []);
  const [records] = useStoreSlice<FinanceRecord[]>('finance', 'records', []);
  const [dumps] = useStoreSlice<BrainDumpEntry[]>('dump', 'items', []);
  const [cancellations, setCancellations] = useStoreSlice<CancellationReceipt[]>(
    'finance', 'audit_cancellations', [],
  );
  const [manualReview, setManualReview] = useStoreSlice<ManualReviewState>(
    'finance', 'audit_manual_review', {},
  );
  const [returnPrompt, setReturnPrompt] = useStoreSlice<ReturnPrompt | null>(
    'finance', 'audit_return_prompt', null,
  );

  const [tick, setTick] = useState(0);

  // Surface the "did you cancel?" prompt on app return.
  const onAppReturn = useCallback(() => {
    setTick((x) => x + 1);
  }, []);
  useCapacitorReturnTrigger(onAppReturn, returnPrompt != null);

  const now = Date.now();
  // tick is read to invalidate the memo when the app returns to fg.
  void tick;

  const subsForScoring: StoredSubLike[] = useMemo(() => {
    return subs.map((s) => ({
      id: s.id,
      name: s.name,
      amount: s.amount,
      period: s.period,
      ts: s.ts,
      alias_key: s.alias_key ?? null,
      snoozeUntil: s.snoozeUntil ?? null,
    }));
  }, [subs]);

  const signals = useMemo(
    () => scoreDormancy(subsForScoring, records, dumps, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subsForScoring, records, dumps],
  );

  const summary = useMemo(
    () => summarize(signals, subsForScoring),
    [signals, subsForScoring],
  );

  const candidates = signals.filter((s) => s.recommendation === 'cancel_candidate');
  const reviewItems = signals.filter((s) => s.recommendation === 'review');
  const inconclusive = signals.filter((s) => s.recommendation === 'inconclusive');
  const tooSoon = signals.filter((s) => s.recommendation === 'too_soon');

  const hasAnyRows = candidates.length + reviewItems.length + inconclusive.length + tooSoon.length > 0;
  const empty = subs.length === 0;

  // ── actions ─────────────────────────────────────────────────────────

  function snooze(subId: string, days: number) {
    const next = subs.map((s) =>
      s.id === subId ? { ...s, snoozeUntil: Date.now() + days * 86_400_000 } : s,
    );
    setSubs(next);
  }

  async function cancelFlow(sig: DormancySignal) {
    const url = getCancelUrl(sig.aliasKey);
    if (!url) return;
    // mark pending so on return we know which sub to prompt about
    const next = subs.map((s) =>
      s.id === sig.subscriptionId
        ? { ...s, cancel_state: 'cancelled_pending' as const, cancel_claimed_at: Date.now() }
        : s,
    );
    setSubs(next);
    setReturnPrompt({
      sub_id: sig.subscriptionId,
      sub_name: sig.subscriptionName,
      cancel_claimed_at: Date.now(),
    });
    await openExternal(url);
  }

  function confirmCancelled() {
    if (!returnPrompt) return;
    const sub = subs.find((s) => s.id === returnPrompt.sub_id);
    if (sub) {
      const monthly = sub.period === 'yearly' ? sub.amount / 12 : sub.amount;
      const receipt: CancellationReceipt = {
        sub_id: sub.id,
        sub_name: sub.name,
        monthly_amount: monthly,
        cancelled_at: Date.now(),
      };
      setCancellations([...cancellations, receipt]);
      try {
        emit('finance:subscription_cancelled', {
          pattern_id: sub.id,
          merchant: sub.name,
          monthly_amount: monthly,
          ts: Date.now(),
        });
      } catch { /* registry warning ok */ }
      // remove from active subs
      setSubs(subs.filter((s) => s.id !== sub.id));
    }
    setReturnPrompt(null);
  }

  function dismissCancelPrompt() {
    if (!returnPrompt) return;
    // revert pending state
    const next = subs.map((s) =>
      s.id === returnPrompt.sub_id
        ? { ...s, cancel_state: 'active' as const, cancel_claimed_at: undefined }
        : s,
    );
    setSubs(next);
    setReturnPrompt(null);
  }

  function markManual(subId: string, answer: 'yes' | 'no') {
    setManualReview({ ...manualReview, [subId]: { ts: Date.now(), answer } });
    if (answer === 'no') {
      // treat as cancel candidate going forward — keep on list, user
      // can hit cancel manually
    }
  }

  // ── render helpers ──────────────────────────────────────────────────

  function CancelBtn({ sig }: { sig: DormancySignal }) {
    const url = getCancelUrl(sig.aliasKey);
    if (!url) {
      return (
        <button
          type="button"
          style={primaryBtn}
          onClick={() => { /* no catalogued URL — keep button visible but inert */ }}
          aria-disabled
        >
          {t('btn_cancel_manual')}
        </button>
      );
    }
    const label = isAppleManaged(sig.aliasKey)
      ? t('btn_cancel_apple')
      : t('btn_cancel_at').replace('${0}', urlDomain(url));
    return (
      <button type="button" style={primaryBtn} onClick={() => void cancelFlow(sig)}>
        {label}
      </button>
    );
  }

  function CandidateCard({ sig }: { sig: DormancySignal }) {
    const monthlyAmt = fmtMonthly(sig.monthlyAmount);
    const monthsActive = Math.max(1, Math.floor(sig.daysSinceCreated / 30));
    return (
      <article style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        paddingTop: 24,
        paddingBottom: 24,
        borderBottom: '1px solid var(--rule-soft)',
      }}>
        <h3 style={sectionHeading}>{sig.subscriptionName}</h3>
        <p style={bodyText}>{buildEvidence(locale, sig)}</p>
        <p style={meta}>
          <span style={amount}>${monthlyAmt}</span>
          <span>{' / mo · '}</span>
          {pluralOne(locale, 'finance.audit.meta_months_active', monthsActive)}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <CancelBtn sig={sig} />
          <button type="button" style={ghostBtn} onClick={() => snooze(sig.subscriptionId, 7)}>
            {t('btn_snooze_7')}
          </button>
          <button
            type="button"
            style={ghostBtn}
            onClick={() => snooze(sig.subscriptionId, 365)}
          >
            {t('btn_keep')}
          </button>
        </div>
      </article>
    );
  }

  function ReviewCard({ sig }: { sig: DormancySignal }) {
    const monthlyAmt = fmtMonthly(sig.monthlyAmount);
    return (
      <article style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        paddingTop: 24,
        paddingBottom: 24,
        borderBottom: '1px solid var(--rule-soft)',
      }}>
        <h3 style={sectionHeading}>{sig.subscriptionName}</h3>
        <p style={bodyText}>{buildEvidence(locale, sig)}</p>
        <p style={meta}>
          <span style={amount}>${monthlyAmt}</span>
          <span>{' / mo'}</span>
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" style={ghostBtn} onClick={() => snooze(sig.subscriptionId, 14)}>
            {t('btn_snooze_14')}
          </button>
          <button
            type="button"
            style={ghostBtn}
            onClick={() => snooze(sig.subscriptionId, 365)}
          >
            {t('btn_keep')}
          </button>
        </div>
      </article>
    );
  }

  function InconclusiveCard({ sig }: { sig: DormancySignal }) {
    const monthlyAmt = fmtMonthly(sig.monthlyAmount);
    const stored = manualReview[sig.subscriptionId];
    return (
      <article style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        paddingTop: 24,
        paddingBottom: 24,
        borderBottom: '1px solid var(--rule-soft)',
      }}>
        <h3 style={sectionHeading}>{sig.subscriptionName}</h3>
        <p style={bodyText}>{buildEvidence(locale, sig)}</p>
        {!stored && (
          <>
            <p style={{ ...bodyText, color: 'var(--ink)' }}>{t('manual_prompt')}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                style={ghostBtn}
                onClick={() => markManual(sig.subscriptionId, 'yes')}
              >
                {t('btn_yes')}
              </button>
              <button
                type="button"
                style={ghostBtn}
                onClick={() => markManual(sig.subscriptionId, 'no')}
              >
                {t('btn_no')}
              </button>
            </div>
          </>
        )}
        {stored && (
          <p style={meta}>
            {stored.answer === 'yes' ? t('btn_yes') : t('btn_no')}
            {' · '}
            <span style={amount}>${monthlyAmt}</span>
          </p>
        )}
      </article>
    );
  }

  // ── render ──────────────────────────────────────────────────────────

  // sum savings this audit (cancellations made in last 24h window — the
  // "this audit" bucket. Caller could refine; 24h is the natural
  // session boundary on iOS dogfood).
  const sessionWindow = now - 86_400_000;
  const thisSession = cancellations.filter((c) => c.cancelled_at >= sessionWindow);
  const savedMonthly = thisSession.reduce((s, c) => s + c.monthly_amount, 0);
  const savedYearly = savedMonthly * 12;

  return (
    <div style={{
      background: 'var(--bone)',
      backgroundImage: 'var(--paper-grain)',
      minHeight: '100vh',
      padding: '24px 24px 96px',
      fontFamily: 'var(--font-system)',
      color: 'var(--ink)',
    }}>
      {/* ── masthead ───────────────────────────────────────────── */}
      <header style={{ marginBottom: 56 }}>
        {onBack && (
          <button
            type="button"
            style={{ ...ghostBtn, marginBottom: 24, border: 'none', paddingLeft: 0 }}
            onClick={onBack}
            aria-label={t('btn_back')}
          >
            {`← ${t('btn_back')}`}
          </button>
        )}
        <div style={{ ...eyebrow, marginBottom: 12 }}>
          {`§ ${t('title')} / ${t('subtitle')}`}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
          <span style={heroNumeral}>{summary.totalSubs}</span>
          <span style={{ ...bodyText, color: 'var(--ink-soft)' }}>
            {t('header_count').replace('${0}', '').trim()}
          </span>
        </div>
        <p style={{ ...meta, marginTop: 4 }}>
          {t('header_monthly').replace('${0}', `$${fmtMonthly(summary.monthlyTotal)}`)}
        </p>
      </header>

      {/* ── return prompt ──────────────────────────────────────── */}
      {returnPrompt && (
        <section style={{
          marginBottom: 40,
          padding: 20,
          background: 'var(--paper)',
          backgroundImage: 'var(--paper-grain-hero)',
          border: '1px solid var(--rule)',
        }}>
          <p style={{ ...sectionHeading, marginBottom: 16 }}>
            {t('return_prompt_title').replace('${0}', returnPrompt.sub_name)}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={primaryBtn} onClick={confirmCancelled}>
              {t('return_prompt_yes')}
            </button>
            <button type="button" style={ghostBtn} onClick={dismissCancelPrompt}>
              {t('return_prompt_no')}
            </button>
          </div>
        </section>
      )}

      {/* ── empty + all-clear states ───────────────────────────── */}
      {empty && (
        <section style={{ paddingTop: 80, paddingBottom: 80 }}>
          <h2 style={{ ...sectionHeading, marginBottom: 16 }}>{t('empty_title')}</h2>
          <p style={bodyText}>{t('empty_body')}</p>
        </section>
      )}
      {!empty && !hasAnyRows && (
        <section style={{ paddingTop: 40, paddingBottom: 40 }}>
          <h2 style={{ ...sectionHeading, marginBottom: 16 }}>{t('all_clear_title')}</h2>
          <p style={bodyText}>{t('all_clear_body')}</p>
        </section>
      )}

      {/* ── candidates ─────────────────────────────────────────── */}
      {candidates.length > 0 && (
        <section style={{ marginBottom: 80 }}>
          <header style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 24,
          }}>
            <span style={marginalia} aria-hidden>§</span>
            <h2 style={sectionHeading}>{t('section_candidates')}</h2>
            <span style={{ ...inkAnchor, marginLeft: 'auto' }}>
              {String(candidates.length).padStart(2, '0')}
            </span>
          </header>
          {candidates.map((sig) => (
            <CandidateCard key={sig.subscriptionId} sig={sig} />
          ))}
        </section>
      )}

      {/* ── review ─────────────────────────────────────────────── */}
      {reviewItems.length > 0 && (
        <section style={{ marginBottom: 80 }}>
          <header style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 24,
          }}>
            <span style={marginalia} aria-hidden>¶</span>
            <h2 style={sectionHeading}>{t('section_review')}</h2>
          </header>
          {reviewItems.map((sig) => (
            <ReviewCard key={sig.subscriptionId} sig={sig} />
          ))}
        </section>
      )}

      {/* ── inconclusive ───────────────────────────────────────── */}
      {inconclusive.length > 0 && (
        <section style={{ marginBottom: 80 }}>
          <header style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 24,
          }}>
            <span style={{ ...marginalia, color: 'var(--umber)' }} aria-hidden>‡</span>
            <h2 style={sectionHeading}>{t('section_inconclusive')}</h2>
          </header>
          {inconclusive.map((sig) => (
            <InconclusiveCard key={sig.subscriptionId} sig={sig} />
          ))}
        </section>
      )}

      {/* ── too soon (rendered quietly, no actions) ───────────── */}
      {tooSoon.length > 0 && (
        <section style={{ marginBottom: 80 }}>
          <header style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 24,
          }}>
            <span style={marginalia} aria-hidden>—</span>
            <h2 style={sectionHeading}>{t('section_too_soon')}</h2>
          </header>
          {tooSoon.map((sig) => (
            <article
              key={sig.subscriptionId}
              style={{
                paddingTop: 16,
                paddingBottom: 16,
                borderBottom: '1px solid var(--rule-soft)',
              }}
            >
              <h3 style={{ ...sectionHeading, fontSize: 17, marginBottom: 6 }}>
                {sig.subscriptionName}
              </h3>
              <p style={{ ...bodyText, fontSize: 15 }}>
                {buildEvidence(locale, sig)}
              </p>
            </article>
          ))}
        </section>
      )}

      {/* ── summary ────────────────────────────────────────────── */}
      {thisSession.length > 0 && (
        <section style={{ marginTop: 80, paddingTop: 40, borderTop: '1px solid var(--rule)' }}>
          <h2 style={{ ...sectionHeading, marginBottom: 16 }}>{t('section_summary')}</h2>
          <p style={bodyText}>
            {pluralOne(locale, 'finance.audit.summary_cancelled', thisSession.length)}
          </p>
          <p style={{ ...bodyText, color: 'var(--ink)' }}>
            {t('summary_saved_monthly').replace('${0}', fmtMonthly(savedMonthly))}
            {' · '}
            {t('summary_saved_yearly').replace('${0}', fmtMonthly(savedYearly))}
          </p>
        </section>
      )}
    </div>
  );
}

// ─── entry-point helper (used by FinanceModule subscriptions section) ──

/**
 * Compute the kicker label for the "§ audit" entry-point. Reads from
 * the same store slices the AuditSubscriptions screen consumes — pure
 * derived hook, no side effects.
 */
export function useAuditEntryKicker(): {
  candidateCount: number;
  kickerLabel: string;
  locale: Locale;
} {
  const [settings] = useStoreSlice<{ locale?: string }>('shared', 'settings', {});
  const localeRaw = settings?.locale ?? 'en';
  const locale: Locale = localeRaw === 'es' ? 'es' : 'en';
  const [subs] = useStoreSlice<StoredSub[]>('finance', 'subscriptions', []);
  const [records] = useStoreSlice<FinanceRecord[]>('finance', 'records', []);
  const [dumps] = useStoreSlice<BrainDumpEntry[]>('dump', 'items', []);
  const now = Date.now();
  const subsLike: StoredSubLike[] = useMemo(
    () => subs.map((s) => ({
      id: s.id,
      name: s.name,
      amount: s.amount,
      period: s.period,
      ts: s.ts,
      alias_key: s.alias_key ?? null,
      snoozeUntil: s.snoozeUntil ?? null,
    })),
    [subs],
  );
  const candidateCount = useMemo(() => {
    const sigs = scoreDormancy(subsLike, records, dumps, now);
    return sigs.filter((s) => s.recommendation === 'cancel_candidate').length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsLike, records, dumps]);

  let kickerLabel: string;
  if (candidateCount === 0) {
    kickerLabel = getString(locale, 'finance.audit.entry_kicker_zero');
  } else if (candidateCount === 1) {
    kickerLabel = getString(locale, 'finance.audit.entry_kicker_one');
  } else {
    kickerLabel = getString(locale, 'finance.audit.entry_kicker_many')
      .replace('${0}', String(candidateCount));
  }

  return { candidateCount, kickerLabel, locale };
}
