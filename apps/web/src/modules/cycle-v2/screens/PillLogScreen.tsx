/**
 * cycle-v2 · PillLogScreen — the 7-day pill strip (cycle-pill.html)
 *
 * One thing: the last 7 days as a row of day-dots. A logged day is a
 * filled sage dot with a tick; a missed-but-back-dateable day is an open
 * ink ring; a day beyond the 3-day reach is faint and untappable. Today
 * is the larger amber-edged dot. One amber "log today's pill" commit.
 *
 * Real data: dots come from `pillVM` over the live `cycle.items` (pill
 * events); tapping a day appends a real `pill` `CycleItem` through
 * `useCycleActions` — back-dated to local noon, exactly as the live
 * `CycleModule.PillLogSection` does.
 */
import { useMemo } from 'react';
import { Screen, AmberButton, IconCheck, IconPlus, v2 } from '../../money-v2/v2';
import { useCycleSlices } from '../useCycleSlices';
import { useCycleActions } from '../useCycleActions';
import { pillVM, PILL_BACKDATE_LIMIT } from '../selectors';
import type { PillDay } from '../selectors';

export interface PillLogScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

const DAY_NOON_MS = 12 * 60 * 60 * 1000;

export function PillLogScreen({ now, onBack, onSafe }: PillLogScreenProps) {
  const slices = useCycleSlices();
  const actions = useCycleActions(now);
  const pill = useMemo(() => pillVM(slices, now), [slices, now]);

  const pillTypeLabel =
    slices.settings.birth_control_type === 'progestin-only'
      ? 'progestin-only pill'
      : slices.settings.birth_control_type === 'other'
        ? 'birth control'
        : 'combined pill';

  function tapDay(d: PillDay) {
    if (d.logged) return;
    if (d.isToday) {
      actions.logPill(now);
      return;
    }
    if (d.backdateable) {
      actions.logPill(d.ts + DAY_NOON_MS);
    }
  }

  return (
    <Screen
      label="pill log"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0, alignItems: 'center' }}
    >
      {/* the lead */}
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
          textAlign: 'center',
        }}
      >
        <b style={{ fontWeight: 500 }}>the last 7 days</b>
      </div>
      <div style={{ marginTop: 6, fontSize: 13, color: v2.mute, fontWeight: 500 }}>
        {pillTypeLabel}
      </div>

      {/* the 7-day strip */}
      <div
        role="group"
        aria-label="pill log — last 7 days"
        style={{ marginTop: 54, display: 'flex', alignItems: 'flex-start' }}
      >
        {pill.strip.map((d) => (
          <PillDot key={d.key} day={d} onTap={() => tapDay(d)} />
        ))}
      </div>

      {/* the back-dateable rule */}
      <div
        aria-hidden
        style={{
          marginTop: 7,
          width: 182,
          height: 2,
          borderRadius: 1,
          backgroundImage: `repeating-linear-gradient(90deg,${v2.line} 0 5px,transparent 5px 9px)`,
        }}
      />
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        tap a past day to back-date — up to {PILL_BACKDATE_LIMIT} days
      </div>

      {/* one quiet state line */}
      <div
        style={{
          marginTop: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: pill.todayLogged ? v2.sage : v2.mute,
          }}
        />
        <span style={{ fontSize: 14, color: v2.ink, fontWeight: 500, letterSpacing: '-0.01em' }}>
          {pill.todayLogged ? 'today — logged' : 'today — not logged yet'}
        </span>
      </div>

      {!pill.todayLogged && (
        <AmberButton
          icon={<IconCheck size={18} />}
          onClick={() => actions.logPill(now)}
          style={{ marginTop: 24, height: 50, borderRadius: 25 }}
        >
          log today&rsquo;s pill
        </AmberButton>
      )}
    </Screen>
  );
}

interface PillDotProps {
  day: PillDay;
  onTap: () => void;
}

function PillDot({ day, onTap }: PillDotProps) {
  const tooOld = !day.logged && !day.isToday && !day.backdateable;
  const interactive = !day.logged && (day.isToday || day.backdateable);

  let dotStyle: React.CSSProperties;
  let glyph: React.ReactNode = null;

  if (day.logged) {
    dotStyle = { background: v2.sage };
    glyph = <IconCheck size={15} weight={2.6} stroke="#fff" />;
  } else if (day.isToday) {
    dotStyle = {
      border: `2.4px solid ${v2.accent}`,
      boxShadow: '0 8px 20px rgba(201,146,62,.26)',
    };
    glyph = <IconPlus size={16} weight={2.4} stroke={v2.accent} />;
  } else if (day.backdateable) {
    dotStyle = { border: `1.6px solid ${v2.mute}` };
  } else {
    dotStyle = { border: `1.4px solid ${v2.line}` };
  }

  return (
    <button
      type="button"
      disabled={!interactive}
      aria-pressed={day.logged}
      aria-label={
        day.logged
          ? `${day.label} pill logged`
          : day.isToday
            ? "log today's pill"
            : day.backdateable
              ? `back-date ${day.label} pill`
              : `${day.label} — out of back-date reach`
      }
      onClick={onTap}
      style={{
        boxSizing: 'border-box',
        width: 46,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 11,
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: interactive ? 'pointer' : 'default',
        opacity: tooOld ? 0.55 : 1,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span
        aria-hidden
        style={{
          boxSizing: 'border-box',
          width: 38,
          height: 38,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...dotStyle,
        }}
      >
        {glyph}
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.03em',
          color: day.isToday ? v2.accent : v2.mute,
        }}
      >
        {day.label}
      </span>
    </button>
  );
}
