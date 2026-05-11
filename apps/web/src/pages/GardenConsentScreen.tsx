/**
 * GardenConsentScreen · Sprint 4 · Decision #15
 *
 * Shown when the user navigates to /garden without having opted into
 * spending research. The garden is framed as a gift IN EXCHANGE for
 * the anonymous, withdrawable contribution.
 *
 * On "yes": flip `shared.consent.spending_research` true. The garden
 * page caller swaps to <GardenScreen /> on next render.
 * On "no": navigate back to dashboard.
 *
 * Voice rules: factual, no exclamation marks, no urgency, no
 * cheerleading. Tone matches CLAUDE.md notification scope rule.
 */

import React from 'react';
import { useStoreSlice } from '../store';
import { getAccount } from '../lib/account-boot';

export interface GardenConsentScreenProps {
  onAccept: () => void;
  onDecline: () => void;
}

export function GardenConsentScreen({ onAccept, onDecline }: GardenConsentScreenProps) {
  const [, setConsent] = useStoreSlice<boolean>('shared', 'consent.spending_research', false);

  function accept() {
    // Credibility audit NC5: route through @ollie/research-stream so
    // the device_id is generated alongside the consent flag. Falls
    // back to a raw store write if the account layer hasn't booted.
    const account = getAccount();
    if (account?.research) {
      account.research.grantConsent();
    } else {
      setConsent(true);
    }
    onAccept();
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        width: '100vw',
        background: 'linear-gradient(180deg, #b8d4e8 0%, #d4eaf4 60%, #e8f0f4 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        fontFamily: "'DM Sans', sans-serif",
        color: '#111111',
      }}
    >
      <div style={{ maxWidth: 520, width: '100%', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <h1
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 38,
            fontWeight: 400,
            margin: 0,
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
          }}
        >
          the garden
        </h1>

        <p style={{ fontSize: 17, lineHeight: 1.55, margin: 0, color: '#1E1E1E' }}>
          the garden is for people who want to help us learn how brains like
          yours move through life. anonymous, opt-in, withdrawable. burhan
          grows with what you log. nothing leaves the device unencrypted.
        </p>

        <p
          style={{
            fontSize: 17,
            lineHeight: 1.55,
            margin: 0,
            color: '#1E1E1E',
            fontFamily: "'DM Serif Display', serif",
            fontStyle: 'italic',
          }}
        >
          turn it on?
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" onClick={accept} style={primaryBtn}>
            yes — open the garden
          </button>
          <button type="button" onClick={onDecline} style={ghostBtn}>
            not now
          </button>
        </div>

        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'rgba(17,17,17,0.5)',
            marginTop: 16,
          }}
        >
          change anytime in settings
        </div>
      </div>
    </main>
  );
}

const primaryBtn: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  padding: '14px 22px',
  background: '#111111',
  color: '#F5F4F0',
  border: 'none',
  borderRadius: 14,
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  padding: '14px 22px',
  background: 'transparent',
  color: '#111111',
  border: '1px solid rgba(17,17,17,0.18)',
  borderRadius: 14,
  cursor: 'pointer',
};
