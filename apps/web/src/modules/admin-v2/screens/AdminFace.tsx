/**
 * admin-v2 · AdminFace — the admin submodule page (Level 2)
 *
 * Mirrors admin.html (a renewal is due → the NEXT THING is the hero, the
 * renewal-runway above it, a calm days-left line, one amber "do this one"
 * route) and admin-cold.html (nothing tracked → a bare runway, an honest
 * "admin is empty" invitation, a worked example of what admin holds).
 * One face, two states — picked by `faceVM().nextDue`.
 *
 * Real data: every line comes from `selectors.ts` over the live `admin.tasks`
 * slice via `useAdminSlices`. The drill rows route to the leaf screens.
 */
import { useMemo } from 'react';
import { Screen, NavRow, AmberButton, IconPlus, IconCheck, v2 } from '../../money-v2/v2';
import { useAdminSlices } from '../useAdminSlices';
import { faceVM } from '../selectors';
import { Runway } from '../components/Runway';
import type { AdminRoute } from '../AdminApp';

export interface AdminFaceProps {
  now: number;
  navigate: (to: AdminRoute) => void;
  onOpenTask: (id: string) => void;
  onSafe: () => void;
}

export function AdminFace({ now, navigate, onOpenTask, onSafe }: AdminFaceProps) {
  const slices = useAdminSlices();
  const face = useMemo(() => faceVM(slices, now), [slices, now]);

  return (
    <Screen label="admin" onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      <div
        style={{
          marginTop: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {face.nextDue ? (
          <NextDueHero
            title={face.nextDue.title}
            category={face.nextDue.category}
            daysLine={face.nextDue.daysLine}
            runwayPos={face.nextDue.isRenewal ? face.nextDue.runwayPos : null}
            onAct={() => onOpenTask(face.nextDue!.id)}
          />
        ) : (
          <ColdHero onAdd={() => navigate('add')} />
        )}
      </div>

      {/* a worked example — only on the cold face, so it's never barren */}
      {!face.nextDue && !face.hasAnyData && <ColdExample />}

      {/* DRILL ROWS */}
      <div style={{ marginTop: face.nextDue ? 50 : 36, display: 'flex', flexDirection: 'column' }}>
        {face.nextDue && (
          <NavRow
            first
            rowKey="calls to make"
            value={
              face.callCount === 0
                ? 'none waiting'
                : `${face.callCount} waiting`
            }
            dim={face.callCount === 0}
            onOpen={() => navigate('calls')}
          />
        )}
        <NavRow
          first={!face.nextDue}
          rowKey="all tasks"
          value={
            face.activeCount === 0
              ? 'nothing on the list yet'
              : face.dueThisWeek > 0
                ? `${face.activeCount} active · ${face.dueThisWeek} due this week`
                : `${face.activeCount} active`
          }
          dim={face.activeCount === 0}
          onOpen={() => navigate('tasks')}
        />
        <NavRow
          rowKey="2-min burst"
          value={
            face.burstCount === 0
              ? 'quick things show up here as you add them'
              : `${face.burstCount} quick thing${face.burstCount === 1 ? '' : 's'} ready`
          }
          dim={face.burstCount === 0}
          last={!face.patternLine}
          onOpen={() => navigate('burst')}
        />
        {/* the observed-pattern row — only present when a pattern is live */}
        {face.patternLine && (
          <NavRow
            flag
            last
            rowKey="see the rest"
            value={face.patternLine}
            onOpen={() => navigate('patterns')}
          />
        )}
      </div>

      {/* a quiet way to preview the notification voice */}
      <button
        type="button"
        onClick={() => navigate('notifications')}
        style={{
          marginTop: 28,
          alignSelf: 'center',
          background: 'transparent',
          border: 'none',
          fontSize: 12,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        what admin sends &mdash; and what it never does
      </button>
    </Screen>
  );
}

// ─── the next-due hero (admin.html) ──────────────────────────────────────────

interface NextDueHeroProps {
  title: string;
  category: string;
  daysLine: string;
  /** the runway marker pos 0..1, or null for a non-renewal */
  runwayPos: number | null;
  onAct: () => void;
}

function NextDueHero({ title, category, daysLine, runwayPos, onAct }: NextDueHeroProps) {
  return (
    <>
      <Runway pos={runwayPos} />

      <div
        style={{
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        next thing due
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 40,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.03em',
          lineHeight: 1.05,
          textAlign: 'center',
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 13,
          fontSize: 14,
          color: v2.ink,
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        <b style={{ fontWeight: 600, color: '#A8703C' }}>{daysLine}</b>
        <span style={{ color: v2.line, margin: '0 7px' }}>&middot;</span>
        {category}
      </div>

      <AmberButton
        icon={<IconCheck size={18} />}
        onClick={onAct}
        style={{ marginTop: 26, height: 50, borderRadius: 25 }}
      >
        do this one
      </AmberButton>
    </>
  );
}

// ─── the cold hero (admin-cold.html) ─────────────────────────────────────────

interface ColdHeroProps {
  onAdd: () => void;
}

function ColdHero({ onAdd }: ColdHeroProps) {
  return (
    <>
      <Runway pos={null} />

      <div
        style={{
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        nothing due yet
      </div>
      <div
        style={{
          marginTop: 9,
          fontSize: 30,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.025em',
          lineHeight: 1.25,
          textAlign: 'center',
          maxWidth: 282,
        }}
      >
        admin is empty &mdash; that&rsquo;s fine
      </div>

      <div
        style={{
          marginTop: 22,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          maxWidth: 296,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
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
            lineHeight: 1.5,
            textAlign: 'left',
          }}
        >
          this is where the <b style={{ fontWeight: 600 }}>stuff you forget</b>{' '}
          lives &mdash; passport, lease, taxes, the dentist. add the first one
          and ollie will carry the dates.
        </span>
      </div>

      <AmberButton
        icon={<IconPlus size={18} />}
        onClick={onAdd}
        style={{ marginTop: 30, height: 50, borderRadius: 25 }}
      >
        add the first thing
      </AmberButton>
    </>
  );
}

// ─── the cold worked example (admin-cold.html) ───────────────────────────────

const EXAMPLE_ROWS: { name: string; type: string }[] = [
  { name: 'renew passport', type: 'renewal' },
  { name: 'book a dentist cleaning', type: 'appointment' },
  { name: 'file the taxes', type: 'financial' },
];

function ColdExample() {
  return (
    <div style={{ marginTop: 38, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          fontSize: 11,
          color: v2.mute,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        things people put here
      </div>
      {EXAMPLE_ROWS.map((eg, i) => (
        <div
          key={eg.name}
          style={{
            boxSizing: 'border-box',
            borderTop: `1px solid ${v2.line}`,
            borderBottom: i === EXAMPLE_ROWS.length - 1 ? `1px solid ${v2.line}` : 'none',
            padding: '14px 2px',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: 2,
              border: `1.4px solid ${v2.line}`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              flex: 1,
              fontSize: 14,
              color: v2.mute,
              fontWeight: 400,
              letterSpacing: '-0.01em',
            }}
          >
            {eg.name}
          </span>
          <span style={{ fontSize: 12, color: v2.mute, fontWeight: 500, flexShrink: 0 }}>
            {eg.type}
          </span>
        </div>
      ))}
    </div>
  );
}
