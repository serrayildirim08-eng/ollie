/**
 * partner-v2 · PartnerInviteScreen — link a partner (partner-invite.html)
 *
 * ONE focus: the invite code, in air. A calm white tile with the code
 * spaced wide, two quiet outlined share affordances under it, the calm
 * numbered sequence of what happens once they join, and the honest note
 * (shared patterns need Ollie on both sides; an ask can still go to anyone).
 *
 * Reached the first time my-partner is opened with no link — the App picks
 * this as the floor when `state.linkedPartner` is null.
 *
 * `copy link` / `share` use the Web Share API when present and fall back to
 * the clipboard; both degrade to a quiet inline "copied" confirmation, so
 * the screen works on device + in tests with no native bridge.
 */
import { useMemo, useState } from 'react';
import { Screen, v2 } from '../../money-v2/v2';
import { inviteVM, type PartnerState } from '../selectors';

export interface PartnerInviteScreenProps {
  state: PartnerState;
  /** mint a fresh invite code */
  onRegenerate: () => void;
  /** back out of the screen (pop, or exit when this is the floor) */
  onBack?: () => void;
  onSafe: () => void;
}

/** the calm numbered sequence — what happens once the partner joins */
const STEPS: string[] = [
  'they open the link — and join with their own Ollie',
  "you're linked — quietly, just the two of you",
  'each of you picks what to share — everything starts off',
];

export function PartnerInviteScreen({
  state,
  onRegenerate,
  onBack,
  onSafe,
}: PartnerInviteScreenProps) {
  const vm = useMemo(() => inviteVM(state), [state]);
  const [copied, setCopied] = useState(false);

  const flashCopied = () => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard?.writeText(vm.shareLink);
    } catch {
      // clipboard unavailable (test env / locked-down WebView) — still flash
    }
    flashCopied();
  };

  const onShare = async () => {
    const nav = navigator as Navigator & {
      share?: (d: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (nav.share) {
      try {
        await nav.share({
          title: 'Link with me on Ollie',
          text: `Join me on Ollie — code ${vm.displayCode}`,
          url: vm.shareLink,
        });
        return;
      } catch {
        // user dismissed the sheet, or share failed — fall through to copy
      }
    }
    await onCopy();
  };

  return (
    <Screen label="link a partner" onBack={onBack} onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
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
        <b style={{ fontWeight: 500 }}>share this</b> with your partner
      </div>
      <div style={{ marginTop: 10, fontSize: 13, color: v2.mute, fontWeight: 400, lineHeight: 1.6 }}>
        once they join, you each choose what the other sees. nothing is shared
        until you both turn it on.
      </div>

      {/* THE HERO — the invite code, in air */}
      <div style={{ marginTop: 38, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            boxSizing: 'border-box',
            width: '100%',
            border: `1.5px solid ${v2.line}`,
            borderRadius: 18,
            background: v2.card,
            padding: '26px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            your invite code
          </span>
          <span style={{ fontSize: 34, fontWeight: 300, color: v2.ink, letterSpacing: '0.14em', lineHeight: 1 }}>
            OLLIE&middot;<b style={{ fontWeight: 500, color: v2.sage }}>{vm.code}</b>
          </span>
        </div>

        {/* two quiet share affordances — copy link · share */}
        <div style={{ marginTop: 14, display: 'flex', gap: 10, width: '100%' }}>
          <ShareAct label={copied ? 'copied' : 'copy link'} onClick={onCopy}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={v2.ink} strokeWidth={1.9} aria-hidden>
              <path d="M9 9h10v10H9zM5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />
            </svg>
          </ShareAct>
          <ShareAct label="share" onClick={onShare}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={v2.ink} strokeWidth={1.9} aria-hidden>
              <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" />
            </svg>
          </ShareAct>
        </div>

        {/* a quiet way to mint a fresh code */}
        <button
          type="button"
          onClick={onRegenerate}
          style={{
            marginTop: 14,
            background: 'transparent',
            border: 'none',
            fontSize: 12,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.01em',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          mint a fresh code
        </button>
      </div>

      {/* the calm sequence — what happens next */}
      <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column' }}>
        {STEPS.map((step, i) => {
          const dash = step.indexOf(' — ');
          const head = dash >= 0 ? step.slice(0, dash) : step;
          const tail = dash >= 0 ? step.slice(dash + 3) : '';
          return (
            <div
              key={step}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 13,
                padding: '14px 2px',
                borderTop: `1px solid ${v2.line}`,
                borderBottom: i === STEPS.length - 1 ? `1px solid ${v2.line}` : undefined,
              }}
            >
              <span
                aria-hidden
                style={{
                  boxSizing: 'border-box',
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  border: `1.5px solid ${v2.line}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 1,
                  fontSize: 12,
                  fontWeight: 600,
                  color: v2.sage,
                }}
              >
                {i + 1}
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: v2.ink,
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.45,
                }}
              >
                {head}
                {tail ? (
                  <span style={{ color: v2.mute, fontWeight: 400 }}> &mdash; {tail}</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      {/* the honest note — both need Ollie for patterns; an ask is open */}
      <div
        style={{
          marginTop: 26,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 11,
          padding: 16,
          background: v2.tile,
          borderRadius: 14,
        }}
      >
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: '50%', background: v2.sage, flexShrink: 0, marginTop: 6 }}
        />
        <span
          style={{
            fontSize: 13,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.005em',
            lineHeight: 1.55,
          }}
        >
          shared patterns need Ollie on both sides.{' '}
          <span style={{ color: v2.mute, fontWeight: 400 }}>
            an ask can still go to anyone &mdash; it sends as a plain message, no
            app required.
          </span>
        </span>
      </div>
    </Screen>
  );
}

/** one quiet outlined share affordance — copy link / share */
function ShareAct({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        boxSizing: 'border-box',
        flex: 1,
        height: 46,
        border: `1.5px solid ${v2.line}`,
        borderRadius: 23,
        background: v2.paper,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {children}
      <span style={{ fontSize: 14, fontWeight: 600, color: v2.ink, letterSpacing: '-0.01em' }}>
        {label}
      </span>
    </button>
  );
}
