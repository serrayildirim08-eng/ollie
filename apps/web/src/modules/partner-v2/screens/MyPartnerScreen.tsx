/**
 * partner-v2 · MyPartnerScreen — the partner submodule face (my-partner.html)
 *
 * The user's ONE calm view of their partner. The hero is a single quiet
 * name with a small linked-mark; below it the soft states the partner chose
 * to share (body.html's observation grammar — a sage dot riding a calm
 * sentence, NEVER a medical flag), an honesty line about what is and isn't
 * shared, then the user's own ask history (the last ask is the focus row,
 * older asks sit dim beneath it). One amber "new ask" routes to the ask
 * flow; a quiet footer link routes to the sharing control.
 *
 * Real, runnable data — every line comes from `myPartnerVM()` over the
 * partner stub (see selectors.ts for the honest-stub note: there is no
 * backend; the data is realistic placeholder).
 */
import { useMemo } from 'react';
import { Screen, AmberButton, IconPlus, v2 } from '../../money-v2/v2';
import { myPartnerVM, type PartnerState } from '../selectors';
import type { PartnerRoute } from '../PartnerApp';

export interface MyPartnerScreenProps {
  state: PartnerState;
  now: number;
  navigate: (to: PartnerRoute) => void;
  onSafe: () => void;
}

export function MyPartnerScreen({
  state,
  now,
  navigate,
  onSafe,
}: MyPartnerScreenProps) {
  const vm = useMemo(() => myPartnerVM(state, now), [state, now]);

  return (
    <Screen label="my partner" onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      {/* THE HERO — one quiet line: who the partner is */}
      <div style={{ marginTop: 44, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          aria-hidden
          style={{
            boxSizing: 'border-box',
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: `1.5px solid ${v2.line}`,
            background: v2.tile,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            fontSize: 17,
            fontWeight: 600,
            color: v2.sage,
            letterSpacing: '-0.01em',
          }}
        >
          {vm.initial}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div
            style={{
              fontSize: 24,
              fontWeight: 300,
              color: v2.ink,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            {vm.name}
          </div>
          <div style={{ fontSize: 12, color: v2.mute, fontWeight: 500, letterSpacing: '0.01em' }}>
            {vm.linkedSince}
          </div>
        </div>
      </div>

      {/* WHAT THE PARTNER IS SHARING — soft states, the observation grammar */}
      <Caption>what {vm.name}&rsquo;s sharing</Caption>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column' }}>
        {vm.patterns.length > 0 ? (
          vm.patterns.map((p, i) => (
            <div
              key={p.key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 11,
                padding: '12px 2px',
                borderTop: `1px solid ${v2.line}`,
                borderBottom: i === vm.patterns.length - 1 ? `1px solid ${v2.line}` : undefined,
              }}
            >
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
                {p.line}
                {p.tail ? (
                  <span style={{ color: v2.mute }}> &mdash; {p.tail}</span>
                ) : null}
              </span>
            </div>
          ))
        ) : (
          <div
            style={{
              padding: '12px 2px',
              borderTop: `1px solid ${v2.line}`,
              borderBottom: `1px solid ${v2.line}`,
              fontSize: 14,
              color: v2.mute,
              fontWeight: 400,
              lineHeight: 1.45,
            }}
          >
            {vm.name} hasn&rsquo;t turned anything on yet &mdash; nothing to show, calmly.
          </div>
        )}
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 12,
          color: v2.mute,
          fontWeight: 400,
          lineHeight: 1.55,
          letterSpacing: '0.005em',
        }}
      >
        soft states only. ollie never shares a medical flag &mdash; not yours, not
        theirs. if {vm.name} turns something off, it just quietly isn&rsquo;t here.
      </div>

      {/* YOUR ASKS — the last ask, then a quiet dim history */}
      <Caption>your asks</Caption>
      {vm.asks.latest ? (
        <div
          style={{
            marginTop: 14,
            borderTop: `1px solid ${v2.line}`,
            padding: '15px 2px 14px',
            display: 'flex',
            alignItems: 'baseline',
          }}
        >
          <span style={{ fontSize: 14, color: v2.ink, fontWeight: 600, letterSpacing: '-0.01em', flexShrink: 0 }}>
            {vm.asks.latest.kind}
          </span>
          <span style={{ color: v2.line, margin: '0 9px', fontSize: 13 }}>&middot;</span>
          <span style={{ fontSize: 13, color: v2.mute, fontWeight: 500, flex: 1 }}>
            {vm.asks.latest.when}
          </span>
          <span style={{ fontSize: 12, color: v2.sage, fontWeight: 600, letterSpacing: '0.02em' }}>
            {vm.asks.latest.state}
          </span>
        </div>
      ) : (
        <div
          style={{
            marginTop: 14,
            borderTop: `1px solid ${v2.line}`,
            borderBottom: `1px solid ${v2.line}`,
            padding: '15px 2px',
            fontSize: 14,
            color: v2.mute,
            fontWeight: 400,
          }}
        >
          no asks yet &mdash; the first one is below, when you need it.
        </div>
      )}
      {vm.asks.past.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${v2.line}` }}>
          {vm.asks.past.map((a) => (
            <div
              key={a.id}
              style={{
                padding: '11px 2px',
                display: 'flex',
                alignItems: 'baseline',
                borderBottom: `1px solid ${v2.line}`,
              }}
            >
              <span style={{ fontSize: 13, color: v2.mute, fontWeight: 500, flexShrink: 0 }}>
                {a.kind}
              </span>
              <span style={{ color: v2.line, margin: '0 9px', fontSize: 12 }}>&middot;</span>
              <span style={{ fontSize: 13, color: v2.mute, fontWeight: 400, flex: 1 }}>
                {a.when}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ONE AMBER ACTION — new ask */}
      <AmberButton
        icon={<IconPlus size={18} />}
        onClick={() => navigate('ask')}
        style={{ marginTop: 22, height: 50, borderRadius: 25 }}
      >
        new ask
      </AmberButton>

      {/* a quiet footer link — manage your own side */}
      <button
        type="button"
        onClick={() => navigate('sharing')}
        style={{
          marginTop: 26,
          alignSelf: 'center',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <SettingsGlyph />
        <span style={{ fontSize: 13, color: v2.mute, fontWeight: 500, letterSpacing: '-0.005em' }}>
          what {vm.name} sees from you
        </span>
      </button>
    </Screen>
  );
}

/** a tiny uppercase mute section caption — v2 grammar */
function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 40,
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

/** the small gear glyph on the sharing-control footer link */
function SettingsGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={v2.mute} strokeWidth={1.9} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </svg>
  );
}
