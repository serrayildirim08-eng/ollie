/**
 * body-v2 · BodyFace — the body submodule page (Level 2)
 *
 * Mirrors body-detail.html (an episode is open → the EPISODE is the hero,
 * a calm day-counter, water demoted to a quiet background line) and
 * body-cold.html (no episode → WATER is the hero, the big filling glass,
 * a calm first-glass invitation). One face, two foci — picked by
 * `faceVM().focus`.
 *
 * Real data: every line comes from `selectors.ts` over the live `body.*`
 * slices via `useBodySlices`. The amber action mutates the live store via
 * `useBodyActions`.
 */
import { useMemo } from 'react';
import { Screen, NavRow, AmberButton, IconPlus, v2 } from '../../money-v2/v2';
import { useBodySlices } from '../useBodySlices';
import { useBodyActions } from '../useBodyActions';
import { faceVM } from '../selectors';
import { Glass } from '../components/Glass';
import { SeverityArc } from '../components/SeverityArc';
import type { BodyRoute } from '../BodyApp';

export interface BodyFaceProps {
  now: number;
  navigate: (to: BodyRoute) => void;
  onSafe: () => void;
}

export function BodyFace({ now, navigate, onSafe }: BodyFaceProps) {
  const slices = useBodySlices();
  const actions = useBodyActions(now);
  const face = useMemo(() => faceVM(slices, now), [slices, now]);

  return (
    <Screen label="body" onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      <div
        style={{
          marginTop: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {face.focus === 'episode' && face.episode ? (
          <EpisodeHero
            name={face.episode.label || 'episode'}
            day={face.episodeDay}
            lastSeverity={face.lastSeverity}
            arc={face.severityArc}
            waterCount={face.waterCount}
            waterTarget={face.waterTarget}
            suppTaken={face.suppTaken}
            suppTotal={face.suppTotal}
            onLog={() => navigate('episode')}
          />
        ) : (
          <WaterHero
            count={face.waterCount}
            target={face.waterTarget}
            cold={!face.hasAnyData && face.waterCount === 0}
            onAdd={() => actions.addGlass()}
          />
        )}
      </div>

      {/* DRILL ROWS */}
      <div style={{ marginTop: 46, display: 'flex', flexDirection: 'column' }}>
        <NavRow
          first
          rowKey="intake"
          value="water &amp; supplements today"
          onOpen={() => navigate('intake')}
        />
        <NavRow
          rowKey="symptoms"
          value={face.symptomsLine}
          dim={face.symptomsCold}
          onOpen={() => navigate('symptoms')}
        />
        <NavRow
          rowKey="conditions"
          value={face.conditionsLine}
          dim={face.conditionsCold}
          onOpen={() => navigate('conditions')}
        />
        <NavRow
          rowKey="doctor summary"
          value={face.doctorLine}
          dim={face.doctorCold}
          last={!face.patternLine}
          onOpen={() => navigate('doctor')}
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
        what body sends &mdash; and what it never does
      </button>
    </Screen>
  );
}

// ─── the water hero (body-cold.html) ─────────────────────────────────────────

interface WaterHeroProps {
  count: number;
  target: number;
  cold: boolean;
  onAdd: () => void;
}

function WaterHero({ count, target, cold, onAdd }: WaterHeroProps) {
  return (
    <>
      <Glass fill={target > 0 ? count / target : 0} size="big" />

      <div
        style={{
          marginTop: 20,
          fontSize: 46,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.03em',
          lineHeight: 1,
        }}
      >
        {count}
        <span style={{ fontSize: 20, color: v2.mute, fontWeight: 300, letterSpacing: '-0.01em' }}>
          {' '}
          of {target}
        </span>
      </div>
      <div
        style={{
          marginTop: 5,
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        glasses today
      </div>

      {cold && (
        <div
          style={{
            marginTop: 24,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
            maxWidth: 294,
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
              lineHeight: 1.45,
              textAlign: 'left',
            }}
          >
            <b style={{ fontWeight: 600 }}>
              this is body &mdash; water, supplements, anything the body does.
            </b>{' '}
            a glass of water is the easiest first thing to put down.
          </span>
        </div>
      )}

      <AmberButton
        icon={<IconPlus size={18} />}
        onClick={onAdd}
        style={{ marginTop: 26, height: 50, borderRadius: 25 }}
      >
        {count === 0 ? 'first glass' : 'a glass'}
      </AmberButton>
    </>
  );
}

// ─── the episode hero (body-detail.html) ─────────────────────────────────────

interface EpisodeHeroProps {
  name: string;
  day: string;
  lastSeverity: number | null;
  arc: number[];
  waterCount: number;
  waterTarget: number;
  suppTaken: number;
  suppTotal: number;
  onLog: () => void;
}

function EpisodeHero({
  name,
  day,
  lastSeverity,
  arc,
  waterCount,
  waterTarget,
  suppTaken,
  suppTotal,
  onLog,
}: EpisodeHeroProps) {
  return (
    <>
      {arc.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SeverityArc points={arc} variant="mini" />
        </div>
      )}

      <div
        style={{
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        open episode
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
        {name}
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 14,
          color: v2.ink,
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}
      >
        <b style={{ fontWeight: 600 }}>{day}</b>
        {lastSeverity != null && (
          <>
            <span style={{ color: v2.line, margin: '0 7px' }}>&middot;</span>
            last check-in <b style={{ fontWeight: 600 }}>{lastSeverity}</b> of 5
          </>
        )}
      </div>

      <AmberButton
        icon={<IconPlus size={18} />}
        onClick={onLog}
        style={{ marginTop: 26, height: 50, borderRadius: 25 }}
      >
        log onto it
      </AmberButton>

      {/* water, quietly in the background while the episode runs */}
      <div
        style={{
          marginTop: 30,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Glass
            fill={waterTarget > 0 ? waterCount / waterTarget : 0}
            size="small"
          />
          <span
            style={{
              fontSize: 13,
              color: v2.mute,
              fontWeight: 500,
              letterSpacing: '-0.01em',
            }}
          >
            <b style={{ color: v2.ink, fontWeight: 600 }}>{waterCount}</b> of{' '}
            {waterTarget} glasses today
          </span>
        </div>
        {suppTotal > 0 && (
          <div
            style={{
              fontSize: 12,
              color: v2.mute,
              fontWeight: 500,
              letterSpacing: '0.01em',
            }}
          >
            supplements &middot; {suppTaken} of {suppTotal}
          </div>
        )}
      </div>
    </>
  );
}
