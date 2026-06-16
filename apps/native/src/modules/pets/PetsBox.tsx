/**
 * PetsBox · /box/pets screen.
 *
 * Ported from the redesign/money-v2 web `PetsFace` visual grammar (one
 * editorial italic preface · soft initial disc · sage-or-umber status
 * line · hairline-bounded event rows · smcp section labels). The native
 * data model is events-only — there is no pet registry / care-strip /
 * roster — so the v2 hero is adapted to a vitamin-C status anchor and
 * the four sections (feeds, observations, vet, supplements) keep the
 * existing partitioned-events shape.
 *
 * The hero is the soft initial disc + vitamin-C status line:
 *   - "T" disc (Tontin, the first guinea pig) — soft paper fill, ink glyph.
 *   - status line below: sage dot + "today's vitamin c · logged" when on,
 *     amber-faint dot + "today's vitamin c · not yet" otherwise.
 *   - when no events at all, the disc swaps to a paw glyph and the page
 *     reads as a cold notebook invitation ("the notebook's empty").
 *
 * Storage is preserved verbatim — `events.list()`, `events.remove()`,
 * `events.lastSupplementAt('vitamin_c')`, and `migratePets()`. Auto-
 * refreshes on focus + every 6s.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  daysSinceLast,
  medianIntervalDays,
  type CadenceEstimate,
} from '@ollie/cadence';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { fonts } from '../../theme/tokens';
import { WhenCaption } from '../../lib/WhenCaption';
import { PatternCards } from '../../patterns/PatternCards';
import { migratePets } from './migrate';
import { cadence as cadenceRepo, events as eventsRepo } from './repo';
import {
  normalisePetName,
  petNameLabel,
  supplementLabel,
  type PetEvent,
} from './types';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const POLL_MS = 6000;
const DAY_MS = 24 * 60 * 60 * 1000;

// v2 redesign accents — faint amber is the umber-soft umbrella used for
// "not yet" cues; sage is the calm "current" voice. Both match the
// redesign tokens.css vocabulary (umber #8A4B2C · sage #2E5D43) softened
// for the small status dot so it never reads as a SaaS alarm.
const AMBER_FAINT = '#b8966a';
const DISC_FILL = '#F2EEDF'; // soft paper · v2 hero disc fill

// The editorial preface — one quiet italic line, v2 PetsFace grammar.
// We don't pull `weeklyPreface()` from logic (web-only); a single calm
// line carries the same voice.
const PREFACE =
  'small acts of care, kept honest by the notebook — what was fed, what was noticed.';

export function PetsBox(): JSX.Element {
  const [allEvents, setAllEvents] = useState<PetEvent[]>([]);
  const [vitaminCAt, setVitaminCAt] = useState<number | null>(null);
  // Two cadence maps keyed by the normalised pet name so each row can look
  // up its own cadence without a per-render async fetch.
  // For supplements, the key is "<petKey>::<supplementKey>".
  const [feedCadence, setFeedCadence] = useState<Map<string, CadenceEstimate>>(
    () => new Map(),
  );
  const [suppCadence, setSuppCadence] = useState<Map<string, CadenceEstimate>>(
    () => new Map(),
  );
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [list, lastVitC] = await Promise.all([
      eventsRepo.list(),
      eventsRepo.lastSupplementAt('vitamin_c'),
    ]);
    setAllEvents(list);
    setVitaminCAt(lastVitC);

    // Fan-out cadence reads in parallel — one per distinct (pet, feed) and
    // one per distinct (pet, supplement) pair touched by the events list.
    const feedKeys = new Set<string>();
    const suppKeys = new Set<string>();
    for (const e of list) {
      const petKey = normalisePetName(e.petName) ?? '';
      if (e.kind === 'feed') feedKeys.add(petKey);
      if (e.kind === 'supplement' && e.data.kind === 'supplement') {
        suppKeys.add(`${petKey}::${e.data.supplement}`);
      }
    }
    const [feedPairs, suppPairs] = await Promise.all([
      Promise.all(
        Array.from(feedKeys).map(
          async (k) =>
            [k, await cadenceRepo.getFeedCadenceFor(k || null)] as const,
        ),
      ),
      Promise.all(
        Array.from(suppKeys).map(async (k) => {
          const [petKey, supp] = k.split('::');
          const cad = await cadenceRepo.getSupplementCadenceFor(
            petKey || null,
            supp ?? '',
          );
          return [k, cad] as const;
        }),
      ),
    ]);
    setFeedCadence(new Map(feedPairs));
    setSuppCadence(new Map(suppPairs));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migratePets();
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

  const { feeds, observations, vet, supplements } = useMemo(
    () => partition(allEvents),
    [allEvents],
  );

  const vitaminCToday = vitaminCAt != null && Date.now() - vitaminCAt < DAY_MS;
  const empty = ready && allEvents.length === 0;

  return (
    <Stack gap={56}>
      {/* kicker + display title — the box mast */}
      <Stack gap={8}>
        <Text scale="caption" color="var(--ollie-color-ink-faint)" style={SMCP_STYLE}>
          box
        </Text>
        <Text scale="display">Pets</Text>
      </Stack>

      {/* the editorial preface — one quiet italic line, v2 grammar */}
      <p
        style={{
          margin: 0,
          fontFamily: fonts.sans,
          fontStyle: 'italic',
          fontSize: 13,
          fontWeight: 400,
          lineHeight: 1.5,
          letterSpacing: '0.01em',
          color: 'var(--ollie-color-ink-faint)',
        }}
      >
        {PREFACE}
      </p>

      {/* the hero — soft disc + status line */}
      <Hero empty={empty} vitaminCToday={vitaminCToday} />

      {/* Layer-2 noticings — care gaps, health flags, behavioral patterns.
          Renders nothing until the watcher computes pets.patterns. */}
      <PatternCards module="pets" />

      {!ready ? (
        <Text scale="caption" color="var(--ollie-color-ink-faint)">
          loading…
        </Text>
      ) : empty ? (
        <Text scale="body" color="var(--ollie-color-ink-faint)">
          the notebook&rsquo;s empty &mdash; try dumping &ldquo;fed
          tontin&rdquo;
        </Text>
      ) : (
        <Stack gap={48}>
          <ListSection
            label="feeds"
            empty="nothing fed yet today"
            items={feeds}
            renderItem={(e) => (
              <EventRow
                key={e.id}
                primary={petNameLabel(e.petName)}
                secondary="fed"
                event={e}
                cadence={feedCadence.get(normalisePetName(e.petName) ?? '')}
                cadenceSubject={`${petNameLabel(e.petName)} fed`}
                onRemove={() => void handleRemove(e.id)}
              />
            )}
          />
          <ListSection
            label="observations"
            empty="nothing noticed yet"
            items={observations}
            renderItem={(e) => (
              <EventRow
                key={e.id}
                primary={petNameLabel(e.petName)}
                secondary={
                  e.data.kind === 'observation' ? e.data.note : ''
                }
                event={e}
                onRemove={() => void handleRemove(e.id)}
              />
            )}
          />
          <ListSection
            label="vet"
            empty="no vet visits logged"
            items={vet}
            renderItem={(e) => (
              <EventRow
                key={e.id}
                primary={petNameLabel(e.petName)}
                secondary={
                  e.data.kind === 'vet' && e.data.reason
                    ? e.data.reason
                    : 'vet visit'
                }
                event={e}
                onRemove={() => void handleRemove(e.id)}
              />
            )}
          />
          <ListSection
            label="supplements"
            empty="nothing logged — vitamin C matters for the pigs"
            items={supplements}
            renderItem={(e) => {
              const petKey = normalisePetName(e.petName) ?? '';
              const suppKey =
                e.data.kind === 'supplement' ? e.data.supplement : '';
              return (
                <EventRow
                  key={e.id}
                  primary={petNameLabel(e.petName)}
                  secondary={supplementSummary(e)}
                  event={e}
                  cadence={suppCadence.get(`${petKey}::${suppKey}`)}
                  cadenceSubject={
                    e.data.kind === 'supplement'
                      ? supplementLabel(e.data.supplement)
                      : 'supplement'
                  }
                  onRemove={() => void handleRemove(e.id)}
                />
              );
            }}
          />
        </Stack>
      )}
    </Stack>
  );
}

