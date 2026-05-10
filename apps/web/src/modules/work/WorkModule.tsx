import React, { useMemo, useState, useEffect, useCallback } from 'react';
import type { AnyWorkPattern } from '@ollie/logic/work';
import { useStoreSlice } from '../../store';
import { ModuleHelp } from '../../components/ModuleHelp';
import { SourcesLink } from '../../components/SourcesLink';

// ─── palette (paper/ink canonical, matches void WorkModule) ──────────────────

const BG = '#F2EEE4';
const PAPER = '#F8F4EA';
const INK = '#14130F';
const MUTED = '#4B4740';
const FAINT = '#7C7770';
const HAIRLINE = 'rgba(20,19,15,0.10)';
const HAIRLINE_HI = 'rgba(20,19,15,0.28)';
const ACCENT = '#4F6E5B';
const WORK_ACCENT = '#6B7A52';

// ─── local types ─────────────────────────────────────────────────────────────

interface WorkItem {
  id: string;
  text: string;
  ts: number;
  status: 'open' | 'done';
  done_at?: number | null;
  action?: string;
}

interface FocusLogEntry {
  at: number;
  duration_min: number;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function sanitize(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    const map: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };
    return map[c] ?? c;
  });
}

function fmtTimer(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: "'DM Mono',monospace",
  fontSize: 10,
  letterSpacing: '0.26em',
  color: MUTED,
  textTransform: 'uppercase',
  fontWeight: 500,
};

// ─── WorkNoticed — renders computed patterns from store ───────────────────────

