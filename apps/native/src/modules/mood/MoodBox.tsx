/**
 * MoodBox · /box/mood screen.
 *
 * Deliberately minimal — Serra wants extreme-minimal UI: NO charts, NO
 * streaks, no scoring. A quiet sectioned list of today's mood / energy /
 * self-talk entries (label + relative time), each with a small "remove"
 * affordance. The AI router still does the writing; this is a review +
 * cleanup surface.
 *
 * Auto-refreshes on focus + every 6s so the screen catches additions made
 * from another tab / from a dump while the page is open.
 */

import { useCallback, useState } from 'react';
import { Stack, Row, Box } from '../../layout';
import { Text } from '../../ui';
import { colors, fontWeights } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { useModuleData } from '../../lib/useModuleData';
import { migrateMood } from './migrate';
import { events as eventsRepo } from './repo';
import {
  getLabel,
  getStatement,
  getValence,
  sectionForKind,
  startOfTodayMs,
  type MoodEvent,
  type MoodSection,
} from './types';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

export function MoodBox(): JSX.Element {
  const [items, setItems] = useState<MoodEvent[]>([]);

  const refresh = useCallback(async () => {
    const list = await eventsRepo.list();
    setItems(list);
  }, []);

  const { ready } = useModuleData({
    migrationKey: 'mood',
    migrate: migrateMood,
    refresh,
  });

  const handleRemove = useCallback(
    async (id: string) => {
      await eventsRepo.remove(id);
      await refresh();
    },
    [refresh],
  );

  const todayStart = startOfTodayMs();
  const today = items.filter((e) => e.loggedAt >= todayStart);
  const grouped = groupBySection(today);
  const isEmpty = today.length === 0;

  return (
    <Stack gap={48}>
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
          mood
        </Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : isEmpty ? (
        <ColdStart />
      ) : (
        <Stack gap={48}>
          <ListSection label="mood" items={grouped.mood}>
            {(e) => (
              <MoodRow key={e.id} event={e} onRemove={() => void handleRemove(e.id)} />
            )}
          </ListSection>

          <ListSection label="energy" items={grouped.energy}>
            {(e) => (
              <EnergyRow key={e.id} event={e} onRemove={() => void handleRemove(e.id)} />
            )}
          </ListSection>

          <ListSection label="self-talk" items={grouped.self_talk}>
            {(e) => (
              <SelfTalkRow key={e.id} event={e} onRemove={() => void handleRemove(e.id)} />
            )}
          </ListSection>
        </Stack>
      )}
    </Stack>
  );
}

// ─── cold start ─────────────────────────────────────────────────────────────

function ColdStart(): JSX.Element {
  return (
    <Row gap={9} align="start" style={{ maxWidth: 320 }}>
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: colors.sageDeep,
          flexShrink: 0,
          marginTop: 7,
        }}
      />
      <Text scale="body" color={colors.ink}>
        <b style={{ fontWeight: fontWeights.medium }}>
          this is mood — how you feel, your energy, the way you talk to yourself.
        </b>{' '}
        try dumping &ldquo;feeling pretty good today&rdquo; to start.
      </Text>
    </Row>
  );
}

// ─── list helpers ─────────────────────────────────────────────────────────

function ListSection({
  label,
  items,
  children,
}: {
  label: string;
  items: MoodEvent[];
  children: (e: MoodEvent) => JSX.Element;
}): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <Stack gap={16}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        {label}
      </Text>
      <Stack gap={12}>
        {items.map((e) => (
          <Box key={e.id} bg="cream" radius="card" shadow="raised" style={{ padding: '16px 18px' }}>
            {children(e)}
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}

function MoodRow({ event, onRemove }: { event: MoodEvent; onRemove: () => void }): JSX.Element {
  const label = getLabel(event) || 'mood';
  const valence = getValence(event);
  const text = valence != null ? `${label} · ${formatValence(valence)}` : label;
  return (
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{text}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.loggedAt} />
    </Stack>
  );
}

/** Normalize the energy level (the AI sends a word like "low"; older rows may
 *  hold a 1–5 number) into a label + how many of the 3 calm segments to fill. */
const ENERGY_WORDS: Record<string, number> = { low: 1, mid: 2, medium: 2, high: 3 };
function energyMeter(event: MoodEvent): { word: string; filled: number } | null {
  const raw = (event.data as Record<string, unknown>)['level'];
  if (typeof raw === 'string' && raw.trim()) {
    const k = raw.toLowerCase();
    return { word: k, filled: ENERGY_WORDS[k] ?? 2 };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const filled = raw <= 2 ? 1 : raw === 3 ? 2 : 3;
    return { word: filled === 1 ? 'low' : filled === 2 ? 'mid' : 'high', filled };
  }
  return null;
}

function EnergyRow({ event, onRemove }: { event: MoodEvent; onRemove: () => void }): JSX.Element {
  const label = getLabel(event) || 'energy';
  const meter = energyMeter(event);
  return (
    <Stack gap={8}>
      <Row gap={12} align="center" justify="space-between">
        <Text scale="body" style={{ fontWeight: 600 }}>{label}</Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      {meter ? (
        <Row gap={8} align="center">
          <div style={{ display: 'flex', gap: 4 }} aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 20,
                  height: 5,
                  borderRadius: 3,
                  background: i < meter.filled ? colors.sageDeep : 'rgba(47, 61, 49, 0.12)',
                }}
              />
            ))}
          </div>
          <Text scale="caption" color={colors.inkFaint}>{`${meter.word} energy`}</Text>
        </Row>
      ) : null}
      <WhenCaption ts={event.loggedAt} />
    </Stack>
  );
}

function SelfTalkRow({ event, onRemove }: { event: MoodEvent; onRemove: () => void }): JSX.Element {
  const statement = getStatement(event) || 'self-talk';
  return (
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">{statement}</Text>
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
        transition: 'color 200ms ease',
      }}
    >
      remove
    </button>
  );
}

// ─── formatters ───────────────────────────────────────────────────────────

/** Human read of a signed valence — quiet words, never a number on screen. */
function formatValence(v: number): string {
  if (v > 0) return 'good';
  if (v < 0) return 'low';
  return 'neutral';
}

function groupBySection(items: MoodEvent[]): Record<MoodSection, MoodEvent[]> {
  const out: Record<MoodSection, MoodEvent[]> = {
    mood: [],
    energy: [],
    self_talk: [],
  };
  for (const e of items) {
    out[sectionForKind(e.kind)].push(e);
  }
  return out;
}
