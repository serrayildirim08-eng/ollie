/**
 * CrisisScreen — calm full-screen crisis surface.
 *
 * DOCTRINE (non-negotiable, verified by AUDIT_crisis.md):
 *   - ZERO telemetry. No emit(), no events import, no analytics.
 *   - ZERO network. No fetch, no Sentry, no PostHog.
 *   - Free-tier accessible. No consent gate, no tier check — it is
 *     rendered above all gates by App.tsx so it always works.
 *   - Hardcoded hotlines reused from crisis.hotline_* i18n keys
 *     (12 countries + INTL — already present in both locales).
 *
 * Calm by design: a breathing pacer, a 5-4-3-2-1 grounding note, the
 * hotline closest to the user's country, and a quiet exit. No shame,
 * no urgency styling beyond what the breath needs.
 */

import { useEffect, useState } from 'react';
import { useStoreSlice } from '../store';
import { getString, type Locale } from '../i18n';

export interface CrisisScreenProps {
  /** Returns the user to wherever they were. No data is written on exit. */
  onClose: () => void;
}

// Countries with a hardcoded crisis.hotline_* key. Order: most specific
// first; INTL is the universal fallback. Mirrors useApplyBrainDump's
// COUNTRY_TO_HOTLINE_KEY map (verified 2026-05-15).
const HOTLINE_COUNTRIES = [
  'TR', 'US', 'GB', 'CA', 'AU', 'DE', 'FR', 'NL', 'IT', 'ES', 'SE',
] as const;

