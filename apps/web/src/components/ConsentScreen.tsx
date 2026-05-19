/**
 * ConsentScreen — single consent surface for ollie (Sprint 6 · consent rewrite)
 *
 * Shown AFTER successful sign-up (AuthFlow.onAuthenticated → here) and
 * BEFORE the 8-screen OnboardingScreen. Replaces the prior per-feature
 * consent model (consent.cycle / consent.astrology / consent.spending_research).
 *
 * Two toggles:
 *
 *   - marketing   — default ON. Bidirectional, anytime.
 *   - necessary   — default OFF. One-way: tap to flip ON, then locked.
 *                   "Continue" is gated until this is ON. Once given, the
 *                   only way to revoke is "delete your account".
 *
 * Consent consolidation (Görev 1 · 2026-05-15): both flags now persist to
 * the canonical `@ollie/consent` `consent.state` row via
 * setNecessaryConsentSync / setMarketingConsentSync — NOT the old raw
 * `shared.consent.*` keys. App.tsx's boot gate reads the same canonical row.
 *
 * Voice: lowercase labels, DM Mono caps headers, sage active.
 * Pattern matches AuthFlow.tsx (Shell, CapHeader, Headline, Sub, PrimaryBtn).
 *
 * Legal copy below is a Serra-placeholder — she'll paste the real text.
 */

import React, { useState } from 'react';
import {
  setMarketingConsentSync,
  setNecessaryConsentSync,
} from '@ollie/consent';
import { store } from '../store';
import { getAccount } from '../lib/account-boot';
import { readUserHash } from '../lib/user-hash';
import { getAppVersion } from '../lib/device';

export interface ConsentScreenProps {
  onContinue: () => void;
}

// ─── shared atoms (match AuthFlow.tsx tokens) ────────────────────────────────

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
      <div style={{ maxWidth: '420px', width: '100%', margin: '0 auto' }}>
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
  type: btnType = 'button',
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={btnType}
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

// ─── Toggle (sage active, optional lock indicator) ───────────────────────────

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
      onClick={() => { if (!locked) onChange(!on); }}
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

function LockIcon() {
  // Small lock glyph — appears next to the necessary toggle once it's
  // been flipped ON. Pure SVG so it sits next to text without a font
  // dependency.
  return (
    <span
      aria-label="locked"
      title="locked — to disable, delete your account"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: '8px',
        color: 'var(--ink-faint)',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <rect x="2.5" y="5.5" width="7" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
        <path d="M4 5.5 V4 a2 2 0 0 1 4 0 V5.5" fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
    </span>
  );
}

// ─── component ───────────────────────────────────────────────────────────────

export function ConsentScreen({ onContinue }: ConsentScreenProps) {
  // Defaults: marketing ON, necessary OFF. Mounted state only — we
  // commit to the store on Continue (and on each marketing toggle).
  const [marketing, setMarketing] = useState<boolean>(true);
  const [necessary, setNecessary] = useState<boolean>(false);

  function handleMarketingToggle(next: boolean) {
    setMarketing(next);
    // Canonical write — round-trips through @ollie/consent's consent.state.
    setMarketingConsentSync(store, next);
  }

  function handleNecessaryFlip() {
    // One-way gesture: only fire on the OFF → ON transition. Already-ON
    // is locked — the Toggle component's `locked` prop prevents clicks,
    // but this is the second line of defence.
    if (necessary) return;
    setNecessary(true);
    // Canonical write — flips necessary true on the consent.state row.
    setNecessaryConsentSync(store);
  }

  function handleContinue() {
    if (!necessary) return;
    // Persist both on Continue too — covers the case where the user never
    // tapped the marketing toggle (default ON wasn't written yet) but did
    // flip necessary. Order: marketing first, then necessary, so the
    // necessary write carries the freshest marketing value.
    setMarketingConsentSync(store, marketing);
    setNecessaryConsentSync(store);
    // Consent audit — fire-and-forget. Never blocks the flow.
    // research.hasConsent() reads from the store which we just wrote,
    // so this is always true at this point. The check is defence-in-depth.
    void emitConsentAudit({
      consent_necessary: true,
      consent_marketing: marketing,
      event_source: 'signup',
    });
    onContinue();
  }

  /** Fire-and-forget consent audit row. Never throws, never blocks UI. */
  function emitConsentAudit({
    consent_necessary,
    consent_marketing,
    event_source,
  }: {
    consent_necessary: boolean;
    consent_marketing: boolean;
    event_source: 'signup' | 'settings_change';
  }) {
    const account = getAccount();
    if (!account) return;
    // At sign-up the research client may not have consent flagged yet
    // in its store (we just set it above), so we bypass hasConsent() here
    // and call trackTable directly. The trackTable guard inside research
    // also checks hasConsent — but since we just wrote it true the store
    // will reflect it on the same tick.
    const userHash = readUserHash();
    if (!userHash) return; // no hash yet — rare edge case, drop gracefully
    account.research.trackTable('consent_audit', {
      user_hash: userHash,
      consent_necessary,
      consent_marketing,
      consented_at: new Date().toISOString(),
      event_source,
      user_agent: typeof navigator !== 'undefined'
        ? navigator.userAgent.slice(0, 200)
        : '',
      app_version: getAppVersion(),
    });
  }

  return (
    <Shell>
      <CapHeader>before we start</CapHeader>
      <Headline>two choices.</Headline>
      <Sub>
        ollie ships in beta. these two consent settings determine how we use
        what you give us. you can change marketing anytime. the second one is
        the gate — without it we can't continue.
      </Sub>

      {/* Marketing toggle row — default ON, bidirectional */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '16px',
          padding: '16px 0',
          borderTop: '1px solid var(--rule)',
        }}
      >
        <div style={{ flex: 1 }}>
          <p
            style={{
              fontFamily: 'var(--font-system)',
              fontSize: 'var(--t-body)',
              color: 'var(--ink)',
              margin: '0 0 4px',
            }}
          >
            marketing cookies
          </p>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-meta)',
              letterSpacing: 'var(--ls-caps-small)',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
              margin: 0,
            }}
          >
            [Legal text — Serra will paste]
          </p>
        </div>
        <Toggle
          on={marketing}
          onChange={handleMarketingToggle}
          ariaLabel="marketing cookies"
        />
      </div>

      {/* Necessary toggle row — default OFF, one-way; gates Continue */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '16px',
          padding: '16px 0',
          borderTop: '1px solid var(--rule)',
          borderBottom: '1px solid var(--rule)',
          marginBottom: '32px',
        }}
      >
        <div style={{ flex: 1 }}>
          <p
            style={{
              fontFamily: 'var(--font-system)',
              fontSize: 'var(--t-body)',
              color: 'var(--ink)',
              margin: '0 0 4px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            necessary opt-in
            {necessary && <LockIcon />}
          </p>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-meta)',
              letterSpacing: 'var(--ls-caps-small)',
              textTransform: 'uppercase',
              color: 'var(--ink-faint)',
              margin: 0,
            }}
          >
            [Legal text — Serra will paste]
          </p>
        </div>
        <Toggle
          on={necessary}
          onChange={handleNecessaryFlip}
          ariaLabel="necessary opt-in"
          locked={necessary}
        />
      </div>

      <PrimaryBtn
        label="continue"
        onClick={handleContinue}
        disabled={!necessary}
      />
    </Shell>
  );
}
