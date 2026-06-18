/**
 * GoalsBox · /box/goals screen.
 *
 * Ported on 2026-05-28 from the redesign/money-v2 web GoalsFace. The native
 * Tauri surface keeps the four functional sections (active goals,
 * milestones, obstacles, unassigned notes) but takes the editorial hero
 * treatment from the web v2:
 *
 *   - one focus goal in a soft 270° open progress arc, name in DM Serif
 *     Display, the "why" line set as a sage editorial italic;
 *   - a swipe dot row for the deck of N goals (when there's more than one);
 *   - a cold-state hero with an empty arc + seed glyph + a kind
 *     "clean slate, not a gap" line + a worked-example list, never a guilt
 *     zero.
 *
 * The four lists below the hero stay — they're what the box view is for.
 *
 * Storage is unchanged: this file is the only thing that moves. We call
 * the same `goals.*` and `events.*` repo we always have.
 *
 * Auto-refreshes on focus + every 6s so the screen catches additions made
 * from another tab / from a dump while the page is open.
 *
 * No framer-motion, no next-router, no safe-area padding — those web
 * idioms are dropped. CSS transitions stay quiet (no transitions needed
 * here; the dot select is instant).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  formatDays,
  daysSinceLast,
  medianIntervalDays,
  type CadenceEstimate,
} from '@ollie/cadence';
import { Stack, Row } from '../../layout';
import { Text, Button } from '../../ui';
import { colors, fonts, fontWeights, zIndex } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { useModuleData } from '../../lib/useModuleData';
import { PatternCards } from '../../patterns/PatternCards';
import { migrateGoals } from './migrate';
import {
  cadence as cadenceRepo,
  events as eventsRepo,
  goals as goalsRepo,
} from './repo';
import { GoalCreateModal } from './GoalCreateModal';
import type { GoalEvent, GoalWithLatest } from './types';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

export function GoalsBox(): JSX.Element {
  const [activeGoals, setActiveGoals] = useState<GoalWithLatest[]>([]);
  const [milestones, setMilestones] = useState<GoalEvent[]>([]);
  const [obstacles, setObstacles] = useState<GoalEvent[]>([]);
  const [unassigned, setUnassigned] = useState<GoalEvent[]>([]);
  const [progressCadence, setProgressCadence] = useState<Map<string, CadenceEstimate>>(
    () => new Map(),
  );
  // which goal in the deck is in focus — the swipe index
  const [focus, setFocus] = useState(0);
  // the rich create-a-goal overlay
  const [creating, setCreating] = useState(false);
  // delete-gating: the goal whose removal the user tapped, plus the gate's
  // verdict. `phase` drives which surface shows (the gentle low-mood hold,
  // or the ulysses-contract confirm). null = no removal in flight.
  const [pendingRemoval, setPendingRemoval] =
    useState<{ goal: GoalWithLatest; phase: 'confirm' | 'held' } | null>(null);

  const refresh = useCallback(async () => {
    const [g, m, o, u] = await Promise.all([
      goalsRepo.listWithLatest(),
      eventsRepo.listByKind('milestone'),
      eventsRepo.listByKind('obstacle'),
      eventsRepo.listUnassigned(),
    ]);
    setActiveGoals(g);
    setMilestones(m);
    setObstacles(o);
    setUnassigned(u);

    // Fan-out cadence reads — one per active goal. Keeps row render synchronous.
    const pairs = await Promise.all(
      g.map(
        async (goal) =>
          [goal.id, await cadenceRepo.getProgressCadenceFor(goal.id)] as const,
      ),
    );
    setProgressCadence(new Map(pairs));
  }, []);

  const { ready } = useModuleData({
    migrationKey: 'goals',
    migrate: migrateGoals,
    refresh,
  });

  // Tapping "remove" on a goal row no longer deletes immediately. We first
  // ask the repo whether deletion is allowed (the low-mood gate). If it's
  // held, we show a kind hold message and keep the goal. If it's allowed, we
  // open a confirm step that surfaces past-you's ulysses contract before any
  // destructive call.
  const handleRequestRemoveGoal = useCallback(
    async (goal: GoalWithLatest) => {
      const gate = await goalsRepo.canDelete(goal.id);
      if (!gate.allowed) {
        setPendingRemoval({ goal, phase: 'held' });
        return;
      }
      setPendingRemoval({ goal, phase: 'confirm' });
    },
    [],
  );

  // Explicit Remove confirm — the only path that actually deletes.
  const handleConfirmRemoveGoal = useCallback(async () => {
    const goal = pendingRemoval?.goal;
    if (!goal) return;
    setPendingRemoval(null);
    await goalsRepo.remove(goal.id);
    await refresh();
  }, [pendingRemoval, refresh]);

  const handleDismissRemoval = useCallback(() => {
    setPendingRemoval(null);
  }, []);

  const handleRemoveEvent = useCallback(
    async (id: string) => {
      await eventsRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  // clamp focus index to the current deck length so removing a goal
  // doesn't leave us pointed past the end.
  const idx = useMemo(
    () => Math.min(focus, Math.max(0, activeGoals.length - 1)),
    [focus, activeGoals.length],
  );

  const cold = activeGoals.length === 0;
  const focusGoal = cold ? null : activeGoals[idx];
  const nothingYet =
    cold &&
    milestones.length === 0 &&
    obstacles.length === 0 &&
    unassigned.length === 0;

  return (
    <Stack gap={48}>
      <Row justify="space-between" align="flex-end" gap={16}>
        <Stack gap={8}>
          <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
            box
          </Text>
          <Text scale="display">Goals</Text>
        </Stack>
        {/* a quiet affordance to open the rich create flow */}
        <NewGoalButton onClick={() => setCreating(true)} />
      </Row>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : (
        <Stack gap={48}>
          {/* HERO — focus goal in a soft arc, or a clean-slate cold state */}
          {focusGoal ? (
            <FocusHero
              goal={focusGoal}
              index={idx}
              total={activeGoals.length}
              onFocus={setFocus}
            />
          ) : (
            <ColdHero showExample={nothingYet} />
          )}

          {/* Layer-2 noticings — goal detectors (low-mood, obstacle echo,
              floating goal, …), surfaced softly. Renders nothing when empty. */}
          <PatternCards module="goals" />

          {/* active goals — registry rows, each with its latest progress note */}
          <ListSection
            label="active goals"
            empty="no active goals yet"
            items={activeGoals}
            renderItem={(g) => (
              <GoalRow
                key={g.id}
                goal={g}
                cadence={progressCadence.get(g.id)}
                onRemove={() => void handleRequestRemoveGoal(g)}
              />
            )}
          />

          {/* milestones — recent wins, across all goals */}
          <ListSection
            label="milestones"
            empty="no milestones yet"
            items={milestones}
            renderItem={(e) => (
              <EventRow
                key={e.id}
                event={e}
                onRemove={() => void handleRemoveEvent(e.id)}
              />
            )}
          />

          {/* obstacles — recent friction, across all goals */}
          <ListSection
            label="obstacles"
            empty="no obstacles noted"
            items={obstacles}
            renderItem={(e) => (
              <EventRow
                key={e.id}
                event={e}
                onRemove={() => void handleRemoveEvent(e.id)}
              />
            )}
          />

          {/* unassigned — events whose goal the router didn't name */}
          <ListSection
            label="unassigned notes"
            empty="nothing unassigned"
            items={unassigned}
            renderItem={(e) => (
              <EventRow
                key={e.id}
                event={e}
                onRemove={() => void handleRemoveEvent(e.id)}
              />
            )}
          />
        </Stack>
      )}

      {/* the rich create-a-goal overlay */}
      {creating ? (
        <GoalCreateModal
          onClose={() => setCreating(false)}
          onCreated={() => void refresh()}
        />
      ) : null}

      {/* delete-gating surfaces — a kind hold on hard days, or a ulysses
          confirm that shows past-you's note before anything is removed */}
      {pendingRemoval?.phase === 'held' ? (
        <DeleteHeldOverlay onClose={handleDismissRemoval} />
      ) : null}
      {pendingRemoval?.phase === 'confirm' ? (
        <DeleteConfirmOverlay
          goal={pendingRemoval.goal}
          onRemove={() => void handleConfirmRemoveGoal()}
          onKeep={handleDismissRemoval}
        />
      ) : null}
    </Stack>
  );
}

