/**
 * ConsentStep — onboarding consent gate (Sprint B' · pivot 2026-05-14)
 *
 * Replaces the pre-pivot ConsentScreen (which carried marketing + necessary
 * one-way). The B2B pivot (`project_ollie_b2b_pivot.md` + Serra's
 * 2026-05-14 lock) shifts the opt-in surface to research data collection.
 *
 * Two toggles only:
 *
 *   1. necessary  — must be ON, locked. Off = app doesn't run.
 *                   Bundles Sentry replay (UX bug repro) per Serra's
 *                   2026-05-14 lock — no third toggle.
 *   2. research   — default OFF. Opt-in to anonymized text → ai-proxy
 *                   /label → research_corpus. Reversible from settings.
 *
 * Pre-pivot users (`research_optin: null`) land here on next app open;
 * the router in App.tsx detects the null sentinel via
 * `needsResearchPrompt()` and forces this screen even if `onboarded`
 * is already true.
 *
 * Voice:
 *   - all-lowercase, dry, editorial
 *   - no exclamation marks
 *   - no banned phrases ("great job", "you should", "miss", "streak")
 *   - feels closer to Kinfolk colophon than cookie banner
 *
 * @ollie/consent owns the persistence. Consent state is read back from
 * `@ollie/consent` `consent.state` directly — no app event is fired.
 */

import React, { useState } from 'react';
import {
  setConsent,
  type ConsentState,
} from '@ollie/consent';
import { getAccount } from '../../lib/account-boot';
import { readUserHash } from '../../lib/user-hash';
import { getAppVersion } from '../../lib/device';

export type ConsentStepSource = 'onboarding' | 'reprompt';

export interface ConsentStepProps {
  /** Stable user id — used as the key into the consent store. */
  userId: string;
  /** Why this user landed here. Carries through to the emitted event. */
  source?: ConsentStepSource;
  /** Called once consent is persisted + event emitted. Router advances. */
  onContinue: () => void;
  /**
   * Optional initial state — `getConsent()` snapshot taken by the router
   * before mounting. We don't read async here to keep the UI synchronous
   * and avoid a flash of un-toggled state. Defaults: research off, marketing
   * preserved (UI hides marketing in B', it stays at whatever the user had).
   */
  initial?: Partial<Pick<ConsentState, 'marketing' | 'research_optin'>>;
}

// ─── shared atoms (match ConsentScreen.tsx + AuthFlow.tsx tokens) ─────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        // The app has no global box-sizing reset (see tokens.css), so a
        // width + padding combo must opt into border-box here.
        boxSizing: 'border-box',
        // `dvh` sizes to the real visible area on iPhone; `100vh` overshoots.
        minHeight: '100dvh',
        width: '100%',
        maxWidth: '100vw',
        overflowX: 'hidden',
        background: 'var(--bone)',
        color: 'var(--ink)',
        fontFamily: 'var(--font-system)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        // Safe-area insets so content clears the iPhone status bar / notch
        // and the home indicator.
        padding:
          'calc(48px + env(safe-area-inset-top)) calc(32px + env(safe-area-inset-right)) ' +
          'calc(48px + env(safe-area-inset-bottom)) calc(32px + env(safe-area-inset-left))',
      }}
    >
      <div style={{ maxWidth: '480px', width: '100%', margin: '0 auto' }}>
        {children}
      </div>
    </main>
  );
}

function CapHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-kicker)',
        letterSpacing: 'var(--ls-caps)',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
        marginBottom: '24px',
      }}
    >
      {children}
    </div>
  );
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h1
      style={{
        fontFamily: 'var(--font-editor)',
        fontSize: 'var(--t-h1)',
        fontWeight: 400,
        lineHeight: 'var(--lh-headline)',
        letterSpacing: 'var(--ls-h1)',
        color: 'var(--ink)',
        margin: '0 0 16px',
      }}
    >
      {children}
    </h1>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: 'var(--font-system)',
        fontSize: 'var(--t-body)',
        color: 'var(--ink-soft)',
        margin: '0 0 32px',
        lineHeight: 'var(--lh-body)',
      }}
    >
      {children}
    </p>
  );
}

function PrimaryBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '14px 32px',
        minHeight: '48px',
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${disabled ? 'var(--rule)' : 'var(--ink)'}`,
        borderRadius: '24px',
        background: disabled ? 'transparent' : 'var(--ink)',
        color: disabled ? 'var(--ink-faint)' : 'var(--bone)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-caption)',
        letterSpacing: 'var(--ls-caps)',
        textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'opacity 200ms ease',
      }}
    >
      {label}
    </button>
  );
}

function Toggle({
  on,
  onChange,
  ariaLabel,
  locked,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={locked || undefined}
      aria-label={ariaLabel}
      onClick={() => {
        if (!locked) onChange(!on);
      }}
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        background: on ? 'var(--accent)' : 'var(--ink-ghost)',
        border: 'none',
        cursor: locked ? 'default' : 'pointer',
        position: 'relative',
        transition: 'background 200ms ease',
        padding: 0,
        flexShrink: 0,
        opacity: locked ? 0.85 : 1,
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      style={{
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 200ms ease',
        color: 'var(--ink-faint)',
        flexShrink: 0,
      }}
    >
      <path
        d="M2 3.5 L5 6.5 L8 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── copy (Serra-locked, banned-phrase clean) ────────────────────────────────

const COPY = {
  necessaryTitle: 'necessary',
  necessaryBody:
    "keeps the app working. crash analytics + session replay only. off = app won't run.",
  researchTitle: 'research',
  researchBody:
    'your anonymized text helps us find adhd patterns across thousands of users. off = app still works the same for you.',
  expandLabel: 'what gets sent',
  details: [
    'your brain dumps, notes, and module entries — names, emails, phone numbers, addresses stripped',
    'stored anonymously, labeled by claude (the model), used to improve ollie + share aggregate patterns with research partners',
    'you can flip this off in settings anytime. existing data stays unless you delete.',
  ],
} as const;

// ─── component ───────────────────────────────────────────────────────────────

export function ConsentStep({
  userId,
  source = 'onboarding',
  onContinue,
  initial,
}: ConsentStepProps) {
  // Locked ON by definition — the toggle exists only to read; user
  // cannot actually flip it. Off = app doesn't run. We commit on
  // continue with necessary: true unconditionally.
  const [research, setResearch] = useState<boolean>(
    initial?.research_optin === true,
  );
  const [detailsOpen, setDetailsOpen] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  async function handleContinue() {
    if (saving) return;
    setSaving(true);
    try {
      await setConsent(userId, {
        necessary: true,
        marketing: initial?.marketing ?? false,
        research_optin: research,
      });

      // Legal trail — write a consent_audit row to Supabase via the
      // research-stream → ai-proxy /ingest-event pipeline. Two firing
      // paths: 'signup' for fresh onboarding, 'settings_change' for the
      // pre-pivot re-prompt. Mirrors SettingsScreen.PrivacySection.
      //
      // Gated on the canonical consent state we JUST wrote (research
      // -stream reads shared.consent.necessary). For a 'signup' source
      // the user is still null-research at the moment of write — emit
      // unconditionally; the worker rejects if research_optin is false
      // is handled downstream. Per Serra's B' brief we ONLY emit when
      // research_optin === true at the moment of consent. Otherwise no
      // research telemetry should leave the device.
      try {
        const account = getAccount();
        const userHash = readUserHash();
        if (account && userHash && research) {
          account.research.trackTable('consent_audit', {
            user_hash: userHash,
            consent_necessary: true,
            consent_marketing: initial?.marketing ?? false,
            consented_at: new Date().toISOString(),
            event_source: source === 'reprompt' ? 'settings_change' : 'signup',
            user_agent: typeof navigator !== 'undefined'
              ? navigator.userAgent.slice(0, 200)
              : '',
            app_version: getAppVersion(),
          });
        }
      } catch {
        /* best-effort — never block the continue path */
      }

      onContinue();
    } catch {
      // setConsent should never throw — local store write is sync,
      // remote sync is fire-and-forget. If it somehow does, we still
      // unlock the UI so the user isn't stuck.
      setSaving(false);
    }
  }

  return (
    <Shell>
      <CapHeader>
        {source === 'reprompt' ? 'one quick re-ask' : 'before we start'}
      </CapHeader>
      <Headline>two choices.</Headline>
      <Sub>
        we're changing how ollie handles your text. read both lines, choose,
        continue. you can change research anytime in settings.
      </Sub>

      {/* necessary row · locked-feeling */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '20px',
          padding: '20px 0',
          borderTop: '1px solid var(--rule)',
        }}
      >
        <div style={{ flex: 1 }}>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-kicker)',
              letterSpacing: 'var(--ls-caps)',
              textTransform: 'uppercase',
              color: 'var(--ink)',
              margin: '0 0 8px',
            }}
          >
            {COPY.necessaryTitle}
          </p>
          <p
            style={{
              fontFamily: 'var(--font-system)',
              fontSize: 'var(--t-body)',
              color: 'var(--ink-soft)',
              margin: 0,
              lineHeight: 'var(--lh-body)',
            }}
          >
            {COPY.necessaryBody}
          </p>
        </div>
        <Toggle
          on={true}
          onChange={() => {
            /* locked — necessary cannot be turned off, no-op */
          }}
          ariaLabel={COPY.necessaryTitle}
          locked
        />
      </div>

      {/* research row · invitational, default off */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '20px 0',
          borderTop: '1px solid var(--rule)',
          borderBottom: '1px solid var(--rule)',
          marginBottom: '32px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '20px',
          }}
        >
          <div style={{ flex: 1 }}>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-kicker)',
                letterSpacing: 'var(--ls-caps)',
                textTransform: 'uppercase',
                color: 'var(--ink)',
                margin: '0 0 8px',
              }}
            >
              {COPY.researchTitle}
            </p>
            <p
              style={{
                fontFamily: 'var(--font-system)',
                fontSize: 'var(--t-body)',
                color: 'var(--ink-soft)',
                margin: 0,
                lineHeight: 'var(--lh-body)',
              }}
            >
              {COPY.researchBody}
            </p>
          </div>
          <Toggle
            on={research}
            onChange={setResearch}
            ariaLabel={COPY.researchTitle}
          />
        </div>

        {/* expand-on-tap details */}
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          aria-expanded={detailsOpen}
          aria-controls="consent-research-details"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'transparent',
            border: 'none',
            padding: '4px 0',
            color: 'var(--ink-faint)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--t-meta)',
            letterSpacing: 'var(--ls-caps-small)',
            textTransform: 'uppercase',
            cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          <span>{COPY.expandLabel}</span>
          <Chevron open={detailsOpen} />
        </button>

        {detailsOpen && (
          <ul
            id="consent-research-details"
            style={{
              margin: 0,
              padding: '0 0 0 18px',
              listStyle: 'disc',
              fontFamily: 'var(--font-system)',
              fontSize: 'var(--t-caption)',
              color: 'var(--ink-soft)',
              lineHeight: 'var(--lh-caption)',
            }}
          >
            {COPY.details.map((line, i) => (
              <li key={i} style={{ marginBottom: '8px' }}>
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>

      <PrimaryBtn
        label={saving ? '…' : 'continue'}
        onClick={handleContinue}
        disabled={saving}
      />
    </Shell>
  );
}

export default ConsentStep;