// ─── hero (v2 PetsFace grammar, adapted to native data shape) ─────────────

function Hero({
  empty,
  vitaminCToday,
}: {
  empty: boolean;
  vitaminCToday: boolean;
}): JSX.Element {
  // When cold, the disc is a bare ink-outline ring with a faint paw glyph.
  // When warm, the disc is a soft paper fill carrying the "T" initial
  // (Tontin — the guinea-pig anchor of this household's pets module).
  return (
    <Stack gap={20} align="center">
      <span
        aria-hidden
        style={{
          width: empty ? 78 : 62,
          height: empty ? 78 : 62,
          borderRadius: '50%',
          background: empty ? 'transparent' : DISC_FILL,
          border: empty ? `1.5px solid var(--ollie-color-hairline)` : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {empty ? (
          <PawGlyph size={34} stroke="var(--ollie-color-ink-faint)" />
        ) : (
          <span
            style={{
              fontFamily: fonts.sans,
              fontSize: 25,
              fontWeight: 700,
              color: 'var(--ollie-color-ink)',
              letterSpacing: '-0.02em',
            }}
          >
            T
          </span>
        )}
      </span>

      {empty ? (
        <Text
          scale="caption"
          color="var(--ollie-color-ink-faint)"
          style={{ letterSpacing: '0.02em' }}
        >
          no pets yet
        </Text>
      ) : (
        <VitaminCStatus on={vitaminCToday} />
      )}
    </Stack>
  );
}

/**
 * Vitamin-C status line — non-negotiable dogfood feature for Tontin +
 * Pinpon (guinea pigs, scurvy risk). The v2 redesign uses a sage dot
 * for "all current" cues and an umber/amber-soft dot for "needs care"
 * cues; we keep the same 8px dot pattern from the prior version but
 * raise the type to body weight so it reads as the day's anchor.
 */
function VitaminCStatus({ on }: { on: boolean }): JSX.Element {
  return (
    <Row gap={8} align="center">
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: 4,
          background: on ? 'var(--ollie-color-sage)' : AMBER_FAINT,
          opacity: on ? 1 : 0.7,
        }}
      />
      <Text scale="caption" color="var(--ollie-color-ink-faint)" style={SMCP_STYLE}>
        {on ? "today's vitamin c · logged" : "today's vitamin c · not yet"}
      </Text>
    </Row>
  );
}