// ─── delete-gating overlays ─────────────────────────────────────────────────

const OVERLAY_BACKDROP: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: zIndex.modal,
  background: 'rgba(20, 20, 15, 0.32)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '48px 20px',
};

const OVERLAY_CARD: React.CSSProperties = {
  width: '100%',
  maxWidth: 420,
  background: colors.cream,
  border: `1px solid ${colors.hairline}`,
  borderRadius: 14,
  boxShadow: '0 12px 40px rgba(20, 25, 20, 0.10)',
  padding: '32px 28px',
  outline: 'none',
};

/**
 * Low-mood hold. The repo refused deletion (reason 'low_mood'): a goal can't
 * be deleted in the middle of a hard day. Non-dismissive copy — we're not
 * scolding, we're holding the door. The only action is to close; the goal
 * stays. It can be removed later, once the window lifts.
 */
function DeleteHeldOverlay({ onClose }: { onClose: () => void }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={OVERLAY_BACKDROP}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="this goal is being kept for now"
        onClick={(e) => e.stopPropagation()}
        style={OVERLAY_CARD}
      >
        <Stack gap={24} align="center">
          <div
            style={{
              fontFamily: fonts.serif,
              fontSize: 24,
              fontWeight: fontWeights.regular,
              color: colors.ink,
              letterSpacing: '-0.02em',
              lineHeight: 1.25,
              textAlign: 'center',
            }}
          >
            this is a hard day.
          </div>
          <div
            style={{
              fontFamily: fonts.serif,
              fontStyle: 'italic',
              fontSize: 17,
              color: colors.sageDeep,
              lineHeight: 1.5,
              textAlign: 'center',
              maxWidth: 320,
            }}
          >
            the goal isn&rsquo;t going anywhere. you can take it off the list
            another day, when it feels less heavy.
          </div>
          <Button variant="primary" onClick={onClose} aria-label="okay, keep it">
            okay
          </Button>
        </Stack>
      </div>
    </div>
  );
}

