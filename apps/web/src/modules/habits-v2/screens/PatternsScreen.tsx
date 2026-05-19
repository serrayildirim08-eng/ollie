/**
 * habits-v2 · PatternsScreen — "see the rest" (habits-patterns.html)
 *
 * The reflective surface for the habit pattern detectors. A calm reading
 * page — never a charts wall, never a scoreboard. Quietly-labelled groups,
 * each a cluster of ONE-LINE observations with a soft sage dot and a gentle
 * reframe sub-line. No charts, no badges, no counts, no red. It reads like
 * a journal: habits don't die, they cycle. The closing note restates that
 * this surface is screen-only — none of it is ever pushed.
 *
 * Real data + honest stub: when the orchestrator's habits detector has
 * written real patterns into `habits.patterns`, they surface here as a
 * "what ollie noticed" group. The 24 detectors (`detectPatterns` +
 * tier-1/phase-2/cross-module in `@ollie/logic/habits`) need a full
 * cross-module history the preview store doesn't always carry, so until the
 * orchestrator has run, the screen shows the canonical spec example set and
 * SAYS SO plainly — `patternsVM().isExample` drives an honest "example
 * observations" banner. (Reported as a presentation/example stub.)
 */
import { useMemo } from 'react';
import { Screen, IconInfo, v2 } from '../../money-v2/v2';
import { useHabitsSlices } from '../useHabitsSlices';
import { patternsVM, type PatternLine } from '../selectors';

export interface PatternsScreenProps {
  onBack: () => void;
}

export function PatternsScreen({ onBack }: PatternsScreenProps) {
  const slices = useHabitsSlices();
  const vm = useMemo(() => patternsVM(slices), [slices]);

  return (
    <Screen label="see the rest" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
      {/* the framing line — sets the supportive tone */}
      <div style={{ marginTop: 44 }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.02em',
            lineHeight: 1.3,
          }}
        >
          <b style={{ fontWeight: 500 }}>what ollie noticed</b> in how your
          habits run
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 14,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          none of this needs doing today. it&rsquo;s here to read when
          you&rsquo;re curious &mdash; quiet patterns, not instructions. a gap
          is never a verdict.
        </div>
      </div>

      {/* the honest example banner — only when no real pattern is on file */}
      {vm.isExample && (
        <div
          style={{
            marginTop: 18,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '13px 15px',
            background: '#F0F3F0',
            borderRadius: 14,
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
              marginTop: 5,
            }}
          />
          <span
            style={{
              fontSize: 13,
              color: '#5A6B5F',
              fontWeight: 400,
              lineHeight: 1.5,
            }}
          >
            ollie hasn&rsquo;t gathered enough days yet &mdash; these are{' '}
            <b style={{ color: v2.ink, fontWeight: 600 }}>example patterns</b>,
            the kinds of thing it watches for. your own will replace them once
            a couple of weeks are on file.
          </span>
        </div>
      )}

      {/* the patterns — quietly-labelled groups of one-line observations */}
      {vm.groups.map((group) => (
        <div key={group.label} style={{ marginTop: 30 }}>
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
            {group.label}
          </div>
          {group.lines.map((line, i) => (
            <PatternRow
              key={line.key}
              line={line}
              last={i === group.lines.length - 1}
            />
          ))}
        </div>
      ))}

      {/* the closing note — screen-only, never pushed */}
      <div
        style={{
          marginTop: 26,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <span style={{ flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>
          <IconInfo size={15} stroke={v2.mute} />
        </span>
        <span
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          ollie notices patterns &mdash; it never scores you, and none of this
          is ever sent as a notification. it waits here for when you want it.
        </span>
      </div>
    </Screen>
  );
}

// ─── one observation row ─────────────────────────────────────────────────────

function PatternRow({ line, last }: { line: PatternLine; last: boolean }) {
  return (
    <div
      style={{
        borderTop: `1px solid ${v2.line}`,
        borderBottom: last ? `1px solid ${v2.line}` : 'none',
        padding: '16px 0',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 11,
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            lineHeight: 1.4,
          }}
        >
          {line.line}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.45,
          }}
        >
          {line.frame}
        </div>
      </div>
    </div>
  );
}
