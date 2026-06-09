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

import { useCallback, useEffect, useState } from 'react';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors, fontWeights } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { migrateMood } from './migrate';
import { events as eventsRepo } from './repo';
import {
  getEnergyLevel,
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

const POLL_MS = 6000;

export function MoodBox(): JSX.Element {
  const [items, setItems] = useState<MoodEvent[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const list = await eventsRepo.list();
    setItems(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateMood();
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => {
      void refresh();
    }, POLL_MS);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

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
        <Text scale="display">Mood</Text>
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
      <Stack gap={4}>{items.map((e) => children(e))}</Stack>
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

function EnergyRow({ event, onRemove }: { event: MoodEvent; onRemove: () => void }): JSX.Element {
  const level = getEnergyLevel(event);
  const label = getLabel(event);
  const text = label
    ? `${label}${level != null ? ` · ${level}` : ''}`
    : level != null
      ? `energy ${level}`
      : 'energy';
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