/**
 * Ulysses confirm. Deletion is allowed, but before we remove anything we put
 * past-you's contract front and centre — the note current-you left for exactly
 * this moment. Remove only fires on the explicit "remove" press; "keep it"
 * (and backdrop / Esc) dismiss without deleting.
 */
function DeleteConfirmOverlay({
  goal,
  onRemove,
  onKeep,
}: {
  goal: GoalWithLatest;
  onRemove: () => void;
  onKeep: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onKeep();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKeep]);

  return (
    <div onClick={onKeep} style={OVERLAY_BACKDROP}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`remove ${goal.name}?`}
        onClick={(e) => e.stopPropagation()}
        style={OVERLAY_CARD}
      >
        <Stack gap={24}>
          <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
            a note from past-you
          </Text>

          {/* the ulysses contract — the centerpiece */}
          {goal.ulyssesContract ? (
            <div
              style={{
                fontFamily: fonts.serif,
                fontStyle: 'italic',
                fontSize: 21,
                fontWeight: fontWeights.regular,
                color: colors.ink,
                letterSpacing: '-0.012em',
                lineHeight: 1.45,
              }}
            >
              &ldquo;{goal.ulyssesContract}&rdquo;
            </div>
          ) : (
            <div
              style={{
                fontFamily: fonts.serif,
                fontStyle: 'italic',
                fontSize: 18,
                color: colors.inkSoft,
                lineHeight: 1.45,
              }}
            >
              you didn&rsquo;t leave a note on this one — but you set it down for
              a reason once.
            </div>
          )}

          <Text scale="caption" color={colors.inkSoft}>
            removing <em style={{ fontFamily: fonts.serif }}>{goal.name}</em> takes
            it off your list for good.
          </Text>

          <Row gap={16} justify="flex-end" align="center">
            <Button variant="ghost" onClick={onKeep} aria-label="keep this goal">
              keep it
            </Button>
            <Button
              variant="secondary"
              onClick={onRemove}
              aria-label={`remove ${goal.name}`}
            >
              remove
            </Button>
          </Row>
        </Stack>
      </div>
    </div>
  );
}

