/**
 * HabitsBox · /box/habits screen.
 *
 * Streak-free by design (see memory: feedback-ollie-no-streaks). Habits
 * track what the user does, never how many days in a row. There is no
 * count, no ring, no "streak broke" section, no shame.
 *
 * Surfaces:
 *   - box kicker + display title + standfirst
 *   - "today" section listing habits the user already checked off today
 *     (just a calm list — never a celebration)
 *   - "habits" registry: every named habit + a check affordance when the
 *     habit hasn't been done today + remove affordance
 *   - "identity notes" — single text rows the user dumped as
 *     "i am someone who…"
 *
 * Storage is unchanged: completions, identity events, and habit registry
 * still flow through ./repo. The component just stops surfacing the
 * streak count + streak-break event log.
 */

import { useCallback, useState, type CSSProperties } from 'react';
import { Stack, Row, Box } from '../../layout';
import { Text } from '../../ui';
import { colors } from '../../theme/tokens';
import { useModuleData } from '../../lib/useModuleData';
import { PatternCards } from '../../patterns/PatternCards';
import { migrateHabits } from './migrate';
import { registry, completions, events } from './repo';
import { HABIT_CUES, type Habit, type HabitCue, type HabitEvent, type IdentityData } from './types';

function parseIdentity(raw: string): string {
  try {
    return (JSON.parse(raw) as IdentityData).text;
  } catch {
    return raw;
  }
}

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

interface HabitRowVM {
  habit: Habit;
  doneToday: boolean;
}