/** Breathing pacer — 4s in, 4s hold, 6s out. Pure CSS animation. */
function BreathOrb({
  inLabel,
  holdLabel,
  outLabel,
}: {
  inLabel: string;
  holdLabel: string;
  outLabel: string;
}) {
  // Phase label tracks the 14s cycle so the word matches the orb size.
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');

  useEffect(() => {
    // 0–4s in, 4–8s hold, 8–14s out. Loop.
    let mounted = true;
    const tick = (elapsed: number) => {
      const p = elapsed % 14000;
      const next: 'in' | 'hold' | 'out' = p < 4000 ? 'in' : p < 8000 ? 'hold' : 'out';
      if (mounted) setPhase((cur) => (cur === next ? cur : next));
    };
    const start = Date.now();
    const id = setInterval(() => tick(Date.now() - start), 250);
    tick(0);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const label = phase === 'in' ? inLabel : phase === 'hold' ? holdLabel : outLabel;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
        margin: '8px 0 4px',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 132,
          height: 132,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 132,
            height: 132,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(46,93,67,0.20) 0%, rgba(46,93,67,0.07) 60%, transparent 75%)',
            border: '1px solid rgba(46,93,67,0.28)',
            animation: 'crisis-breathe 14s var(--e-breathe, ease-in-out) infinite',
          }}
        />
      </div>
      <span
        aria-live="polite"
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 'var(--t-meta, 11px)',
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: 'var(--accent)',
        }}
      >
        {label}
      </span>
      <style>{`
        @keyframes crisis-breathe {
          0%   { transform: scale(0.62); }
          28%  { transform: scale(1);    }
          57%  { transform: scale(1);    }
          100% { transform: scale(0.62); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-crisis-orb] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

export function CrisisScreen({ onClose }: CrisisScreenProps) {
  const [settings] = useStoreSlice<{ locale?: string; country?: string }>(
    'shared',
    'settings',
    {},
  );
  const locale: Locale = settings?.locale === 'es' ? 'es' : 'en';
  const t = (key: string) => getString(locale, `crisis_screen.${key}`);

  // Country resolution: the canonical key is shared.settings.country
  // (set in onboarding). Fall back to INTL. The hotline copy itself
  // lives under the existing crisis.hotline_* namespace.
  const country = (settings?.country ?? 'INTL').toUpperCase();
  const primaryKey =
    (HOTLINE_COUNTRIES as readonly string[]).includes(country)
      ? `crisis.hotline_${country}`
      : 'crisis.hotline_INTL';
  const primaryHotline = getString(locale, primaryKey);

  // INTL directory is always offered as a second line — works for any
  // user regardless of where they are.
  const intlHotline = getString(locale, 'crisis.hotline_INTL');
  const showIntlSeparately = primaryKey !== 'crisis.hotline_INTL';

  return (
    <main
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'var(--bone)',
        color: 'var(--ink)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 28px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 40px)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 480,
          margin: '0 auto',
          padding: '0 max(env(safe-area-inset-left, 0px), 26px) 0 max(env(safe-area-inset-right, 0px), 26px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-editor)',
            fontSize: 'var(--t-h1)',
            fontWeight: 400,
            lineHeight: 1.12,
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          {t('title')}
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-system)',
            fontSize: 'var(--t-caption, 13px)',
            color: 'var(--ink-faint)',
            margin: '14px 0 0',
            lineHeight: 1.55,
            maxWidth: '34ch',
          }}
        >
          {t('intro')}
        </p>

        {/* ── breathe ──────────────────────────────────────────────────── */}
        <section
          aria-label={t('breathe_title')}
          style={{ marginTop: 30, width: '100%' }}
        >
          <SoftLabel>{t('breathe_title')}</SoftLabel>
          <BreathOrb
            inLabel={t('breathe_in')}
            holdLabel={t('breathe_hold')}
            outLabel={t('breathe_out')}
          />
          <p style={captionStyle}>{t('breathe_caption')}</p>
        </section>

        {/* ── grounding ────────────────────────────────────────────────── */}
        <section
          aria-label={t('ground_title')}
          style={{
            marginTop: 32,
            width: '100%',
            padding: '22px 22px',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-md, 12px)',
            background: 'rgba(46,93,67,0.04)',
            boxSizing: 'border-box',
          }}
        >
          <SoftLabel>{t('ground_title')}</SoftLabel>
          <p
            style={{
              fontFamily: 'var(--font-editor)',
              fontSize: 'var(--t-body)',
              color: 'var(--ink)',
              margin: '10px 0 0',
              lineHeight: 1.6,
            }}
          >
            {t('ground_body')}
          </p>
        </section>

        {/* ── hotlines ─────────────────────────────────────────────────── */}
        <section
          aria-label={t('hotlines_title')}
          style={{ marginTop: 32, width: '100%' }}
        >
          <SoftLabel>{t('hotlines_title')}</SoftLabel>
          <div
            style={{
              marginTop: 12,
              border: '1px solid var(--rule)',
              borderRadius: 'var(--r-md, 12px)',
              overflow: 'hidden',
            }}
          >
            <HotlineRow text={primaryHotline} />
            {showIntlSeparately && <HotlineRow text={intlHotline} divided />}
          </div>
          <p style={captionStyle}>{t('hotlines_caption')}</p>
        </section>

        {/* ── exit ─────────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 36,
            minHeight: 48,
            width: '100%',
            maxWidth: 320,
            padding: '14px 24px',
            background: 'transparent',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-pill, 999px)',
            fontFamily: "'DM Mono', monospace",
            fontSize: 'var(--t-caption, 12px)',
            letterSpacing: '0.1em',
            textTransform: 'lowercase',
            color: 'var(--ink-soft)',
            cursor: 'pointer',
          }}
        >
          {t('close')}
        </button>
        <p style={{ ...captionStyle, marginTop: 12 }}>{t('close_caption')}</p>
      </div>
    </main>
  );
}

// ─── pieces ───────────────────────────────────────────────────────────────────

function HotlineRow({ text, divided }: { text: string; divided?: boolean }) {
  return (
    <div
      style={{
        padding: '18px 22px',
        borderTop: divided ? '1px solid var(--rule)' : 'none',
        fontFamily: "'DM Mono', monospace",
        fontSize: 'var(--t-body, 15px)',
        letterSpacing: '0.02em',
        color: 'var(--ink)',
        lineHeight: 1.5,
        minHeight: 44,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {text}
    </div>
  );
}

function SoftLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'block',
        fontFamily: "'DM Mono', monospace",
        fontSize: 'var(--t-meta, 10px)',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
      }}
    >
      {children}
    </span>
  );
}

const captionStyle: React.CSSProperties = {
  fontFamily: 'var(--font-system)',
  fontStyle: 'italic',
  fontSize: 'var(--t-caption, 12px)',
  color: 'var(--ink-faint)',
  margin: '14px 0 0',
  lineHeight: 1.5,
};