// ─── the quiet "new goal" affordance ────────────────────────────────────────

function NewGoalButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="add a new goal"
      style={{
        background: 'none',
        border: `1px solid ${colors.hairline}`,
        borderRadius: 999,
        padding: '8px 16px',
        color: colors.sageDeep,
        cursor: 'pointer',
        fontFamily: fonts.sans,
        fontSize: 13,
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        whiteSpace: 'nowrap',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      + new goal
    </button>
  );
}

// ─── focus hero ───────────────────────────────────────────────────────────
// One goal in a soft 270° open progress arc, name in DM Serif Display,
// "why" set in a sage editorial italic. The arc % is a placeholder —
// goals don't have a progress field in storage yet, so we render an
// indeterminate ring (a quiet half-fill) and let the editorial type
// carry the meaning.

interface FocusHeroProps {
  goal: GoalWithLatest;
  index: number;
  total: number;
  onFocus: (i: number) => void;
}

function FocusHero({ goal, index, total, onFocus }: FocusHeroProps): JSX.Element {
  // The web GoalArc carries a numeric % we don't have in native storage.
  // Render a calm half-fill so the shape reads as "in progress" without
  // claiming a fake number. Once goals get an explicit progress field,
  // wire it here.
  const pct = goal.latestProgress ? 0.5 : null;

  return (
    <Stack gap={20} align="center">
      <GoalArc pct={pct} />

      {/* the goal name — DM Serif Display, calm and large */}
      <div
        style={{
          fontFamily: fonts.serif,
          fontSize: 28,
          fontWeight: fontWeights.regular,
          color: colors.ink,
          letterSpacing: '-0.022em',
          lineHeight: 1.1,
          textAlign: 'center',
          maxWidth: 420,
        }}
      >
        {goal.name}
      </div>

      {/* the editorial "why" italic — sage, intimate, never a deadline scold */}
      {goal.why ? (
        <div
          style={{
            fontFamily: fonts.serif,
            fontStyle: 'italic',
            fontSize: 17,
            fontWeight: fontWeights.regular,
            color: colors.sageDeep,
            letterSpacing: '-0.01em',
            lineHeight: 1.45,
            textAlign: 'center',
            maxWidth: 360,
          }}
        >
          {goal.why}
        </div>
      ) : (
        <div
          style={{
            fontSize: 13,
            color: colors.inkFaint,
            fontWeight: fontWeights.regular,
            letterSpacing: '0.01em',
            textAlign: 'center',
            maxWidth: 320,
          }}
        >
          no <em style={{ fontFamily: fonts.serif }}>why</em> set yet —
          add one when you&rsquo;re ready
        </div>
      )}

      {/* the latest progress note — one calm forward line under the why */}
      {goal.latestProgress ? (
        <div
          style={{
            fontSize: 13,
            color: colors.inkSoft,
            fontWeight: fontWeights.regular,
            letterSpacing: '0.01em',
            lineHeight: 1.55,
            textAlign: 'center',
            maxWidth: 360,
          }}
        >
          <span style={SMCP_STYLE}>latest</span>{' '}
          &middot; {goal.latestProgress.text}
        </div>
      ) : null}

      {/* the swipe dots — this goal of N */}
      {total > 1 ? (
        <Row gap={7} justify="center">
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`focus goal ${i + 1} of ${total}`}
              aria-current={i === index}
              onClick={() => onFocus(i)}
              style={{
                width: 6,
                height: 6,
                padding: 0,
                borderRadius: '50%',
                border: 'none',
                background: i === index ? colors.sageDeep : colors.hairline,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            />
          ))}
        </Row>
      ) : null}
    </Stack>
  );
}

// ─── cold hero ────────────────────────────────────────────────────────────
// Empty arc with a seed glyph + a kind "clean slate, not a gap" line, plus
// a quiet worked-example list — only shown when truly nothing-yet (no
// goals, no events). When there are unassigned/milestone/obstacle events
// but no registry rows, we drop the example to keep the page from feeling
// barren.

