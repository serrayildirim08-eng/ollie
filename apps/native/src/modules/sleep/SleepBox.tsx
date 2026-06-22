/**
 * SleepBox · /box/sleep screen.
 *
 * Extreme-minimal grammar: ONE focus — last night's duration — as a large
 * editorial serif figure inside a calm neumorphic hero card, the Layer-2
 * watcher cards, and a single "recent sleep" list. Everything else (week
 * bars, feel pills, wind-down/dreams/rough-night drills, cadence hint) was
 * removed for a one-focus-per-screen layout.
 *
 * Storage is untouched: this screen calls `sleepRepo.latestSleep`,
 * `sleepRepo.listByKind`, `sleepRepo.remove` and `migrateSleep` exactly
 * as before. Polling cadence and focus-refresh are preserved.
 */

import { useCallback, useState } from 'react';
import { Stack, Row, Box } from '../../layout';
import { Text } from '../../ui';
import { colors, fonts } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { useModuleData } from '../../lib/useModuleData';
import { PatternCards } from '../../patterns/PatternCards';
import { migrateSleep } from './migrate';
import { sleepRepo } from './repo';
import { type SleepEvent } from './types';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const RECENT_SLEEP_LIMIT = 7;

export function SleepBox(): JSX.Element {
  const [latest, setLatest] = useState<SleepEvent | null>(null);
  const [recentSleep, setRecentSleep] = useState<SleepEvent[]>([]);

  const refresh = useCallback(async () => {
    const [latestSleep, sleeps] = await Promise.all([
      sleepRepo.latestSleep(),
      sleepRepo.listByKind('sleep', RECENT_SLEEP_LIMIT),
    ]);
    setLatest(latestSleep);
    setRecentSleep(sleeps);
  }, []);

  const { ready } = useModuleData({
    migrationKey: 'sleep',
    migrate: migrateSleep,
    refresh,
  });

  const handleRemove = useCallback(
    async (id: string) => {
      await sleepRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  const anyData = latest !== null || recentSleep.length > 0;

  return (
    <Stack gap={48}>
      {/* page kicker */}
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          box
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
          sleep
        </Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : !anyData ? (
        <Text scale="body" color={colors.inkFaint}>
          no sleep logged yet — try dumping &lsquo;slept 7 hours&rsquo;
        </Text>
      ) : (
        <Stack gap={56}>
          {/* HERO — one focus, big serif figure */}
          <HeroSection latest={latest} />

          {/* Layer-2 noticings — soft cards from the sleep watcher (bedtime
              drift, revenge bedtime, caffeine×onset, weekday/weekend gap). */}
          <PatternCards module="sleep" />

          {/* recent week as a list */}
          <ListSection
            label="recent sleep"
            empty="—"
            items={recentSleep}
            renderItem={(event) => (
              <SleepRow
                key={event.id}
                event={event}
                onRemove={() => void handleRemove(event.id)}
              />
            )}
          />
        </Stack>
      )}
    </Stack>
  );
}

// ─── hero ─────────────────────────────────────────────────────────────────

function HeroSection({ latest }: { latest: SleepEvent | null }): JSX.Element {
  const sleepLatest = latest && latest.kind === 'sleep' ? latest : null;
  const totalMin =
    sleepLatest && sleepLatest.data.hoursSlept != null
      ? Math.round(sleepLatest.data.hoursSlept * 60)
      : null;

  return (
    <Box
      bg="paper"
      radius="card"
      shadow="card"
      style={{ padding: '28px 24px', alignSelf: 'stretch' }}
    >
      <Stack gap={8} align="center">
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          last night
        </Text>
        <Duration min={totalMin} />
        {sleepLatest && <SubLine event={sleepLatest} />}
      </Stack>
    </Box>
  );
}

function Duration({ min }: { min: number | null }): JSX.Element {
  if (min == null) {
    return (
      <span
        style={{
          fontFamily: fonts.serif,
          fontSize: 26,
          fontWeight: 400,
          color: colors.inkFaint,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        nothing logged yet
      </span>
    );
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return (
    <span
      aria-label={`${h} hours ${m} minutes`}
      style={{
        fontFamily: fonts.serif,
        fontSize: 74,
        fontWeight: 300,
        color: colors.ink,
        letterSpacing: '-0.04em',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'baseline',
      }}
    >
      {h}
      <span style={UNIT_STYLE}>h</span>
      <span style={{ display: 'inline-block', width: 12 }} />
      {String(m).padStart(2, '0')}
      <span style={UNIT_STYLE}>m</span>
    </span>
  );
}

const UNIT_STYLE: React.CSSProperties = {
  fontSize: 30,
  color: colors.inkFaint,
  fontWeight: 300,
  letterSpacing: '-0.02em',
};

function SubLine({
  event,
}: {
  event: Extract<SleepEvent, { kind: 'sleep' }>;
}): JSX.Element | null {
  const fragments: string[] = [];
  if (event.data.bedtime && event.data.wake) {
    fragments.push(`bed ${event.data.bedtime} → wake ${event.data.wake}`);
  } else if (event.data.bedtime) {
    fragments.push(`bed ${event.data.bedtime}`);
  } else if (event.data.wake) {
    fragments.push(`wake ${event.data.wake}`);
  }
  if (event.data.quality != null) {
    fragments.push(`quality ${event.data.quality}`);
  }
  if (event.data.feel) {
    fragments.push(event.data.feel);
  }
  if (fragments.length === 0) return null;
  return (
    <Text scale="caption" color={colors.inkSoft}>
      {fragments.join('  ·  ')}
    </Text>
  );
}

// ─── sections + rows ─────────────────────────────────────────────────────

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
        <Stack gap={12}>
          {items.map((item, i) => (
            <Box key={i} bg="cream" radius="card" shadow="raised" style={{ padding: '16px 18px' }}>
              {renderItem(item)}
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function SleepRow({
  event,
  onRemove,
}: {
  event: SleepEvent;
  onRemove: () => void;
}): JSX.Element {
  if (event.kind !== 'sleep') return <></>;
  return (
    <Stack gap={6}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{formatSleepLine(event)}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.occurredAt} />
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
        fontFamily: fonts.sans,
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 12,
        transition: 'color 120ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = colors.ink;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = colors.inkFaint;
      }}
    >
      remove
    </button>
  );
}

// ─── formatters ──────────────────────────────────────────────────────────

/** "7.5h · quality 4" / "bed 23:00 → wake 06:30" / "logged" */
function formatSleepLine(event: Extract<SleepEvent, { kind: 'sleep' }>): string {
  const parts: string[] = [];
  if (event.data.hoursSlept != null) {
    parts.push(`${event.data.hoursSlept}h`);
  } else if (event.data.bedtime && event.data.wake) {
    parts.push(`bed ${event.data.bedtime} → wake ${event.data.wake}`);
  } else if (event.data.bedtime) {
    parts.push(`bed ${event.data.bedtime}`);
  } else if (event.data.wake) {
    parts.push(`wake ${event.data.wake}`);
  }
  if (event.data.quality != null) {
    parts.push(`quality ${event.data.quality}`);
  }
  if (parts.length === 0) return 'logged';
  return parts.join(' · ');
}
