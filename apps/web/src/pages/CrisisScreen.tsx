/**
 * CrisisScreen — calm boundary surface.
 *
 * Shown when `detectCrisis` matches self-harm / suicidal-ideation or
 * method-seeking text in a brain dump, and also when the user taps the
 * quiet "need a moment?" link on the home screen.
 *
 * Ollie does NOT act as a crisis service. This surface states that plainly
 * and points to findahelpline.com — it does not coach, counsel, or run
 * breathing/grounding exercises. (Single-surface decision, 2026-05-19:
 * the new boundary copy contradicted the old breathing/grounding screen,
 * so that screen was removed.)
 *
 * DOCTRINE (non-negotiable, asserted by CrisisScreen.test.tsx):
 *   - ZERO telemetry. No emit(), no events import, no analytics.
 *   - ZERO network. No fetch, no Sentry, no PostHog. The one outbound
 *     thing is a plain <a href> the user chooses to tap.
 *   - Free-tier accessible. Rendered above every gate by the router so it
 *     always works — pre-auth, pre-consent, pre-onboarding.
 */

import { useSearchParams } from 'react-router-dom';
import { useStoreSlice } from '../store';

export interface CrisisScreenProps {
  /** Returns the user to wherever they were. No data is written on exit. */
  onClose: () => void;
}

type CrisisLang = 'en' | 'es' | 'tr';

const HELPLINE_URL = 'https://findahelpline.com';
const HELPLINE_LABEL = 'findahelpline.com';

// The crisis copy is the ONLY Turkish in the app — the UI itself ships
// en/es. It lives inline (not in i18n) precisely so adding `tr` here does
// not reopen the app-wide locale: a Turkish phrase in a dump is the only
// signal that the user needs a Turkish answer, and a safety surface must
// reach the user in the language they wrote in.
const COPY: Record<CrisisLang, { body: string; lead: string; back: string; aria: string }> = {
  en: {
    body: "i can't help with this — it's not what i'm here for.",
    lead: 'if you want a helpline, go to',
    back: 'go back',
    aria: 'support',
  },
  es: {
    body: 'no puedo ayudarte con esto — no es para lo que estoy aquí.',
    lead: 'si quieres una línea de ayuda, entra en',
    back: 'volver',
    aria: 'apoyo',
  },
  tr: {
    body: 'bu konuda yardım edemem — bunun için burada değilim.',
    lead: 'bir destek hattı istersen şuraya git:',
    back: 'geri dön',
    aria: 'destek',
  },
};

export function CrisisScreen({ onClose }: CrisisScreenProps) {
  const [searchParams] = useSearchParams();
  const [settings] = useStoreSlice<{ locale?: string }>('shared', 'settings', {});

  // Response language: an explicit ?lang from the detector wins (it carries
  // 'tr' when the user wrote Turkish); a manual visit falls back to the
  // app locale. Anything unrecognised → 'en'.
  const appLocale: CrisisLang = settings?.locale === 'es' ? 'es' : 'en';
  const param = searchParams.get('lang');
  const lang: CrisisLang =
    param === 'tr' || param === 'es' || param === 'en' ? param : appLocale;
  const c = COPY[lang];

  return (
    <main
      role="dialog"
      aria-modal="true"
      aria-label={c.aria}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        background: 'var(--bone)',
        color: 'var(--ink)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 28px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 40px)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          flex: 1,
          maxWidth: 420,
          width: '100%',
          margin: '0 auto',
          padding:
            '0 max(env(safe-area-inset-left, 0px), 28px) 0 max(env(safe-area-inset-right, 0px), 28px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 34,
          boxSizing: 'border-box',
        }}
      >
        {/* ── the boundary ───────────────────────────────────────────────── */}
        <p
          style={{
            fontFamily: 'var(--font-editor)',
            fontSize: 'var(--t-h2, 22px)',
            fontWeight: 400,
            lineHeight: 1.4,
            letterSpacing: '-0.01em',
            margin: 0,
            maxWidth: '24ch',
          }}
        >
          {c.body}
        </p>

        {/* ── the one pointer out ────────────────────────────────────────── */}
        <p
          style={{
            fontFamily: 'var(--font-system)',
            fontSize: 'var(--t-caption, 13px)',
            color: 'var(--ink-faint)',
            lineHeight: 1.6,
            margin: 0,
            maxWidth: '30ch',
          }}
        >
          {c.lead}{' '}
          <a
            href={HELPLINE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              minHeight: 44,
              lineHeight: '44px',
              fontFamily: "'DM Mono', monospace",
              fontSize: 'var(--t-body, 15px)',
              letterSpacing: '0.02em',
              color: 'var(--accent)',
              textDecorationThickness: '1px',
              textUnderlineOffset: '3px',
            }}
          >
            {HELPLINE_LABEL}
          </a>
        </p>
      </div>

      {/* ── quiet exit ───────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding:
            '0 max(env(safe-area-inset-left, 0px), 28px) 0 max(env(safe-area-inset-right, 0px), 28px)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            minHeight: 48,
            width: '100%',
            maxWidth: 320,
            boxSizing: 'border-box',
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
          {c.back}
        </button>
      </div>
    </main>
  );
}
