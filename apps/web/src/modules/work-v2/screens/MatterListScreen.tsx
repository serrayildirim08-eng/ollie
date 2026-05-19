/**
 * work-v2 · MatterListScreen — the matter list (Phase 1/2-honest)
 *
 * Every matter at a glance — a calm list, each matter a row: the name, its
 * type, and a plain count of the notes routing has filed into it. Tapping a
 * row opens that matter. At the foot sits a quiet, low-emphasis loose /
 * unsorted line (WORK-VISION Phase 2, routing outcome #3) — surfaced, never a
 * chore. When there are no matters at all, a calm empty state explains that
 * matters appear when a name recurs in the user's dumps.
 *
 * PASSIVE — no "+" / "add matter" button (WORK-VISION Phase 1: "the user never
 * files"; matters are detected + confirmed). No urgency wash, no next-step
 * line: urgency framing belongs to the Phase-3 briefing, which is not built.
 *
 * Reads the REAL `matterListVM()` over the live `work` store namespace — the
 * matter container + dump routing committed as 9ed51e5.
 */
import { useMemo } from 'react';
import { Screen, IconChevronRight, v2 } from '../../money-v2/v2';
import { MatterMark } from '../glyphs';
import { matterListVM, type WorkState } from '../selectors';

export interface MatterListScreenProps {
  state: WorkState;
  onOpenMatter: (id: string) => void;
  onBack: () => void;
  onSafe: () => void;
}

export function MatterListScreen({
  state,
  onOpenMatter,
  onBack,
  onSafe,
}: MatterListScreenProps) {
  const vm = useMemo(() => matterListVM(state), [state]);

  return (
    <Screen
      label="matters"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* the calm lede — the count + the framing line */}
      <div
        style={{
          marginTop: 30,
          marginBottom: 30,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <div
          style={{
            fontSize: 15,
            color: v2.ink,
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          {vm.countLine}
        </div>
        <div
          style={{
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.01em',
            textAlign: 'center',
          }}
        >
          {vm.subLine}
        </div>
      </div>

      {vm.empty ? (
        /* no matters yet — a calm explanation, never an empty void */
        <div
          style={{
            borderTop: `1px solid ${v2.line}`,
            borderBottom: `1px solid ${v2.line}`,
            padding: '30px 4px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <MatterMark size={26} />
          <div
            style={{
              fontSize: 14,
              color: v2.ink,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              lineHeight: 1.55,
              textAlign: 'center',
            }}
          >
            no matters yet. when a name keeps coming up in what you throw, ollie
            opens one and asks if it&rsquo;s a matter.
          </div>
        </div>
      ) : (
        /* the matter rows — a calm list, every matter a tappable row */
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {vm.rows.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpenMatter(m.id)}
              style={{
                boxSizing: 'border-box',
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                borderTop: `1px solid ${v2.line}`,
                borderBottom:
                  i === vm.rows.length - 1
                    ? `1px solid ${v2.line}`
                    : undefined,
                padding: '20px 2px 21px',
                display: 'flex',
                gap: 14,
                cursor: 'pointer',
                opacity: m.archived ? 0.62 : 1,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {/* the matter mark — a quiet file-tab glyph */}
              <span
                style={{
                  width: 30,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  paddingTop: 2,
                }}
              >
                <MatterMark />
              </span>

              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                <span
                  style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}
                >
                  <span
                    style={{
                      fontSize: 16,
                      color: v2.ink,
                      fontWeight: 600,
                      letterSpacing: '-0.012em',
                      flexShrink: 0,
                    }}
                  >
                    {m.name}
                  </span>
                  {m.type ? (
                    <span
                      style={{
                        fontSize: 12,
                        color: v2.mute,
                        fontWeight: 500,
                        letterSpacing: '0.01em',
                      }}
                    >
                      {m.type}
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: v2.mute,
                    fontWeight: 500,
                    letterSpacing: '0.01em',
                  }}
                >
                  {m.archived ? `archived · ${m.noteLine}` : m.noteLine}
                </span>
              </span>

              <span
                style={{
                  flexShrink: 0,
                  alignSelf: 'center',
                  marginLeft: 4,
                }}
              >
                <IconChevronRight size={15} stroke={v2.mute} />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* the loose / unsorted foot line — dumps ollie hasn't confidently
          routed to a matter yet (WORK-VISION Phase 2, outcome #3). a
          low-emphasis line; it self-drains as later dumps clarify. */}
      {vm.looseCount > 0 ? (
        <div
          style={{
            marginTop: 18,
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            padding: '0 2px',
          }}
        >
          <span
            style={{
              fontSize: 12.5,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.01em',
              flexShrink: 0,
            }}
          >
            loose
          </span>
          <span style={{ color: v2.line, fontSize: 12.5 }}>&middot;</span>
          <span
            style={{
              flex: 1,
              fontSize: 12.5,
              color: v2.mute,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              lineHeight: 1.45,
            }}
          >
            {vm.looseCount} note{vm.looseCount === 1 ? '' : 's'} ollie
            hasn&rsquo;t placed yet &mdash; they settle as more comes in.
          </span>
        </div>
      ) : null}

      {/* how matters get made — no + button. a quiet sage line states it. */}
      {!vm.empty ? (
        <div
          style={{
            marginTop: 28,
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
            matters aren&rsquo;t added by hand &mdash; when a name keeps coming up
            in what you throw, ollie asks if it&rsquo;s one.
          </span>
        </div>
      ) : null}
    </Screen>
  );
}