export function HabitsBox(): JSX.Element {
  const [rows, setRows] = useState<HabitRowVM[]>([]);
  const [todayCompletions, setTodayCompletions] = useState<Habit[]>([]);
  const [identityEvents, setIdentityEvents] = useState<HabitEvent[]>([]);
  const [newName, setNewName] = useState('');
  const [newCue, setNewCue] = useState<HabitCue>('anytime');

  const refresh = useCallback(async () => {
    const habits = await registry.list();
    const [doneToday, identity] = await Promise.all([
      Promise.all(habits.map((h) => completions.completedToday(h.id))),
      events.listRecent('identity', 50),
    ]);
    const vmRows = habits.map((h, i) => ({ habit: h, doneToday: doneToday[i] ?? false }));
    setRows(vmRows);
    setTodayCompletions(vmRows.filter((r) => r.doneToday).map((r) => r.habit));
    setIdentityEvents(identity);
  }, []);

  const { ready } = useModuleData({
    migrationKey: 'habits',
    migrate: migrateHabits,
    refresh,
  });

  const handleCheck = useCallback(
    async (habitId: string) => {
      await completions.add(habitId);
      await refresh();
    },
    [refresh],
  );

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    await registry.ensure(name, newCue);
    setNewName('');
    setNewCue('anytime');
    await refresh();
  }, [newName, newCue, refresh]);

  const handleSetCue = useCallback(
    async (habitId: string, cue: HabitCue) => {
      await registry.setCue(habitId, cue);
      await refresh();
    },
    [refresh],
  );

  const handleRemoveHabit = useCallback(
    async (habitId: string) => {
      await registry.remove(habitId);
      await refresh();
    },
    [refresh],
  );

  const handleRemoveIdentity = useCallback(
    async (eventId: string) => {
      await events.remove(eventId);
      await refresh();
    },
    [refresh],
  );

  return (
    <Stack gap={56}>
      <Stack gap={12}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box · habits
        </Text>
        <Text
          scale="title"
          color={colors.ink}
          style={{
            fontFamily: 'var(--ollie-font-sans)',
            fontSize: '26px',
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
          }}
        >
          habits
        </Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 460 }}>
          a quiet list of what you do. no streaks, no scoring.
        </Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : (
        <Stack gap={48}>
          <Section label="today">
            {todayCompletions.length === 0 ? (
              <Text scale="body" color={colors.inkFaint}>
                nothing yet today.
              </Text>
            ) : (
              <Stack gap={12}>
                {todayCompletions.map((h) => (
                  <Box
                    key={h.id}
                    bg="cream"
                    radius="card"
                    shadow="raised"
                    style={{ padding: '16px 18px' }}
                  >
                    <Row gap={12} align="center">
                      <span
                        aria-hidden="true"
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          background: colors.sageDeep,
                          boxShadow:
                            'inset 3px 3px 6px rgba(120,140,122,0.55), inset -3px -3px 6px rgba(255,255,255,0.85)',
                          display: 'inline-block',
                          flexShrink: 0,
                        }}
                      />
                      <Text scale="body">{h.name}</Text>
                    </Row>
                  </Box>
                ))}
              </Stack>
            )}
          </Section>

          <Section label="habits">
            {/* add a habit — name + the cue window it's anchored to. */}
            <Stack gap={12} style={{ paddingBottom: 8 }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                }}
                placeholder="a habit you want to keep…"
                aria-label="new habit name"
                style={inputStyle}
              />
              <Row gap={16} align="baseline" justify="space-between">
                <CueChooser
                  value={newCue}
                  onChange={setNewCue}
                  ariaPrefix="new habit cue"
                />
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={newName.trim().length === 0}
                  style={{
                    ...buttonStyle,
                    color: newName.trim() ? colors.ink : colors.inkFaint,
                  }}
                  aria-label="add habit"
                >
                  add
                </button>
              </Row>
            </Stack>

            {rows.length === 0 ? (
              <Text scale="body" color={colors.inkFaint}>
                no habits yet — add one above, or dump &lsquo;did yoga&rsquo;.
              </Text>
            ) : (
              <Stack gap={12}>
                {rows.map((r) => (
                  <Box
                    key={r.habit.id}
                    bg="cream"
                    radius="card"
                    shadow="raised"
                    style={{ padding: '16px 18px' }}
                  >
                    <Stack gap={10}>
                      <Row gap={12} align="baseline" justify="space-between">
                        <Text scale="body">{r.habit.name}</Text>
                        <Row gap={12} align="baseline">
                          {!r.doneToday && (
                            <button
                              type="button"
                              onClick={() => void handleCheck(r.habit.id)}
                              style={buttonStyle}
                              aria-label={`mark ${r.habit.name} done`}
                            >
                              mark done
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleRemoveHabit(r.habit.id)}
                            style={buttonStyle}
                            aria-label={`remove ${r.habit.name}`}
                          >
                            remove
                          </button>
                        </Row>
                      </Row>
                      <CueChooser
                        value={r.habit.cue}
                        onChange={(c) => void handleSetCue(r.habit.id, c)}
                        ariaPrefix={`${r.habit.name} cue`}
                      />
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </Section>

          <Section label="identity notes">
            {identityEvents.length === 0 ? (
              <Text scale="body" color={colors.inkFaint}>
                nothing yet — try dumping &lsquo;i am someone who walks every
                morning&rsquo;.
              </Text>
            ) : (
              <Stack gap={12}>
                {identityEvents.map((ev) => (
                  <Box
                    key={ev.id}
                    bg="cream"
                    radius="card"
                    shadow="raised"
                    style={{ padding: '16px 18px' }}
                  >
                    <Row gap={12} align="baseline" justify="space-between">
                      <Text scale="body">{parseIdentity(ev.data)}</Text>
                      <button
                        type="button"
                        onClick={() => void handleRemoveIdentity(ev.id)}
                        style={buttonStyle}
                        aria-label="remove identity note"
                      >
                        remove
                      </button>
                    </Row>
                  </Box>
                ))}
              </Stack>
            )}
          </Section>

          {/* Layer-2 noticings — habit detectors, surfaced softly. Renders
              nothing when there are no patterns. */}
          <PatternCards module="habits" />
        </Stack>
      )}
    </Stack>
  );
}

/**
 * Calm 3-segment cue chooser — morning · anytime · evening. The active
 * segment is sage; the rest are faint. No box, no fill — just a quiet row of
 * words separated by hairline dots, in keeping with the editorial grammar.
 */
function CueChooser({
  value,
  onChange,
  ariaPrefix,
}: {
  value: HabitCue;
  onChange: (cue: HabitCue) => void;
  ariaPrefix: string;
}): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={ariaPrefix}
      style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}
    >
      {HABIT_CUES.map((cue, i) => {
        const active = cue === value;
        return (
          <Row key={cue} gap={10} align="baseline">
            {i > 0 && (
              <Text scale="caption" color={colors.inkFaint} aria-hidden>
                ·
              </Text>
            )}
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${ariaPrefix}: ${cue}`}
              onClick={() => onChange(cue)}
              style={{
                ...segmentStyle,
                color: active ? colors.sageDeep : colors.inkFaint,
              }}
            >
              {cue}
            </button>
          </Row>
        );
      })}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap={16}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        {label}
      </Text>
      {children}
    </Stack>
  );
}

const buttonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '4px 8px',
  color: colors.inkFaint,
  cursor: 'pointer',
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
  fontSize: 12,
};

const segmentStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
  fontSize: 12,
};

const inputStyle: CSSProperties = {
  background: colors.cream,
  border: 'none',
  borderRadius: 10,
  boxShadow:
    'inset 5px 5px 12px rgba(120,140,122,0.40), inset -5px -5px 12px rgba(255,255,255,0.78)',
  padding: '12px 16px',
  color: colors.ink,
  fontSize: 16,
  outline: 'none',
  width: '100%',
};
