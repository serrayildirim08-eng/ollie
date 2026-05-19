/**
 * work-v2 · WorkFaceScreen — the work submodule face (Phase 1/2-honest)
 *
 * The work module's landing card. work-v2 IS the matters concept
 * (WORK-VISION.md), so the face is the matters card: a stack-of-files gutter
 * visual, a calm glance line that LEADS WITH MATTERS (how many the user has),
 * and the top three matters previewed at rest — each a name + a plain note
 * count. A quiet cue opens the full matter list.
 *
 * PASSIVE — no "+" / "add matter" affordance (WORK-VISION Phase 1: matters are
 * detected + confirmed, never filed by hand). No urgency / "needs you" count:
 * urgency framing belongs to the Phase-3 briefing, which is not built.
 *
 * When the routing layer has a "new matter?" suggestion pending, the closing
 * sage note becomes the one-tap route into the confirm sheet — otherwise it
 * states how matters come to be. Reads `workFaceVM()` over the live `work`
 * store namespace (the real matter backend committed as 9ed51e5).
 */
import { useMemo } from 'react';
import { Screen, IconChevronRight, v2 } from '../../money-v2/v2';
import { MatterStack } from '../glyphs';
import { workFaceVM, type WorkState } from '../selectors';

export interface WorkFaceScreenProps {
  state: WorkState;
  onOpenMatters: () => void;
  onOpenConfirm: () => void;
  onBack?: () => void;
  onSafe: () => void;
}

export function WorkFaceScreen({
  state,
  onOpenMatters,
  onOpenConfirm,
  onBack,
  onSafe,
}: WorkFaceScreenProps) {
  const vm = useMemo(() => workFaceVM(state), [state]);

  return (
    <Screen
      label="work"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* THE WORK CARD — a tall preview block, sitting on a hairline rule */}
      <div
        style={{
          boxSizing: 'border-box',
          marginTop: 32,
          borderTop: `1px solid ${v2.line}`,
          borderBottom: `1px solid ${v2.line}`,
          padding: '24px 2px 26px',
        }}
      >
        {/* card head — the stack visual + the glance line */}
        <button
          type="button"
          onClick={onOpenMatters}
          style={{
            boxSizing: 'border-box',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span
            style={{
              width: 62,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MatterStack />
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: v2.mute,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              matters
            </span>
            <span
              style={{
                fontSize: 15,
                color: v2.ink,
                fontWeight: 500,
                letterSpacing: '-0.01em',
                lineHeight: 1.4,
              }}
            >
              <b style={{ fontWeight: 600 }}>{vm.glanceLead}</b>
              {' — '}
              {vm.glanceTail}
            </span>
          </span>
          <IconChevronRight stroke={v2.mute} />
        </button>

        {/* at rest — the top three matters, each name + its note count */}
        {vm.topMatters.length > 0 ? (
          <div
            style={{
              marginTop: 15,
              marginLeft: 78,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {vm.topMatters.map((m, i) => (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 11,
                  padding: i === 0 ? '2px 0 9px' : '9px 0',
                  borderTop: i === 0 ? 'none' : `1px solid ${v2.line}`,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 2,
                    flexShrink: 0,
                    alignSelf: 'center',
                    border: `1.5px solid ${v2.mute}`,
                    background: 'transparent',
                  }}
                />
                <span
                  style={{
                    fontSize: 14,
                    color: v2.ink,
                    fontWeight: 600,
                    letterSpacing: '-0.01em',
                    flexShrink: 0,
                  }}
                >
                  {m.type ? `${m.name} · ${m.type}` : m.name}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: v2.mute,
                    textAlign: 'right',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {m.noteLine}
                </span>
              </div>
            ))}
          </div>
        ) : (
          /* no matters yet — a calm in-card line, never an empty card */
          <div
            style={{
              marginTop: 13,
              marginLeft: 78,
              fontSize: 13,
              color: v2.mute,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              lineHeight: 1.5,
            }}
          >
            no matters yet &mdash; ollie opens one when a name keeps recurring
            in what you throw.
          </div>
        )}

        {/* the open cue — a quiet route into the matter list */}
        <button
          type="button"
          onClick={onOpenMatters}
          style={{
            marginTop: 16,
            marginLeft: 78,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: 12,
            color: v2.accent,
            fontWeight: 600,
            letterSpacing: '0.02em',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          open matters
          <IconChevronRight size={12} stroke={v2.accent} />
        </button>
      </div>

      {/* the closing note — how matters get made. matters are created by
          CONFIRMATION, not a + button. when ollie has a pending "new matter?"
          suggestion, the sage note becomes the route into the confirm sheet. */}
      {vm.hasSuggestion ? (
        <button
          type="button"
          onClick={onOpenConfirm}
          style={{
            marginTop: 26,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
            padding: '2px 2px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            WebkitTapHighlightColor: 'transparent',
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
              marginTop: 4,
            }}
          />
          <span
            style={{
              fontSize: 13,
              color: v2.ink,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              lineHeight: 1.5,
            }}
          >
            ollie noticed &ldquo;
            <b style={{ fontWeight: 600 }}>{vm.suggestionName}</b>
            &rdquo; keeps coming up &mdash; tap to see if it&rsquo;s a matter.
          </span>
        </button>
      ) : (
        <div
          style={{
            marginTop: 26,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
            padding: '0 2px',
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
              marginTop: 4,
            }}
          />
          <span
            style={{
              fontSize: 13,
              color: v2.ink,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              lineHeight: 1.5,
            }}
          >
            matters aren&rsquo;t added by hand &mdash; when a name keeps coming
            up in what you throw, ollie asks if it&rsquo;s one.
          </span>
        </div>
      )}
    </Screen>
  );
}
