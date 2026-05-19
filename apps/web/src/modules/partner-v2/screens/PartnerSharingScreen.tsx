/**
 * partner-v2 · PartnerSharingScreen — the opt-in control (partner-sharing.html)
 *
 * The granular sharing control — every toggle defaults OFF; the user picks
 * exactly which soft states their partner sees. Below the toggles, a stated
 * (non-toggle) clinical boundary: medical flags are never shared, not even
 * on purpose — sage + ink, never red, never alarm. Then a live preview card
 * ("what Sam sees right now") in body.html's observation grammar, derived
 * from exactly the toggles that are on, so the user sees what is exposed.
 *
 * Reached from my-partner's "what Sam sees from you" footer link. Toggle
 * state persists through the partner stub (`usePartnerStore.setSharing`).
 */
import { useMemo } from 'react';
import { Screen, v2 } from '../../money-v2/v2';
import { sharingVM, type PartnerState, type SharingKey } from '../selectors';

export interface PartnerSharingScreenProps {
  state: PartnerState;
  /** flip one sharing toggle — persists through the stub */
  onSetSharing: (key: SharingKey, on: boolean) => void;
  onBack: () => void;
  onSafe: () => void;
}

export function PartnerSharingScreen({
  state,
  onSetSharing,
  onBack,
  onSafe,
}: PartnerSharingScreenProps) {
  const vm = useMemo(() => sharingVM(state), [state]);

  return (
    <Screen label="what they see" onBack={onBack} onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      {/* the lead — one calm line */}
      <div
        style={{
          marginTop: 30,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
          lineHeight: 1.32,
        }}
      >
        <b style={{ fontWeight: 500 }}>you choose</b> what {vm.partnerName} sees
      </div>
      <div style={{ marginTop: 9, fontSize: 13, color: v2.mute, fontWeight: 400, lineHeight: 1.6 }}>
        everything starts off. turn on only the soft states you want{' '}
        {vm.partnerName} to know &mdash; change it any time.
      </div>

      {/* the toggle rows — soft pattern types, default OFF */}
      <Caption>soft states</Caption>
      <div style={{ marginTop: 13, display: 'flex', flexDirection: 'column' }}>
        {vm.rows.map((row, i) => (
          <div
            key={row.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '15px 2px',
              borderTop: `1px solid ${v2.line}`,
              borderBottom: i === vm.rows.length - 1 ? `1px solid ${v2.line}` : undefined,
            }}
          >
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 14, color: v2.ink, fontWeight: 600, letterSpacing: '-0.01em' }}>
                {row.label}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: v2.mute,
                  fontWeight: 400,
                  letterSpacing: '0.005em',
                  lineHeight: 1.4,
                }}
              >
                {row.detail}
              </span>
            </div>
            <Switch
              on={row.on}
              label={`share ${row.label}`}
              onToggle={() => onSetSharing(row.key, !row.on)}
            />
          </div>
        ))}
      </div>

      {/* the clinical boundary — stated, not a toggle. never shareable. */}
      <div
        style={{
          marginTop: 16,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: 16,
          background: v2.tile,
          borderRadius: 14,
        }}
      >
        <span
          aria-hidden
          style={{
            boxSizing: 'border-box',
            width: 24,
            height: 24,
            borderRadius: '50%',
            border: `1.5px solid ${v2.sage}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={v2.sage} strokeWidth={2} aria-hidden>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <span
          style={{
            fontSize: 13,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.005em',
            lineHeight: 1.55,
          }}
        >
          medical flags are never shared &mdash; not even with a toggle.{' '}
          <span style={{ color: v2.mute, fontWeight: 400 }}>
            PCOS, endometriosis, PMDD, any clinical pattern ollie tracks stays
            only with you. {vm.partnerName} only ever sees a soft state.
          </span>
        </span>
      </div>

      {/* the preview — exactly what the partner sees right now */}
      <div
        style={{
          marginTop: 34,
          boxSizing: 'border-box',
          border: `1.5px solid ${v2.line}`,
          borderRadius: 16,
          background: v2.card,
          padding: '18px 18px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={v2.mute} strokeWidth={1.7} aria-hidden>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span
            style={{
              fontSize: 11,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
            }}
          >
            what {vm.partnerName} sees right now
          </span>
        </div>
        {vm.preview.length > 0 && (
          <div style={{ marginTop: 13, display: 'flex', flexDirection: 'column', gap: 11 }}>
            {vm.preview.map((line) => (
              <div key={line.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: v2.sage,
                    flexShrink: 0,
                    marginTop: 6,
                  }}
                />
                <span
                  style={{
                    fontSize: 14,
                    color: v2.ink,
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.45,
                  }}
                >
                  {line.line}
                  {line.tail ? <span style={{ color: v2.mute }}> &mdash; {line.tail}</span> : null}
                </span>
              </div>
            ))}
          </div>
        )}
        <div
          style={{
            marginTop: vm.preview.length > 0 ? 14 : 13,
            paddingTop: 13,
            borderTop: `1px solid ${v2.line}`,
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          {vm.previewNote}
        </div>
      </div>
    </Screen>
  );
}

/** a tiny uppercase mute section caption — v2 grammar */
function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 34,
        fontSize: 11,
        color: v2.mute,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}

/** the calm switch — 44×26, line track + paper knob, sage when on */
function Switch({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      style={{
        boxSizing: 'border-box',
        width: 44,
        height: 26,
        borderRadius: 13,
        background: on ? v2.sage : v2.line,
        border: 'none',
        padding: 0,
        position: 'relative',
        flexShrink: 0,
        cursor: 'pointer',
        transition: 'background 0.18s ease-out',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(42,38,34,.25)',
          transition: 'left 0.18s ease-out',
        }}
      />
    </button>
  );
}
