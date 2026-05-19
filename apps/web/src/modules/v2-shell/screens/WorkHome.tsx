/**
 * v2-shell · WorkHome — the work module homepage (work.html)
 *
 * Level 2. DIRECTION.md: work has 2 submodules — work · goals. With only
 * two, each card is a TALL preview block: a tailored gutter visual, the
 * glance line, and 2-3 lines of real previewed content at rest.
 *
 * Tapping a card (or its `open …` cue) mounts that submodule's real
 * `*-v2` app — the work app (the "matters" concept) or the goals app.
 */
import { HomepageShell } from './HomepageShell';
import { SubmoduleRow, ObservedNote } from './SubmoduleRow';
import { MatterStack, ProgressGauge } from './visuals';
import { v2 } from '../../money-v2/v2';
import type { SubmoduleKey } from '../types';

const box = { boxSizing: 'border-box' as const };

export interface WorkHomeProps {
  onBack: () => void;
  onFind: () => void;
  onSafe: () => void;
  onOpenSubmodule: (submodule: SubmoduleKey) => void;
}

const b = (t: string) => <b style={{ fontWeight: 600 }}>{t}</b>;

/** work — a matter row with a one-line status */
function MatterRow({ name, status, due = false, first = false }: { name: string; status: string; due?: boolean; first?: boolean }) {
  return (
    <div
      style={{
        ...box,
        display: 'flex',
        alignItems: 'baseline',
        gap: 11,
        padding: '9px 0',
        borderTop: first ? 'none' : `1px solid ${v2.line}`,
        paddingTop: first ? 2 : 9,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: 2,
          border: `1.5px solid ${due ? v2.umber : v2.mute}`,
          background: due ? v2.umber : 'transparent',
          flexShrink: 0,
          alignSelf: 'center',
        }}
      />
      <span style={{ fontSize: 14, color: v2.ink, fontWeight: 600, flexShrink: 0, letterSpacing: '-.01em' }}>{name}</span>
      <span style={{ flex: 1, fontSize: 12.5, color: due ? v2.umber : v2.mute, fontWeight: due ? 600 : 500, textAlign: 'right', letterSpacing: '-.01em' }}>
        {status}
      </span>
    </div>
  );
}

/** goals — a quiet goal row with a soft progress bar */
function GoalRow({ name, pct, first = false }: { name: string; pct: number; first?: boolean }) {
  return (
    <div
      style={{
        ...box,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderTop: first ? 'none' : `1px solid ${v2.line}`,
        paddingTop: first ? 2 : 10,
      }}
    >
      <span style={{ width: 54, height: 4, borderRadius: 3, background: v2.line, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 3, background: v2.accent }} />
      </span>
      <span style={{ flex: 1, fontSize: 14, color: v2.ink, fontWeight: 500, letterSpacing: '-.01em' }}>{name}</span>
      <span style={{ fontSize: 13, color: v2.mute, fontWeight: 600, flexShrink: 0 }}>{pct}%</span>
    </div>
  );
}

export function WorkHome({ onBack, onFind, onSafe, onOpenSubmodule }: WorkHomeProps) {
  return (
    <HomepageShell label="work" onBack={onBack} onFind={onFind} onSafe={onSafe}>
      <SubmoduleRow
        first
        label="work"
        vizWidth={62}
        visual={<MatterStack />}
        glance={
          <>
            {b('3 matters')} need you · <span style={{ color: v2.umber, fontWeight: 600 }}>Yılmaz files Thu</span>
          </>
        }
        openCue="open work"
        onOpen={() => onOpenSubmodule('work')}
        preview={
          <>
            <MatterRow first due name="Yılmaz · E-2" status="waiting on lease · files Thu" />
            <MatterRow name="Okafor · H-1B" status="RFE drafted · review next" />
            <MatterRow name="Reyes · green card" status="quiet · nothing due" />
          </>
        }
      />
      <SubmoduleRow
        last
        label="goals"
        vizWidth={62}
        visual={<ProgressGauge fill={40} />}
        glance={<>{b('learn spanish')} · 40%</>}
        openCue="open goals"
        onOpen={() => onOpenSubmodule('goals')}
        preview={
          <>
            <GoalRow first name="learn spanish" pct={40} />
            <GoalRow name="run a half marathon" pct={65} />
          </>
        }
      />

      <ObservedNote>you tend to file matters the day they&rsquo;re due</ObservedNote>
    </HomepageShell>
  );
}
