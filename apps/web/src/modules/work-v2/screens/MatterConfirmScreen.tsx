/**
 * work-v2 · MatterConfirmScreen — the auto-detect / confirm sheet
 *
 * Ollie's deterministic routing layer noticed a recurring name across the
 * user's dumps that had no matter to file into — a real `NewMatterSuggestion`
 * from the matter-routing orchestrator (WORK-VISION Phase 2, routing outcome
 * #2). It asks if it's a matter. AUTO-DETECT, USER-CONFIRM — the user never
 * builds a matter from a blank form; they confirm what Ollie noticed. This is
 * a decision point, so the screen breaks v2 restraint exactly where the DNA
 * allows it: the confirm action is the single amber affordance.
 *
 * The work page sits dimmed behind a scrim; a calm paper sheet rises carrying
 * the question, the evidence (why + the recurring dump excerpts), and the two
 * choices. Confirming creates a REAL `Matter` (see useWorkStore) and the
 * routing orchestrator then self-files the loose dumps into it.
 *
 * The evidence + the candidate come from `matterConfirmVM()` over the live
 * `work` store namespace. When there is no pending suggestion, a calm fallback
 * is shown rather than an empty sheet.
 */
import { useMemo } from 'react';
import { AmberButton, IconCheck, v2 } from '../../money-v2/v2';
import { matterConfirmVM, highlightName, type WorkState } from '../selectors';

export interface MatterConfirmScreenProps {
  state: WorkState;
  /** injected wall clock — keeps recency phrasing deterministic in tests */
  now: number;
  /** the user confirms — "yes, it's a matter" */
  onConfirm: () => void;
  /** the user dismisses — "not a matter" */
  onDismiss: () => void;
  /** the swipe-down / scrim-tap dismiss — leaves the sheet, no decision */
  onBack: () => void;
  onSafe: () => void;
}