function ColdHero({ showExample }: { showExample: boolean }): JSX.Element {
  return (
    <Stack gap={24} align="center">
      <GoalArc pct={null}>
        <SeedGlyph />
      </GoalArc>

      <div
        style={{
          fontFamily: fonts.serif,
          fontSize: 22,
          fontWeight: fontWeights.regular,
          color: colors.ink,
          letterSpacing: '-0.018em',
          lineHeight: 1.3,
          textAlign: 'center',
          maxWidth: 340,
        }}
      >
        <em style={{ color: colors.sageDeep }}>no goals yet</em> &mdash; a clean
        slate, not a gap.
      </div>

      <div
        style={{
          fontSize: 13.5,
          color: colors.inkSoft,
          fontWeight: fontWeights.regular,
          letterSpacing: '0.005em',
          lineHeight: 1.55,
          textAlign: 'center',
          maxWidth: 360,
        }}
      >
        this is where the bigger things live — ollie holds the milestones,
        the block you saw coming, and a soft check-in now and then. add
        one when you&rsquo;re ready, none before.
      </div>

      {showExample ? <ColdExample /> : null}
    </Stack>
  );
}

// ─── the cold worked example (goals-cold.html on web) ─────────────────────

const EXAMPLE_ROWS: { name: string; cat: string }[] = [
  { name: 'learn a language', cat: 'learning' },
  { name: 'run a half marathon', cat: 'health' },
  { name: 'finish the side project', cat: 'creative' },
];

function ColdExample(): JSX.Element {
  return (
    <Stack gap={4} style={{ alignSelf: 'stretch', marginTop: 16 }}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        the kinds of things that live here
      </Text>
      <Stack gap={0}>
        {EXAMPLE_ROWS.map((eg, i) => (
          <Row
            key={eg.name}
            gap={12}
            align="center"
            style={{
              boxSizing: 'border-box',
              borderTop: `1px solid ${colors.hairline}`,
              borderBottom:
                i === EXAMPLE_ROWS.length - 1
                  ? `1px solid ${colors.hairline}`
                  : 'none',
              padding: '14px 2px',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: colors.paper,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: colors.inkFaint,
                fontFamily: fonts.serif,
                fontStyle: 'italic',
                fontSize: 14,
              }}
            >
              {eg.cat.charAt(0)}
            </span>
            <Stack gap={2} style={{ flex: 1 }}>
              <Text scale="body" color={colors.ink}>
                {eg.name}
              </Text>
              <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
                {eg.cat}
              </Text>
            </Stack>
          </Row>
        ))}
      </Stack>
    </Stack>
  );
}

// ─── lists ────────────────────────────────────────────────────────────────

function ListSection<T>({
  label,
  empty,
  items,
  renderItem,
}: {
  label: string;
  empty: string;
  items: T[];
  renderItem: (item: T) => JSX.Element;
}): JSX.Element {
  return (
    <Stack gap={16}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        {label}
      </Text>
      {items.length === 0 ? (
        <Text scale="body" color={colors.inkFaint}>
          {empty}
        </Text>
      ) : (
        <Stack gap={4}>{items.map(renderItem)}</Stack>
      )}
    </Stack>
  );
}

function GoalRow({
  goal,
  cadence,
  onRemove,
}: {
  goal: GoalWithLatest;
  cadence?: CadenceEstimate | undefined;
  onRemove: () => void;
}): JSX.Element {
  // Prefer the latest progress timestamp (the freshest signal of activity)
  // but fall back to the goal's own createdAt so cold rows still carry a
  // when-stamp.
  const whenTs = goal.latestProgress?.loggedAt ?? goal.createdAt;
  return (
    <Row gap={12} align="baseline" justify="space-between">
      <Stack gap={2}>
        <Text scale="body" color={colors.ink}>
          {goal.name}
        </Text>
        {goal.latestProgress ? (
          <Text scale="caption" color={colors.inkFaint}>
            {goal.latestProgress.text}
          </Text>
        ) : null}
        {/* editorial italic for the goal's "why" line */}
        {goal.why ? (
          <span
            style={{
              fontFamily: fonts.serif,
              fontStyle: 'italic',
              fontSize: 13,
              color: colors.sageDeep,
              letterSpacing: '-0.005em',
              lineHeight: 1.45,
            }}
          >
            {goal.why}
          </span>
        ) : null}
        <WhenCaption ts={whenTs} />
        {cadence && <CadenceHint estimate={cadence} subject={goal.name} />}
      </Stack>
      <RemoveButton onClick={onRemove} />
    </Row>
  );
}