function WorkNoticed() {
  const [patterns] = useStoreSlice<AnyWorkPattern[]>('work', 'patterns', []);
  const [dismissed, setDismissed] = useStoreSlice<Record<string, number>>('work', 'patterns_dismissed', {});

  const list = useMemo(() => (Array.isArray(patterns) ? patterns : []), [patterns]);

  const idOf = useCallback((p: AnyWorkPattern): string => {
    if (!p.pattern) return '?';
    if (p.pattern === 'meeting-cliff' && 'date_key' in p && p.date_key) return `${p.pattern}:${p.date_key}`;
    if (p.pattern === 'activation-barrier' && 'task_id' in p && p.task_id) return `${p.pattern}:${p.task_id}`;
    if (p.pattern === 'recurring-meeting-dead' && 'meeting_id' in p && p.meeting_id) return `${p.pattern}:${p.meeting_id}`;
    if (p.pattern === 'hyperfocus-crash-prompt' && 'session_id' in p && p.session_id) return `${p.pattern}:${p.session_id}`;
    if (p.pattern === 'deadline-cues' && 'deadline_id' in p && p.deadline_id) return `${p.pattern}:${p.deadline_id}`;
    return p.pattern;
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissed({ ...(dismissed ?? {}), [id]: Date.now() });
  }, [dismissed, setDismissed]);

  const visible = useMemo(
    () => list.filter((p) => p && 'copy' in p && p.copy && !(dismissed && dismissed[idOf(p)])),
    [list, dismissed, idOf],
  );

  const metaFor = useCallback((p: AnyWorkPattern): string[] => {
    const bits: string[] = [];
    if ('confidence' in p && p.confidence) bits.push(`${p.confidence} confidence`);
    if ('sample_n' in p && typeof p.sample_n === 'number') bits.push(`${p.sample_n} sessions`);
    if ('sample_size' in p && typeof p.sample_size === 'number') bits.push(`${p.sample_size} samples`);
    if ('meeting_count' in p && typeof p.meeting_count === 'number') bits.push(`${p.meeting_count} meetings`);
    if ('total_swaps' in p && typeof p.total_swaps === 'number') bits.push(`${p.total_swaps} swaps`);
    if ('presses' in p && typeof p.presses === 'number') bits.push(`${p.presses} presses`);
    if (p.pattern === 'notification-tax' && 'total' in p && typeof p.total === 'number') bits.push(`${p.total} interrupts`);
    if (p.pattern === 'tab-sprawl' && 'mean' in p && typeof p.mean === 'number') bits.push(`mean ${p.mean}`);
    if ('multiplier' in p && typeof p.multiplier === 'number') bits.push(`x${p.multiplier.toFixed(1)}`);
    if (p.pattern === 'shutdown-gap' && 'days_since' in p && typeof p.days_since === 'number') bits.push(`${p.days_since} days since`);
    if ('date_key' in p && p.date_key) bits.push(p.date_key);
    return bits;
  }, []);

  return (
    <section style={{ marginTop: 64, paddingTop: 28, borderTop: `1px solid ${HAIRLINE}` }}>
      <div style={{ ...LABEL_STYLE, paddingBottom: 20 }}>— noticed</div>
      {visible.length === 0 ? (
        <div
          style={{
            fontFamily: "'Inter Tight',sans-serif",
            fontSize: 15,
            color: MUTED,
            lineHeight: 1.55,
            fontStyle: 'italic',
          }}
        >
          not enough focus sessions yet. run the timer a few more times.
        </div>
      ) : (
        visible.map((p, i) => {
          const id = idOf(p);
          const meta = metaFor(p);
          const copy = 'copy' in p ? (p.copy as string) : '';
          const prompt = 'prompt' in p ? (p.prompt as string | undefined) : undefined;
          const suggestion = 'suggestion' in p ? (p.suggestion as string | undefined) : undefined;
          const source = 'source' in p ? (p.source as { citation: string; url: string } | undefined) : undefined;

          return (
            <div
              key={`${id}:${i}`}
              style={{
                padding: '18px 20px',
                background: PAPER,
                borderLeft: `2px solid ${WORK_ACCENT}`,
                borderRadius: 2,
                marginBottom: 12,
                position: 'relative',
              }}
            >
              <button
                onClick={() => dismiss(id)}
                aria-label="dismiss pattern"
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 12,
                  background: 'transparent',
                  border: 'none',
                  color: FAINT,
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 14,
                  cursor: 'pointer',
                  padding: '4px 6px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>

              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 9,
                  letterSpacing: '0.24em',
                  color: FAINT,
                  textTransform: 'uppercase',
                  paddingBottom: 8,
                }}
              >
                {p.pattern.replace(/-/g, ' ')}
              </div>

              <div
                style={{
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 16,
                  color: INK,
                  lineHeight: 1.55,
                  paddingRight: 24,
                }}
              >
                {copy}
              </div>

              {prompt && (
                <div
                  style={{
                    fontFamily: "'Inter Tight',sans-serif",
                    fontSize: 14,
                    color: MUTED,
                    lineHeight: 1.55,
                    paddingTop: 8,
                    fontStyle: 'italic',
                  }}
                >
                  {prompt}
                </div>
              )}

              {suggestion && (
                <div
                  style={{
                    fontFamily: "'Inter Tight',sans-serif",
                    fontSize: 13,
                    color: MUTED,
                    lineHeight: 1.5,
                    paddingTop: 8,
                  }}
                >
                  {suggestion}
                </div>
              )}

              {meta.length > 0 && (
                <div
                  style={{
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 9,
                    letterSpacing: '0.22em',
                    color: FAINT,
                    textTransform: 'uppercase',
                    paddingTop: 10,
                    display: 'flex',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  {meta.map((m, idx) => (
                    <React.Fragment key={idx}>
                      {idx > 0 && <span>·</span>}
                      <span>{m}</span>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {source?.url && (
                <div style={{ paddingTop: 8 }}>
                  <SourcesLink sources={[source.url]} label={source.citation} />
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

// ─── WorkModule — main export ─────────────────────────────────────────────────

export interface WorkModuleProps {
  onBack?: () => void;
}

export function WorkModule({ onBack }: WorkModuleProps) {
  // ── store slices ────────────────────────────────────────────────────────────
  const [items, setItems] = useStoreSlice<WorkItem[]>('work', 'tasks', []);
  const [focusDuration, setFocusDuration] = useStoreSlice<number>('work', 'focus_duration', 25);
  const [focusLog, setFocusLog] = useStoreSlice<FocusLogEntry[]>('work', 'focus_log', []);

  // ── local UI state ──────────────────────────────────────────────────────────
  const [newTask, setNewTask] = useState('');
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [timerState, setTimerState] = useState<'idle' | 'running' | 'done'>('idle');
  const [timerSec, setTimerSec] = useState(0);
  const [timerDuration, setTimerDuration] = useState((focusDuration ?? 25) * 60);

  // ── task ops ────────────────────────────────────────────────────────────────
  const addTask = useCallback(() => {
    const t = newTask.trim();
    if (!t) return;
    const next: WorkItem = {
      id: `w-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text: sanitize(t),
      ts: Date.now(),
      status: 'open',
    };
    setItems([...(items ?? []), next]);
    setNewTask('');
  }, [newTask, items, setItems]);

  const toggleDone = useCallback(
    (id: string) => {
      setItems(
        (items ?? []).map((it) =>
          it?.id === id
            ? {
                ...it,
                status: it.status === 'done' ? 'open' : 'done',
                done_at: it.status === 'done' ? null : Date.now(),
              }
            : it,
        ),
      );
    },
    [items, setItems],
  );

  const del = useCallback(
    (id: string) => {
      setItems((items ?? []).filter((it) => it?.id !== id));
    },
    [items, setItems],
  );

  // ── derived lists ───────────────────────────────────────────────────────────
  const { visible, openCount, doneCount } = useMemo(() => {
    const all = (items ?? []).filter((it) => it?.text);
    const open = all.filter((it) => (it.status ?? 'open') === 'open').length;
    const done = all.filter((it) => it.status === 'done').length;
    const vis = all
      .filter((it) => filter === 'all' || (it.status ?? 'open') === filter)
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    return { visible: vis, openCount: open, doneCount: done };
  }, [items, filter]);

  // ── timer ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (timerState !== 'running') return;
    const id = setInterval(() => {
      setTimerSec((s) => {
        const next = s + 1;
        if (next >= timerDuration) {
          setTimerState('done');
          setFocusLog([
            ...(focusLog ?? []),
            { at: Date.now(), duration_min: Math.round(timerDuration / 60) },
          ]);
          return timerDuration;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerState, timerDuration, focusLog, setFocusLog]);

  const startTimer = useCallback(() => {
    setTimerDuration((focusDuration ?? 25) * 60);
    setTimerSec(0);
    setTimerState('running');
  }, [focusDuration]);

  const stopTimer = useCallback(() => {
    setTimerState('idle');
    setTimerSec(0);
  }, []);

  const resetTimer = useCallback(() => {
    setTimerState('idle');
    setTimerSec(0);
  }, []);

  const todaySessions = useMemo(
    () =>
      (focusLog ?? []).filter(
        (l) => l?.at && new Date(l.at).toDateString() === new Date().toDateString(),
      ),
    [focusLog],
  );

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: BG,
        color: INK,
        fontFamily: "'Inter Tight','DM Sans',sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 920,
          margin: '0 auto',
          padding: '44px clamp(24px, 5vw, 56px) 120px',
        }}
      >
        {/* ── breadcrumb nav ──────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            paddingBottom: 52,
            fontFamily: "'DM Mono',monospace",
            fontSize: 10,
            letterSpacing: '0.24em',
            color: MUTED,
            textTransform: 'uppercase',
          }}
        >
          {onBack && (
            <button
              onClick={onBack}
              style={{
                background: 'none',
                border: 'none',
                color: MUTED,
                fontFamily: 'inherit',
                fontSize: 'inherit',
                letterSpacing: 'inherit',
                cursor: 'pointer',
                textTransform: 'inherit',
              }}
            >
              ← dashboard
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginLeft: onBack ? 0 : 'auto' }}>
            <span>
              ollie <span style={{ color: FAINT, margin: '0 10px' }}>/</span>{' '}
              <span style={{ color: INK }}>work</span>
            </span>
            <ModuleHelp moduleId="work" />
          </div>
        </div>

        {/* ── title block ─────────────────────────────────────────────── */}
        <div
          style={{
            paddingBottom: 20,
            borderBottom: `1px solid ${HAIRLINE}`,
            marginBottom: 40,
          }}
        >
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 'clamp(34px, 4vw, 46px)',
              color: INK,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            work.
          </div>
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontStyle: 'italic',
              fontSize: 'clamp(16px, 1.5vw, 18px)',
              color: MUTED,
              paddingTop: 10,
            }}
          >
            what's on. sit with one for {focusDuration ?? 25} min at a time.
          </div>
        </div>

        {/* ── focus timer ─────────────────────────────────────────────── */}
        <section style={{ paddingBottom: 48 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingBottom: 20,
            }}
          >
            <div style={LABEL_STYLE}>
              focus <span style={{ color: FAINT, margin: '0 10px' }}>·</span>{' '}
              {todaySessions.length} today
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([15, 25, 45] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setFocusDuration(d)}
                  disabled={timerState === 'running'}
                  aria-pressed={(focusDuration ?? 25) === d}
                  style={{
                    padding: '6px 10px',
                    background: (focusDuration ?? 25) === d ? INK : 'transparent',
                    color: (focusDuration ?? 25) === d ? BG : MUTED,
                    border: `1px solid ${(focusDuration ?? 25) === d ? INK : HAIRLINE}`,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 10,
                    letterSpacing: '0.18em',
                    cursor: timerState === 'running' ? 'not-allowed' : 'pointer',
                    borderRadius: 2,
                  }}
                >
                  {d}m
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              padding: '36px 32px',
              background: PAPER,
              border: `1px solid ${HAIRLINE}`,
              borderRadius: 2,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            <div
              aria-live="polite"
              aria-atomic="true"
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 'clamp(56px, 7vw, 96px)',
                color: timerState === 'done' ? ACCENT : INK,
                lineHeight: 0.9,
                letterSpacing: '-0.03em',
                fontFeatureSettings: '"tnum" 1',
              }}
            >
              {timerState === 'idle' && fmtTimer(timerDuration)}
              {timerState === 'running' && fmtTimer(timerDuration - timerSec)}
              {timerState === 'done' && 'done.'}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {timerState === 'idle' && (
                <button
                  onClick={startTimer}
                  style={{
                    padding: '14px 28px',
                    background: INK,
                    color: BG,
                    border: `1px solid ${INK}`,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 11,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    borderRadius: 2,
                  }}
                >
                  start
                </button>
              )}
              {timerState === 'running' && (
                <button
                  onClick={stopTimer}
                  style={{
                    padding: '14px 28px',
                    background: 'transparent',
                    color: INK,
                    border: `1px solid ${HAIRLINE_HI}`,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 11,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    borderRadius: 2,
                  }}
                >
                  stop
                </button>
              )}
              {timerState === 'done' && (
                <button
                  onClick={resetTimer}
                  style={{
                    padding: '14px 28px',
                    background: ACCENT,
                    color: BG,
                    border: `1px solid ${ACCENT}`,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 11,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    borderRadius: 2,
                  }}
                >
                  reset
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ── task list ───────────────────────────────────────────────── */}
        <section style={{ paddingBottom: 48 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingBottom: 20,
              borderTop: `1px solid ${HAIRLINE}`,
              paddingTop: 32,
            }}
          >
            <div style={LABEL_STYLE}>
              tasks <span style={{ color: FAINT, margin: '0 10px' }}>·</span> what's on
            </div>
            <div style={{ display: 'flex', gap: 14 }}>
              {(
                [
                  ['open', openCount],
                  ['done', doneCount],
                  ['all', (items ?? []).length],
                ] as [typeof filter, number][]
              ).map(([k, n]) => {
                const on = filter === k;
                return (
                  <button
                    key={k}
                    onClick={() => setFilter(k)}
                    aria-pressed={on}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '4px 0',
                      fontFamily: "'DM Mono',monospace",
                      fontSize: 10,
                      letterSpacing: '0.22em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      color: on ? INK : FAINT,
                      borderBottom: `1px solid ${on ? ACCENT : 'transparent'}`,
                    }}
                  >
                    {k} <span style={{ color: on ? MUTED : FAINT, marginLeft: 4 }}>{n}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* add task input */}
          <div style={{ display: 'flex', gap: 10, paddingBottom: 24 }}>
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTask();
              }}
              placeholder="what's on? enter to add"
              aria-label="new task"
              style={{
                flex: 1,
                padding: '12px 14px',
                background: PAPER,
                border: `1px solid ${HAIRLINE}`,
                color: INK,
                borderRadius: 2,
                fontFamily: "'Inter Tight',sans-serif",
                fontSize: 15,
                outline: 'none',
              }}
            />
            <button
              onClick={addTask}
              disabled={!newTask.trim()}
              style={{
                padding: '12px 22px',
                background: newTask.trim() ? INK : 'transparent',
                color: newTask.trim() ? BG : FAINT,
                border: `1px solid ${newTask.trim() ? INK : HAIRLINE_HI}`,
                fontFamily: "'DM Mono',monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: newTask.trim() ? 'pointer' : 'default',
                borderRadius: 2,
              }}
            >
              add
            </button>
          </div>

          {/* task list / empty state */}
          {visible.length === 0 ? (
            <div
              style={{
                padding: '16px 0',
                fontFamily: "'DM Serif Display',serif",
                fontStyle: 'italic',
                fontSize: 'clamp(18px, 2vw, 22px)',
                color: MUTED,
                lineHeight: 1.4,
                maxWidth: 520,
              }}
            >
              {filter === 'open'
                ? (items ?? []).length === 0
                  ? 'nothing on the list yet.'
                  : 'nothing open. enjoy it or write something down.'
                : filter === 'done'
                ? "nothing finished yet. that's fine."
                : 'empty.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {visible.map((it) => {
                const done = (it.status ?? 'open') === 'done';
                return (
                  <div
                    key={it.id}
                    style={{
                      padding: '14px 0',
                      borderBottom: `1px solid ${HAIRLINE}`,
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto',
                      gap: 14,
                      alignItems: 'center',
                    }}
                  >
                    <button
                      onClick={() => toggleDone(it.id)}
                      aria-label={done ? 'mark task open' : 'mark task done'}
                      aria-pressed={done}
                      style={{
                        width: 22,
                        height: 22,
                        padding: 0,
                        background: 'transparent',
                        border: `1.5px solid ${done ? ACCENT : HAIRLINE_HI}`,
                        borderRadius: 3,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 240ms',
                        flexShrink: 0,
                      }}
                    >
                      {done && (
                        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                          <path
                            d="M 3 7 L 6 10 L 11 4"
                            fill="none"
                            stroke={ACCENT}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>

                    <div
                      style={{
                        fontFamily: "'Inter Tight',sans-serif",
                        fontSize: 16,
                        color: done ? MUTED : INK,
                        textDecoration: done ? 'line-through' : 'none',
                        textDecorationColor: FAINT,
                        textDecorationThickness: '1px',
                      }}
                    >
                      {it.text}
                    </div>

                    <button
                      onClick={() => del(it.id)}
                      aria-label={`remove ${it.text}`}
                      style={{
                        padding: '6px 10px',
                        background: 'transparent',
                        color: FAINT,
                        border: 'none',
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 10,
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >
                      remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── noticed (patterns) ──────────────────────────────────────── */}
        <WorkNoticed />

        {/* ── footer ──────────────────────────────────────────────────── */}
        <div
          style={{
            marginTop: 48,
            paddingTop: 28,
            borderTop: `1px solid ${HAIRLINE}`,
            fontFamily: "'DM Mono',monospace",
            fontSize: 9,
            letterSpacing: '0.36em',
            color: FAINT,
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          ollie <span style={{ color: MUTED, margin: '0 10px' }}>·</span> work{' '}
          <span style={{ color: MUTED, margin: '0 10px' }}>·</span> mmxxvi
        </div>
      </div>
    </div>
  );
}
