/**
 * DumpModule — read-only archive of brain-dump entries.
 * Ported from void-app.html DumpModule (~line 35042) + JournalNoticed (~35011).
 *
 * States: loading (none — sync store), empty, search-empty, unrouted-empty, happy.
 * Data: dump.items (primary) + journal.entries (fallback) from store.
 * Logic: @ollie/logic/journal · resurface functions (dependency-injected via props).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  resurfaceAnniversaries,
  resurfacePhaseAnniversaries,
  resurfaceSemanticEchoes,
  resurfaceFilterRecency,
  resurfaceMMR,
} from '@ollie/logic/journal';
import type {
  StoredEntry,
  AnniversaryBucket,
  PhaseAnniversaryResult,
  SemanticEchoResult,
  RecentlyShownRecord,
  CycleRecord,
  MMROpts,
} from '@ollie/logic/journal';
import { useStoreSlice } from '../../store';
import { ModuleHelp } from '../../components/ModuleHelp';

// ─── Colour tokens (paper / ink editorial canon) ─────────────────────────────

const INK = '#14130F';
const PAPER = '#F2EEE4';
const HAIRLINE = 'rgba(20,19,15,0.10)';
const MUTED = 'rgba(20,19,15,0.42)';
const VERY_MUTED = 'rgba(20,19,15,0.28)';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDayHeader(d: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'today';
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
  return d
    .toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })
    .toLowerCase();
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function rel(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (diff < 45000) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts)
    .toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
    .toLowerCase();
}

function isUnrouted(item: StoredEntry): boolean {
  const rm = (item as { route_modules?: string[] }).route_modules;
  if (!Array.isArray(rm) || rm.length === 0) return true;
  return rm.length === 1 && rm[0] === 'dump';
}

// ─── Highlight component ──────────────────────────────────────────────────────

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const m = lower.indexOf(q, i);
    if (m === -1) {
      parts.push(<span key={parts.length}>{text.slice(i)}</span>);
      break;
    }
    if (m > i) parts.push(<span key={parts.length}>{text.slice(i, m)}</span>);
    parts.push(
      <span
        key={parts.length}
        style={{
          background: 'rgba(120,92,52,0.22)',
          borderBottom: '1px solid rgba(120,92,52,0.55)',
        }}
      >
        {text.slice(m, m + q.length)}
      </span>,
    );
    i = m + q.length;
  }
  return <>{parts}</>;
}

// ─── JournalNoticed (right-rail patterns block) ───────────────────────────────

interface JournalNoticedProps {
  muted: string;
  veryMuted: string;
  hairline: string;
}

interface JournalPattern {
  sample_text: string;
  cluster_n: number;
  cluster_span_days: number;
}

function JournalNoticed({ muted, veryMuted, hairline }: JournalNoticedProps) {
  const [patterns] = useStoreSlice<JournalPattern[]>('journal', 'patterns', []);
  const list = Array.isArray(patterns) ? patterns : [];
  if (list.length === 0) return null;
  return (
    <div style={{ marginTop: 48 }}>
      <div
        style={{
          fontFamily: "'DM Mono',monospace",
          fontSize: 10,
          letterSpacing: '0.3em',
          color: veryMuted,
          textTransform: 'uppercase',
          marginBottom: 20,
        }}
      >
        — you keep asking this
      </div>
      {list.map((p) => (
        <div key={p.sample_text} style={{ marginBottom: 18 }}>
          <div
            style={{
              fontFamily: "'DM Mono',monospace",
              fontSize: 11,
              color: muted,
              letterSpacing: '0.08em',
              marginBottom: 6,
            }}
          >
            {p.cluster_n}× over {p.cluster_span_days}d
          </div>
          <div
            style={{
              fontFamily: "'DM Mono',monospace",
              fontSize: 13,
              color: veryMuted,
              lineHeight: 1.55,
              borderLeft: `1px solid ${hairline}`,
              paddingLeft: 12,
              wordBreak: 'break-word',
              fontStyle: 'italic',
            }}
          >
            {p.sample_text}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── DumpModule ───────────────────────────────────────────────────────────────

export interface DumpModuleProps {
  onBack: () => void;
}

export function DumpModule({ onBack }: DumpModuleProps) {
  // Primary: dump.items; fallback: journal.entries
  const [dumpItems] = useStoreSlice<StoredEntry[]>('dump', 'items', []);
  const [journalEntries] = useStoreSlice<StoredEntry[]>('journal', 'entries', []);
  const [cycleRecords] = useStoreSlice<CycleRecord[]>('cycle', 'cycles', []);
  const [shownHistory, setShownHistory] = useStoreSlice<RecentlyShownRecord[]>(
    'shared',
    'resurfaceShownTs',
    [],
  );

  const [query, setQuery] = useState('');
  const [unroutedOnly, setUnroutedOnly] = useState(false);

  // Merge and deduplicate by ts, dump.items takes priority
  const items: StoredEntry[] = React.useMemo(() => {
    const base = Array.isArray(dumpItems) ? dumpItems : [];
    const fallback = Array.isArray(journalEntries) ? journalEntries : [];
    const tsSet = new Set(base.map((i) => i.ts));
    return [...base, ...fallback.filter((i) => !tsSet.has(i.ts))];
  }, [dumpItems, journalEntries]);

  const [items_, setItems] = useStoreSlice<StoredEntry[]>('dump', 'items', []);

  const removeEntry = useCallback(
    (ts: number) => {
      setItems(
        (Array.isArray(items_) ? items_ : []).filter((i) => i.ts !== ts),
      );
    },
    [items_, setItems],
  );

  const sorted = React.useMemo(
    () => [...items].sort((a, b) => b.ts - a.ts),
    [items],
  );

  const q = query.trim().toLowerCase();
  const baseFiltered = unroutedOnly ? sorted.filter(isUnrouted) : sorted;
  const filtered = q
    ? baseFiltered.filter((i) =>
        ((i.text ?? i.data ?? '') + '').toLowerCase().includes(q),
      )
    : baseFiltered;

  // Group by day
  interface DayGroup {
    day: Date;
    dayKey: string;
    entries: StoredEntry[];
  }
  const grouped = React.useMemo<DayGroup[]>(() => {
    const result: DayGroup[] = [];
    let currentDay: string | null = null;
    filtered.forEach((item) => {
      const d = new Date(item.ts);
      const dayKey = d.toDateString();
      if (dayKey !== currentDay) {
        result.push({ day: d, dayKey, entries: [] });
        currentDay = dayKey;
      }
      result[result.length - 1].entries.push(item);
    });
    return result;
  }, [filtered]);

  // Left-rail range bins
  const rangeOrder = ['today', 'yesterday', 'this week', 'this month', 'earlier'] as const;
  type RangeLabel = typeof rangeOrder[number];
  const { rangeBins, rangeFirstDay } = React.useMemo(() => {
    const nowMidnight = new Date();
    nowMidnight.setHours(0, 0, 0, 0);
    const bins: Record<RangeLabel, number> = {
      today: 0,
      yesterday: 0,
      'this week': 0,
      'this month': 0,
      earlier: 0,
    };
    const firstDay: Record<string, string> = {};
    sorted.forEach((item) => {
      const d = new Date(item.ts);
      d.setHours(0, 0, 0, 0);
      const delta = Math.floor((nowMidnight.getTime() - d.getTime()) / 86400000);
      let label: RangeLabel;
      if (delta <= 0) label = 'today';
      else if (delta === 1) label = 'yesterday';
      else if (delta < 7) label = 'this week';
      else if (delta < 30) label = 'this month';
      else label = 'earlier';
      bins[label] = (bins[label] || 0) + 1;
      const dayKey = new Date(item.ts).toDateString();
      if (!firstDay[label]) firstDay[label] = dayKey;
    });
    return { rangeBins: bins, rangeFirstDay: firstDay };
  }, [sorted]);

  // Right-rail: on-this-day anniversaries
  const nowMs = Date.now();
  const anniversaryGroups: AnniversaryBucket[] = React.useMemo(
    () => resurfaceAnniversaries(sorted, nowMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sorted],
  );
  const onThisDay = anniversaryGroups.map((g) => ({ label: g.offsetLabel, items: g.entries }));

  const DAY_MS = 86400000;

  // Phase anniversaries
  const phaseAnniversaries: PhaseAnniversaryResult[] = React.useMemo(() => {
    const raw = resurfacePhaseAnniversaries(sorted, cycleRecords, nowMs);
    // resurfaceMMR accepts Record<string,unknown> — cast through unknown
    return resurfaceMMR(raw as unknown as Array<Record<string, unknown>>, {
      lambda: 0.7,
      maxOut: 4,
    } as MMROpts) as unknown as PhaseAnniversaryResult[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, cycleRecords]);

  // Semantic echoes
  const recentText = sorted.length > 0 ? ((sorted[0].text ?? sorted[0].data ?? '') as string) : '';
  const semanticEchoes: SemanticEchoResult[] = React.useMemo(() => {
    if (recentText.length < 10) return [];
    const raw = resurfaceSemanticEchoes(sorted, recentText, nowMs, { max: 6, minDaysOld: 14 });
    return resurfaceMMR(
      raw as unknown as Array<Record<string, unknown>>,
      { lambda: 0.65, maxOut: 3 } as MMROpts,
    ) as unknown as SemanticEchoResult[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, recentText]);

  const filteredSemanticEchoes: SemanticEchoResult[] = React.useMemo(
    () =>
      resurfaceFilterRecency(
        semanticEchoes as unknown as Array<StoredEntry>,
        shownHistory,
        72 * DAY_MS,
        nowMs,
      ) as unknown as SemanticEchoResult[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [semanticEchoes, shownHistory],
  );

  // Record what we surfaced to avoid showing same within 72h
  useEffect(() => {
    if (!filteredSemanticEchoes.length && !phaseAnniversaries.length) return;
    const seen: RecentlyShownRecord[] = [
      ...filteredSemanticEchoes.map((r) => ({ ts: r.entry.ts, seenAt: nowMs })),
      ...phaseAnniversaries.map((r) => ({ ts: r.entry.ts, seenAt: nowMs })),
    ];
    setShownHistory([...shownHistory, ...seen].slice(-50));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayCount = rangeBins.today || 0;

  const scrollToDay = (key: string) => {
    const el = document.querySelector(`[data-day="${key}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      style={{
        width: '100vw',
        minHeight: '100vh',
        background: PAPER,
        position: 'relative',
        fontFamily: "'DM Mono', monospace",
        color: INK,
      }}
    >
      {/* paper grain */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          opacity: 0.32,
          mixBlendMode: 'multiply',
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.1  0 0 0 0 0.09  0 0 0 0 0.07  0 0 0 0.14 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
        }}
      />

      {/* back */}
      <button
        type="button"
        aria-label="back"
        onClick={onBack}
        style={{
          position: 'fixed',
          top: 22,
          left: 22,
          zIndex: 30,
          background: 'none',
          border: 'none',
          padding: '8px 10px',
          fontFamily: "'DM Mono',monospace",
          fontSize: 10,
          letterSpacing: '0.22em',
          color: MUTED,
          cursor: 'pointer',
          textTransform: 'uppercase',
        }}
      >
        ← back
      </button>

      {/* help */}
      <div style={{ position: 'fixed', top: 22, right: 22, zIndex: 30 }}>
        <ModuleHelp moduleId="dump" />
      </div>

      {/* three-pane grid */}
      <div
        className="dump-grid"
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '64px 32px 96px',
          display: 'grid',
          gridTemplateColumns: '180px minmax(0, 1fr) 220px',
          columnGap: 40,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* ── LEFT RAIL ── */}
        <aside
          className="dump-rail dump-rail-left"
          style={{ position: 'sticky', top: 64, alignSelf: 'start', paddingTop: 52 }}
        >
          <div style={{ marginBottom: 44 }}>
            <div
              style={{
                fontFamily: "'DM Mono',monospace",
                fontSize: 10,
                letterSpacing: '0.3em',
                color: VERY_MUTED,
                textTransform: 'uppercase',
                marginBottom: 12,
              }}
            >
              — search
            </div>
            <input
              aria-label="search dumps"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="·"
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: `1px solid ${HAIRLINE}`,
                outline: 'none',
                fontFamily: "'DM Mono',monospace",
                fontSize: 16,
                fontWeight: 500,
                color: INK,
                letterSpacing: '0.01em',
                padding: '6px 0',
              }}
            />
            {query && (
              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 10,
                  color: MUTED,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  marginTop: 10,
                }}
              >
                {filtered.length} match{filtered.length === 1 ? '' : 'es'}
              </div>
            )}
          </div>

          <div
            style={{
              fontFamily: "'DM Mono',monospace",
              fontSize: 10,
              letterSpacing: '0.3em',
              color: VERY_MUTED,
              textTransform: 'uppercase',
              marginBottom: 18,
            }}
          >
            — when
          </div>
          {rangeOrder.map((label) => {
            const n = rangeBins[label] || 0;
            const enabled = n > 0;
            return (
              <button
                key={label}
                type="button"
                disabled={!enabled}
                onClick={() => enabled && scrollToDay(rangeFirstDay[label])}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  padding: '9px 0',
                  cursor: enabled ? 'pointer' : 'default',
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 15,
                  fontWeight: 500,
                  color: enabled ? INK : VERY_MUTED,
                  letterSpacing: '0.01em',
                  alignItems: 'baseline',
                  textAlign: 'left',
                }}
              >
                <span>{label}</span>
                <span
                  style={{
                    color: VERY_MUTED,
                    fontSize: 12,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {n}
                </span>
              </button>
            );
          })}

          <div
            style={{
              marginTop: 44,
              paddingTop: 22,
              borderTop: `1px solid ${HAIRLINE}`,
              fontFamily: "'DM Mono',monospace",
              fontSize: 10,
              color: VERY_MUTED,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              lineHeight: 1.6,
            }}
          >
            {sorted.length} total
            <br />
            offloaded
          </div>
        </aside>

        {/* ── CENTER STREAM ── */}
        <main
          className="dump-stream"
          style={{ maxWidth: 680, width: '100%', justifySelf: 'center', paddingTop: 10 }}
        >
          {/* hero */}
          <div style={{ marginBottom: 28, lineHeight: 1 }}>
            <div
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontStyle: 'italic',
                fontSize: 76,
                color: INK,
                letterSpacing: '-0.01em',
                lineHeight: 1,
              }}
            >
              dump.
            </div>
            <div
              style={{
                fontFamily: "'DM Mono',monospace",
                fontSize: 12,
                letterSpacing: '0.22em',
                color: MUTED,
                marginTop: 14,
                textTransform: 'uppercase',
              }}
            >
              offload · search later
            </div>
          </div>

          {/* sticky filter bar */}
          <div
            style={{
              position: 'sticky',
              top: 56,
              zIndex: 5,
              background: PAPER,
              paddingTop: 18,
              paddingBottom: 16,
              marginBottom: 28,
              borderBottom: `1px solid ${HAIRLINE}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                fontFamily: "'DM Mono',monospace",
                fontSize: 10,
                color: VERY_MUTED,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
              }}
            >
              read-only archive · dump from home or widget
            </div>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              {(['show all', 'unrouted only'] as const).map((label) => {
                const active = label === 'show all' ? !unroutedOnly : unroutedOnly;
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setUnroutedOnly(label === 'unrouted only')}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '4px 0',
                      fontFamily: "'DM Mono',monospace",
                      fontSize: 10,
                      letterSpacing: '0.22em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      color: active ? INK : VERY_MUTED,
                      borderBottom: active ? `1px solid ${INK}` : '1px solid transparent',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* empty states */}
          {filtered.length === 0 && !query && !unroutedOnly && (
            <div style={{ padding: '80px 0', textAlign: 'center' }}>
              <div
                style={{
                  fontFamily: "'DM Serif Display', serif",
                  fontStyle: 'italic',
                  fontSize: 28,
                  color: MUTED,
                  marginBottom: 14,
                }}
              >
                nothing here yet.
              </div>
              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 11,
                  color: VERY_MUTED,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                }}
              >
                dump from home · it lands here
              </div>
            </div>
          )}
          {filtered.length === 0 && unroutedOnly && (
            <div
              style={{
                padding: '64px 0',
                textAlign: 'center',
                fontFamily: "'DM Serif Display', serif",
                fontStyle: 'italic',
                fontSize: 22,
                color: MUTED,
              }}
            >
              no unrouted dumps in archive.
            </div>
          )}
          {filtered.length === 0 && query && (
            <div
              style={{
                padding: '64px 0',
                textAlign: 'center',
                fontFamily: "'DM Serif Display', serif",
                fontStyle: 'italic',
                fontSize: 22,
                color: MUTED,
              }}
            >
              no match for &ldquo;{query}&rdquo;.
            </div>
          )}

          {/* stream */}
          {grouped.map((group) => (
            <div
              key={group.dayKey}
              data-day={group.dayKey}
              style={{ marginBottom: 52, scrollMarginTop: 140 }}
            >
              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 11,
                  letterSpacing: '0.3em',
                  textTransform: 'uppercase',
                  color: MUTED,
                  marginBottom: 22,
                  borderBottom: `1px solid ${HAIRLINE}`,
                  paddingBottom: 12,
                }}
              >
                {fmtDayHeader(group.day)}
              </div>

              {group.entries.map((item) => {
                const text = (item.text ?? item.data ?? '') as string;
                const isFresh = Date.now() - item.ts < 60000;
                const routeTrail = (
                  Array.isArray(
                    (item as { route_modules?: string[] }).route_modules,
                  )
                    ? ((item as { route_modules?: string[] }).route_modules ?? [])
                    : []
                ).filter((m: string) => m && m !== 'dump');
                const isUndone = (item as { undone?: boolean }).undone === true;

                return (
                  <div
                    key={item.ts}
                    className="dump-entry"
                    style={{
                      position: 'relative',
                      paddingBottom: 28,
                      marginBottom: 28,
                    }}
                  >
                    {isFresh && (
                      <div
                        aria-hidden="true"
                        style={{
                          position: 'absolute',
                          left: -16,
                          top: 4,
                          bottom: 34,
                          width: 3,
                          background: '#5C4A2C',
                          opacity: 0.92,
                          borderRadius: 2,
                        }}
                      />
                    )}
                    <div
                      style={{
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 17,
                        fontWeight: 500,
                        lineHeight: 1.62,
                        color: INK,
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                        letterSpacing: '0.005em',
                        textDecoration: isUndone ? 'line-through' : 'none',
                        opacity: isUndone ? 0.5 : 1,
                      }}
                    >
                      <HighlightedText text={text} query={q} />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span
                          style={{
                            fontFamily: "'DM Mono',monospace",
                            fontSize: 11,
                            color: VERY_MUTED,
                            letterSpacing: '0.08em',
                          }}
                          title={new Date(item.ts).toLocaleString()}
                        >
                          · {rel(item.ts)} · {fmtTime(item.ts)}
                        </span>
                        {routeTrail.length > 0 && (
                          <span
                            style={{
                              fontFamily: "'DM Mono',monospace",
                              fontSize: 10,
                              color: VERY_MUTED,
                              letterSpacing: '0.1em',
                              textTransform: 'lowercase',
                              opacity: 0.85,
                            }}
                            title="route trail"
                          >
                            → {routeTrail.join(', ')}
                          </span>
                        )}
                        {isUndone && (
                          <span
                            style={{
                              fontFamily: "'DM Mono',monospace",
                              fontSize: 10,
                              color: VERY_MUTED,
                              letterSpacing: '0.1em',
                              textTransform: 'lowercase',
                              fontStyle: 'italic',
                            }}
                          >
                            undone
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="dump-forget"
                        aria-label="forget this entry"
                        onClick={() => removeEntry(item.ts)}
                        style={{
                          background: 'none',
                          border: 'none',
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 10,
                          color: VERY_MUTED,
                          cursor: 'pointer',
                          padding: '2px 6px',
                          opacity: 0,
                          transition: 'opacity 160ms ease',
                          letterSpacing: '0.22em',
                          textTransform: 'uppercase',
                        }}
                      >
                        forget
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </main>

        {/* ── RIGHT RAIL ── */}
        <aside
          className="dump-rail dump-rail-right"
          style={{ position: 'sticky', top: 64, alignSelf: 'start', paddingTop: 52 }}
        >
          <div
            style={{
              fontFamily: "'DM Mono',monospace",
              fontSize: 10,
              letterSpacing: '0.3em',
              color: VERY_MUTED,
              textTransform: 'uppercase',
              marginBottom: 16,
            }}
          >
            — today
          </div>
          <div
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: 88,
              color: INK,
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 0.9,
            }}
          >
            {String(todayCount).padStart(2, '0')}
          </div>
          <div
            style={{
              fontFamily: "'DM Mono',monospace",
              fontSize: 12,
              color: MUTED,
              letterSpacing: '0.16em',
              marginTop: 12,
              textTransform: 'uppercase',
            }}
          >
            dump{todayCount === 1 ? '' : 's'}
          </div>

          {onThisDay.length > 0 && (
            <div style={{ marginTop: 60 }}>
              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 10,
                  letterSpacing: '0.3em',
                  color: VERY_MUTED,
                  textTransform: 'uppercase',
                  marginBottom: 20,
                }}
              >
                — on this day
              </div>
              {onThisDay.map((g) => (
                <div key={g.label} style={{ marginBottom: 26 }}>
                  <div
                    style={{
                      fontFamily: "'DM Mono',monospace",
                      fontSize: 12,
                      color: MUTED,
                      letterSpacing: '0.1em',
                      marginBottom: 10,
                    }}
                  >
                    {g.label} · {g.items.length}
                  </div>
                  {g.items.slice(0, 2).map((i) => {
                    const t = (i.text ?? i.data ?? '') as string;
                    return (
                      <div
                        key={i.ts}
                        style={{
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 13,
                          color: VERY_MUTED,
                          lineHeight: 1.55,
                          borderLeft: `1px solid ${HAIRLINE}`,
                          paddingLeft: 12,
                          marginBottom: 10,
                          wordBreak: 'break-word',
                        }}
                      >
                        {t.slice(0, 90)}
                        {t.length > 90 ? '…' : ''}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {phaseAnniversaries.length > 0 && (
            <div style={{ marginTop: 48 }}>
              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 10,
                  letterSpacing: '0.3em',
                  color: VERY_MUTED,
                  textTransform: 'uppercase',
                  marginBottom: 20,
                }}
              >
                — same cycle day, last time
              </div>
              {phaseAnniversaries.slice(0, 4).map((r) => {
                const t = (r.entry.text ?? r.entry.data ?? '') as string;
                return (
                  <div key={r.entry.ts} style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 11,
                        color: MUTED,
                        letterSpacing: '0.08em',
                        marginBottom: 6,
                      }}
                    >
                      day {r.cycleDay} · {r.daysSince}d ago
                    </div>
                    <div
                      style={{
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 13,
                        color: VERY_MUTED,
                        lineHeight: 1.55,
                        borderLeft: `1px solid ${HAIRLINE}`,
                        paddingLeft: 12,
                        wordBreak: 'break-word',
                      }}
                    >
                      {t.slice(0, 90)}
                      {t.length > 90 ? '…' : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filteredSemanticEchoes.length > 0 && (
            <div style={{ marginTop: 48 }}>
              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 10,
                  letterSpacing: '0.3em',
                  color: VERY_MUTED,
                  textTransform: 'uppercase',
                  marginBottom: 20,
                }}
              >
                — you said something like this before
              </div>
              {filteredSemanticEchoes.map((r) => {
                const t = (r.entry.text ?? r.entry.data ?? '') as string;
                return (
                  <div key={r.entry.ts} style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 11,
                        color: MUTED,
                        letterSpacing: '0.08em',
                        marginBottom: 6,
                      }}
                    >
                      {r.daysSince}d ago
                    </div>
                    <div
                      style={{
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 13,
                        color: VERY_MUTED,
                        lineHeight: 1.55,
                        borderLeft: `1px solid ${HAIRLINE}`,
                        paddingLeft: 12,
                        wordBreak: 'break-word',
                      }}
                    >
                      {t.slice(0, 90)}
                      {t.length > 90 ? '…' : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <JournalNoticed muted={MUTED} veryMuted={VERY_MUTED} hairline={HAIRLINE} />
        </aside>
      </div>

      <style>{`
        @keyframes dumpIn {
          from { opacity: 0; transform: translateY(-3px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .dump-entry:hover .dump-forget { opacity: 1 !important; }
        .dump-entry ::selection { background: rgba(92,74,44,0.22); }
        @media (max-width: 1180px) {
          .dump-grid { grid-template-columns: 180px minmax(0, 1fr) !important; }
          .dump-rail-right { display: none !important; }
        }
        @media (max-width: 820px) {
          .dump-grid { grid-template-columns: minmax(0, 1fr) !important; }
          .dump-rail-left { display: none !important; }
        }
      `}</style>
    </div>
  );
}