/** A tiny paw silhouette built from circles — used in the cold hero. */
function PawGlyph({
  size,
  stroke,
}: {
  size: number;
  stroke: string;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ stroke }}
    >
      <circle cx="5" cy="9" r="1.6" />
      <circle cx="9" cy="5.5" r="1.6" />
      <circle cx="15" cy="5.5" r="1.6" />
      <circle cx="19" cy="9" r="1.6" />
      <path d="M7.5 16.5c0-3 2-5 4.5-5s4.5 2 4.5 5c0 2-1.5 3.5-4.5 3.5s-4.5-1.5-4.5-3.5z" />
    </svg>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

interface Partitioned {
  feeds: PetEvent[];
  observations: PetEvent[];
  vet: PetEvent[];
  supplements: PetEvent[];
  care: PetEvent[];
}

function partition(events: PetEvent[]): Partitioned {
  const out: Partitioned = {
    feeds: [],
    observations: [],
    vet: [],
    supplements: [],
    care: [],
  };
  for (const e of events) {
    switch (e.kind) {
      case 'feed':
        out.feeds.push(e);
        break;
      case 'observation':
        out.observations.push(e);
        break;
      case 'vet':
        out.vet.push(e);
        break;
      case 'supplement':
        out.supplements.push(e);
        break;
      case 'care':
        // Care events fold into observations — same "noticed" shape, and
        // we keep the section list humane (four labels, not five).
        out.observations.push(e);
        out.care.push(e);
        break;
    }
  }
  return out;
}

function supplementSummary(e: PetEvent): string {
  if (e.data.kind !== 'supplement') return '';
  const label = supplementLabel(e.data.supplement);
  return e.data.dose ? `${label} · ${e.data.dose}` : label;
}

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
      <Text scale="lede" color="var(--ollie-color-ink)">
        {label}
      </Text>
      {items.length === 0 ? (
        <Text scale="body" color="var(--ollie-color-ink-faint)">
          {empty}
        </Text>
      ) : (
        // hairline-bounded list — v2 PetsFace roster grammar, adapted
        // to the events shape: a top rule on every row + a bottom rule
        // on the last one, so the section reads as a tidy column.
        <div
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          {items.map((item, i) => (
            <div
              key={i}
              style={{
                boxSizing: 'border-box',
                borderTop: `1px solid var(--ollie-color-hairline)`,
                borderBottom:
                  i === items.length - 1
                    ? `1px solid var(--ollie-color-hairline)`
                    : 'none',
                padding: '12px 2px',
              }}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}
    </Stack>
  );
}

function EventRow({
  primary,
  secondary,
  event,
  cadence,
  cadenceSubject,
  onRemove,
}: {
  primary: string;
  secondary: string;
  event: PetEvent;
  cadence?: CadenceEstimate | undefined;
  cadenceSubject?: string;
  onRemove: () => void;
}): JSX.Element {
  return (
    <Stack gap={2}>
      <Row gap={12} align="baseline" justify="space-between">
        <Text scale="body">
          {primary}
          {secondary && (
            <Text
              as="span"
              scale="caption"
              color="var(--ollie-color-ink-faint)"
              style={{ marginLeft: 8 }}
            >
              · {secondary}
            </Text>
          )}
        </Text>
        <RemoveButton onClick={onRemove} />
      </Row>
      <WhenCaption ts={event.loggedAt} />
      {cadence && cadenceSubject && (
        <CadenceHint estimate={cadence} subject={cadenceSubject} />
      )}
    </Stack>
  );
}

/**
 * Faint sub-line under a pets row: "last tontin fed 4 hours ago · usually
 * every day". Silent at low-data confidence — Serra's minimal UI prefers
 * nothing to a misleading prediction.
 */
function CadenceHint({
  estimate,
  subject,
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
      color="var(--ollie-color-ink-faint)"
      style={{ fontVariantCaps: 'all-small-caps', letterSpacing: '0.06em' }}
    >
      {`last ${subject} ${sinceLabel} ago · usually every ${everyLabel}`}
    </Text>
  );
}

function formatDays(d: number): string {
  if (d < 1) return 'less than a day';
  const rounded = Math.round(d);
  return `${rounded} day${rounded === 1 ? '' : 's'}`;
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
        color: 'var(--ollie-color-ink-faint)',
        cursor: 'pointer',
        fontVariantCaps: 'all-small-caps',
        letterSpacing: '0.08em',
        fontSize: 12,
        transition: 'color 120ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--ollie-color-ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--ollie-color-ink-faint)';
      }}
    >
      remove
    </button>
  );
}