export function MatterConfirmScreen({
  state,
  now,
  onConfirm,
  onDismiss,
  onBack,
  onSafe,
}: MatterConfirmScreenProps) {
  const vm = useMemo(() => matterConfirmVM(state, now), [state, now]);

  return (
    <div
      style={{
        boxSizing: 'border-box',
        position: 'relative',
        minHeight: '100dvh',
        width: '100%',
        background: v2.paper,
        fontFamily: v2.sans,
        color: v2.ink,
        overflowX: 'hidden',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* a faint, dimmed glimpse of the work page behind the sheet */}
      <div
        aria-hidden
        style={{
          padding: 'calc(env(safe-area-inset-top, 0px) + 86px) 26px 0',
          opacity: 0.32,
          pointerEvents: 'none',
        }}
      >
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              borderTop: `1px solid ${v2.line}`,
              padding: '24px 2px',
              display: 'flex',
              gap: 16,
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: 62,
                height: 46,
                flexShrink: 0,
                borderRadius: 8,
                background: v2.tile,
              }}
            />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
              <div
                style={{
                  height: 9,
                  borderRadius: 4,
                  background: v2.line,
                  width: i === 0 ? '42%' : '38%',
                }}
              />
              <div
                style={{
                  height: 9,
                  borderRadius: 4,
                  background: v2.line,
                  width: i === 0 ? '78%' : '64%',
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* the scrim — a soft warm wash; tapping it dismisses, no decision */}
      <button
        type="button"
        aria-label="dismiss"
        onClick={onBack}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(42,38,34,.18)',
          border: 'none',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      />

      {/* the confirm sheet — low-key, one focus */}
      <div
        role="dialog"
        aria-label={vm.hasSuggestion ? `is ${vm.name} a matter?` : 'nothing to confirm'}
        style={{
          boxSizing: 'border-box',
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          background: v2.paper,
          borderRadius: '28px 28px 0 0',
          boxShadow: '0 -18px 50px rgba(42,38,34,.22)',
          padding: '14px 28px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 34px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* the handle — a real swipe-down dismiss button */}
        <button
          type="button"
          aria-label="back"
          onClick={onBack}
          style={{
            alignSelf: 'center',
            background: 'transparent',
            border: 'none',
            padding: '4px 12px',
            marginBottom: 20,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <div style={{ width: 38, height: 5, borderRadius: 3, background: v2.line }} />
        </button>

        {vm.hasSuggestion ? (
          <>
            {/* ollie's quiet attribution — a sage dot + a near-silent label */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 18,
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
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  color: v2.sage,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                ollie noticed
              </span>
            </div>

            {/* the question — the matter name set apart */}
            <div
              style={{
                fontSize: 23,
                color: v2.ink,
                fontWeight: 400,
                letterSpacing: '-0.018em',
                lineHeight: 1.4,
              }}
            >
              &ldquo;<b style={{ fontWeight: 600 }}>{vm.name}</b>&rdquo; keeps
              coming up.
              <br />
              Is it a matter?
            </div>

            {/* why ollie is asking — the recurrences, stated plainly */}
            <div
              style={{
                marginTop: 16,
                fontSize: 14,
                color: v2.mute,
                fontWeight: 500,
                letterSpacing: '-0.01em',
                lineHeight: 1.55,
              }}
            >
              {vm.why}
            </div>

            {/* a peek of the dumps — the evidence, not just a claim */}
            {vm.excerpts.length > 0 ? (
              <div
                style={{
                  marginTop: 18,
                  background: '#F3EFE4',
                  borderRadius: 16,
                  padding: '6px 16px',
                }}
              >
                {vm.excerpts.map((ex, i) => {
                  const { before, match, after } = highlightName(
                    ex.text,
                    vm.name,
                  );
                  return (
                    <div
                      key={ex.id}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 11,
                        padding: '11px 0',
                        borderTop: i === 0 ? 'none' : `1px solid ${v2.line}`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11.5,
                          color: v2.mute,
                          fontWeight: 600,
                          flexShrink: 0,
                          width: 48,
                          letterSpacing: '0.01em',
                        }}
                      >
                        {ex.when}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          fontSize: 13,
                          color: '#5A524A',
                          fontWeight: 500,
                          letterSpacing: '-0.01em',
                          lineHeight: 1.4,
                        }}
                      >
                        {before}
                        {match ? (
                          <span style={{ color: v2.ink, fontWeight: 600 }}>
                            {match}
                          </span>
                        ) : null}
                        {after}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* the two choices — confirm is the amber affordance */}
            <div
              style={{
                marginTop: 26,
                display: 'flex',
                flexDirection: 'column',
                gap: 11,
              }}
            >
              <AmberButton
                block
                icon={<IconCheck size={17} weight={2.6} />}
                onClick={onConfirm}
              >
                yes, it&rsquo;s a matter
              </AmberButton>
              <button
                type="button"
                onClick={onDismiss}
                style={{
                  boxSizing: 'border-box',
                  height: 52,
                  borderRadius: 26,
                  background: 'transparent',
                  border: `1.5px solid ${v2.line}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: v2.mute,
                    letterSpacing: '-0.01em',
                  }}
                >
                  not a matter
                </span>
              </button>
            </div>

            {/* a near-silent reassurance under the choices */}
            <div
              style={{
                marginTop: 16,
                textAlign: 'center',
                fontSize: 12,
                color: v2.mute,
                fontWeight: 500,
                letterSpacing: '0.01em',
                lineHeight: 1.5,
              }}
            >
              saying yes just starts a matter &mdash; ollie files the notes,
              you don&rsquo;t have to.
            </div>
          </>
        ) : (
          /* no pending suggestion — a calm fallback, never an empty sheet */
          <div
            style={{
              padding: '8px 2px 12px',
              fontSize: 14,
              color: v2.mute,
              fontWeight: 500,
              lineHeight: 1.5,
              textAlign: 'center',
            }}
          >
            nothing to confirm right now &mdash; ollie will ask when a name
            starts recurring in what you throw.
          </div>
        )}
      </div>

      {/* the Safe dot stays reachable — top-right, above the scrim */}
      <button
        type="button"
        aria-label="safe"
        onClick={onSafe}
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
          right: 'calc(env(safe-area-inset-right, 0px) + 24px)',
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: `1.5px solid ${v2.line}`,
          background: v2.paper,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <svg
          width={15}
          height={15}
          viewBox="0 0 24 24"
          fill="none"
          stroke={v2.mute}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />
        </svg>
      </button>
    </div>
  );
}