/**
 * Faint sub-line under a goal row: "last touched 3 days ago · usually
 * every 5 days". Silent at low-data — Serra's minimal UI prefers nothing
 * to a misleading prediction. Reads from progress events only — milestones
 * and obstacles don't dilute the rhythm.
 */
function CadenceHint({
  estimate,
  subject: _subject,
}: {
  estimate: CadenceEstimate;
  subject: string;
}): JSX.Element | null {
  if (estimate.confidence === 'low-data' || estimate.lastTs == null) {
    return null;
  }
  const now = Date.now();
  const since = daysSinceLast(estimate, now) ?? 0;
  const every = medianIntervalDays(estimate);
  const sinceLabel = formatDays(since);
  const everyLabel = every >= 1 ? formatDays(every) : 'less than a day';
  return (
    <Text
      scale="caption"
      color={colors.inkFaint}
      style={{ fontVariantCaps: 'all-small-caps', letterSpacing: '0.06em' }}
    >
      {`last touched ${sinceLabel} ago · usually every ${everyLabel}`}
    </Text>
  );
}


function EventRow({
  event,
  onRemove,
}: {
  event: GoalEvent;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body" color={colors.ink}>
          {event.text}
        </Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.loggedAt} />
    </Stack>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label="remove"
      style={{
        background: 'none',
        border: 'none',
        padding: '4px 8px',
        color: colors.inkFaint,
        cursor: 'pointer',
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 12,
      }}
    >
      remove
    </button>
  );
}

// ─── the soft 270° open progress arc ─────────────────────────────────────
// A hand-rolled SVG ring that opens at the bottom — the web design's
// iconic treatment. `pct` is 0–1 (the green sweep) or null (an empty arc,
// for the cold state). The opening at the bottom makes the shape feel
// breathing rather than closed-loop scoring.

function GoalArc({
  pct,
  children,
}: {
  pct: number | null;
  children?: React.ReactNode;
}): JSX.Element {
  const size = 168;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  // 270° open at the bottom: start at 135°, sweep 270° to 45°.
  const startA = 135;
  const sweep = 270;
  const startRad = (Math.PI / 180) * startA;
  const endRad = (Math.PI / 180) * (startA + sweep);
  const x1 = cx + radius * Math.cos(startRad);
  const y1 = cy + radius * Math.sin(startRad);
  const x2 = cx + radius * Math.cos(endRad);
  const y2 = cy + radius * Math.sin(endRad);
  const bgPath = `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}`;

  // For the foreground sweep we trim to `pct` of the 270° arc.
  const filledRad = (Math.PI / 180) * (startA + sweep * (pct ?? 0));
  const fx = cx + radius * Math.cos(filledRad);
  const fy = cy + radius * Math.sin(filledRad);
  const largeArc = sweep * (pct ?? 0) > 180 ? 1 : 0;
  const fgPath = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${fx} ${fy}`;

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden
        style={{ position: 'absolute', inset: 0 }}
      >
        <path
          d={bgPath}
          fill="none"
          stroke={colors.hairline}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {pct !== null && pct > 0 ? (
          <path
            d={fgPath}
            fill="none"
            stroke={colors.sageDeep}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        ) : null}
      </svg>
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── the seed glyph (cold state) ─────────────────────────────────────────
// A hand-rolled inline-SVG seed — replaces the web v2's IconSeed. Calm,
// muted, never a zero.

function SeedGlyph(): JSX.Element {
  return (
    <svg
      width={34}
      height={34}
      viewBox="0 0 34 34"
      aria-hidden
      fill="none"
      stroke={colors.inkFaint}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* a soft teardrop seed */}
      <path d="M17 6 C 22 11, 24 17, 22 23 C 20 28, 14 28, 12 23 C 10 17, 12 11, 17 6 Z" />
      {/* a quiet sprout line down the centre */}
      <path d="M17 13 L 17 22" />
    </svg>
  );
}
