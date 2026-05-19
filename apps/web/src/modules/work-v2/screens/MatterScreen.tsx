/**
 * work-v2 · MatterScreen — the matter view (Phase 1/2-honest)
 *
 * Opening a matter hands the user the file. WORK-VISION calls this view "the
 * secretary briefing" — a six-field synthesised summary (what it is · left off
 * at · last move · done · pending · next). But that briefing is a PHASE-3
 * AI-synthesised derived view, and Phase 3 is not built. So this screen ships
 * what Phase 1 + 2 actually produce, honestly:
 *
 *   - the matter's IDENTITY  — its name + type, the page hero
 *   - the routed NOTES        — every raw dump routing has filed here, newest
 *                               first; a note filed as a fuzzy guess carries a
 *                               quiet "ollie's guess" mark (one-tap correction
 *                               is a later Phase-2 UI affordance)
 *   - an honest LINE          — the synthesised briefing arrives in a later
 *                               phase; for now Ollie is gathering the scatter
 *
 * Deliberately ABSENT (WORK-VISION 2026-05-19):
 *   - NO "missing" / deficit field — never framed as a deficit, anywhere.
 *   - NO separate checkable task list / task panel — the single next action is
 *     a Phase-3 briefing field, not built yet.
 * This screen is PASSIVE — it reads + displays; there is no create/file button.
 */
import { useMemo } from 'react';
import { Screen, v2 } from '../../money-v2/v2';
import { matterDetailVM, type WorkState } from '../selectors';

export interface MatterScreenProps {
  state: WorkState;
  /** the matter being viewed */
  matterId: string;
  /** injected wall clock — keeps recency phrasing deterministic in tests */
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

export function MatterScreen({
  state,
  matterId,
  now,
  onBack,
  onSafe,
}: MatterScreenProps) {
  const vm = useMemo(
    () => matterDetailVM(state, matterId, now),
    [state, matterId, now],
  );

  if (!vm.found) {
    return (
      <Screen label="matter" onBack={onBack} onSafe={onSafe} centered>
        <div
          style={{
            fontSize: 15,
            color: v2.mute,
            fontWeight: 500,
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          this matter isn&rsquo;t here anymore.
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      label="matter"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* the matter header — the name as the page hero */}
      <header
        style={{
          marginTop: 22,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 5,
          marginBottom: 6,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 30,
            fontWeight: 400,
            color: v2.ink,
            letterSpacing: '-0.022em',
            textAlign: 'center',
          }}
        >
          {vm.name}
        </h1>
        <div
          style={{
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          {vm.type ? `${vm.type} · ${vm.opened}` : vm.opened}
        </div>
      </header>

      {/* the honest briefing line — the synthesised secretary briefing is a
          later phase; for now ollie is gathering the scattered notes. a quiet
          sage line, never a deficit, never a chore. */}
      <div
        style={{
          marginTop: 24,
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
            marginTop: 5,
          }}
        />
        <span
          style={{
            fontSize: 13.5,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            lineHeight: 1.5,
          }}
        >
          ollie is gathering everything you&rsquo;ve thrown at this matter. the
          written-up briefing &mdash; where it stands, what&rsquo;s next &mdash;
          comes once it has enough.
        </span>
      </div>

      {/* THE NOTES — every raw dump routing has filed into this matter */}
      <div
        style={{
          borderTop: `1px solid ${v2.line}`,
          padding: '20px 2px 8px',
          marginTop: 26,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 15,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
            }}
          >
            notes filed here
          </span>
          <span
            style={{
              fontSize: 12,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.01em',
            }}
          >
            {vm.noteCount}
          </span>
        </div>

        {vm.noteCount === 0 ? (
          <div
            style={{
              fontSize: 13.5,
              color: v2.mute,
              fontWeight: 500,
              lineHeight: 1.5,
              padding: '4px 0 12px',
            }}
          >
            nothing filed here yet &mdash; the notes you throw settle in as
            ollie places them.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {vm.notes.map((n, i) => (
              <div
                key={n.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  padding: '13px 0',
                  borderTop: i === 0 ? 'none' : `1px solid ${v2.line}`,
                }}
              >
                <div
                  style={{
                    fontSize: 14.5,
                    color: v2.ink,
                    fontWeight: 500,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.5,
                  }}
                >
                  {n.text}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                  }}
                >
                  {n.when ? (
                    <span
                      style={{
                        fontSize: 12,
                        color: v2.mute,
                        fontWeight: 600,
                        letterSpacing: '0.01em',
                      }}
                    >
                      {n.when}
                    </span>
                  ) : null}
                  {n.isGuess ? (
                    <>
                      {n.when ? (
                        <span style={{ color: v2.line, fontSize: 12 }}>
                          &middot;
                        </span>
                      ) : null}
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            background: v2.accent,
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 11.5,
                            color: v2.accent,
                            fontWeight: 600,
                            letterSpacing: '0.01em',
                          }}
                        >
                          ollie&rsquo;s guess
                        </span>
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* a near-silent line on how the file got built — no filing by hand */}
      <div
        style={{
          borderTop: `1px solid ${v2.line}`,
          marginTop: 6,
          paddingTop: 19,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          padding: '19px 2px 0',
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
          you never filed any of this &mdash; ollie placed{' '}
          {vm.noteCount === 1 ? 'this note' : `these ${vm.noteCount} notes`} from
          what you threw.
        </span>
      </div>
    </Screen>
  );
}
