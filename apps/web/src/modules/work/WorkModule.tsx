import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import type {
  AnyWorkPattern,
  Project,
  FocusLogEntry as LogicFocusLogEntry,
  FocusDurationMin,
  Meeting,
  ScheduledFocusBlock,
} from '@ollie/logic/work';
import { useStoreSlice, store } from '../../store';
import type { ActiveFocus } from '@ollie/notifications/suppression';
import { mkId } from '../../lib/mkId';
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

// ─── Phase 3 UI-local types ──────────────────────────────────────────────────
// Backend Phase 3 schema lands separately; these mirror what the UI writes to
// the loose store slices and will be reconciled with @ollie/logic/work on merge.

// Distraction journal — manual entry: when + what pulled you away.
// ADHD tool: non-judgmental, just makes the pattern visible.
interface DistractionEntry {
  id: string;
  /** ms epoch the distraction was logged. */
  ts: number;
  /** Free-text: what pulled attention away. */
  what: string;
}

// Collaboration / hand-off notes — text + optional recipient.
interface HandoffNote {
  id: string;
  /** ms epoch created. */
  ts: number;
  /** Note body. */
  text: string;
  /** Optional "for" name — who the hand-off is addressed to. */
  to?: string;
}

// Legacy log entries (pre-2026-05-14) may have used { at, duration_min } shape.
// We migrate on read in todaySessions/billable rollups.
interface LegacyFocusLogEntry {
  at?: number;
  ts?: number;
  duration_min?: number;
  duration_ms?: number;
  project_id?: string;
  task_id?: string;
}

type AnyFocusLogEntry = LogicFocusLogEntry | LegacyFocusLogEntry;

function readLogTs(e: AnyFocusLogEntry): number {
  return (e as LogicFocusLogEntry).ts ?? (e as LegacyFocusLogEntry).at ?? 0;
}

function readLogDurationMs(e: AnyFocusLogEntry): number {
  const ms = (e as LogicFocusLogEntry).duration_ms;
  if (typeof ms === 'number' && ms >= 0) return ms;
  const min = (e as { duration_min?: number }).duration_min;
  if (typeof min === 'number') return min * 60_000;
  return 0;
}

function readLogProjectId(e: AnyFocusLogEntry): string | undefined {
  return (e as { project_id?: string }).project_id;
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
  const [focusDuration, setFocusDuration] = useStoreSlice<FocusDurationMin>('work', 'focus_duration', 25);
  const [focusLog, setFocusLog] = useStoreSlice<AnyFocusLogEntry[]>('work', 'focus_log', []);
  const [projects, setProjects] = useStoreSlice<Project[]>('work', 'projects', []);
  const [meetings, setMeetings] = useStoreSlice<Meeting[]>('work', 'meetings', []);
  const [scheduledBlocks, setScheduledBlocks] = useStoreSlice<ScheduledFocusBlock[]>(
    'work',
    'scheduled_blocks',
    [],
  );
  // Cross-module: read body.sleep_sounds for brown-noise overlay default.
  const [sleepSounds] = useStoreSlice<{ enabled?: boolean; track?: string }>('body', 'sleep_sounds', { enabled: true, track: 'brown_noise' });
  // Phase 3 slices — distraction journal + collaboration notes.
  const [distractions, setDistractions] = useStoreSlice<DistractionEntry[]>('work', 'distractions', []);
  const [handoffNotes, setHandoffNotes] = useStoreSlice<HandoffNote[]>('work', 'handoff_notes', []);

  // ── local UI state ──────────────────────────────────────────────────────────
  const [newTask, setNewTask] = useState('');
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [timerState, setTimerState] = useState<'idle' | 'running' | 'done'>('idle');
  const [timerSec, setTimerSec] = useState(0);
  const [timerDuration, setTimerDuration] = useState((focusDuration ?? 25) * 60);
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(undefined);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [noiseEnabled, setNoiseEnabled] = useState<boolean>(sleepSounds?.enabled !== false);

  // ── brown-noise overlay (audio element) ────────────────────────────────────
  // Mounts during focus timer; unmounts on stop/done/idle. iOS Safari needs
  // user-gesture to play, which we already have (timer start is a tap).
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionStartRef = useRef<number>(0);

  // ── meeting tracker UI state ────────────────────────────────────────────────
  const [meetOpen, setMeetOpen] = useState(false);
  const [meetTitle, setMeetTitle] = useState('');
  const [meetWhen, setMeetWhen] = useState('');
  const [meetDuration, setMeetDuration] = useState('30');
  const [meetAttendees, setMeetAttendees] = useState('');

  // ── scheduled deep work UI state ────────────────────────────────────────────
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockTitle, setBlockTitle] = useState('');
  const [blockWhen, setBlockWhen] = useState('');
  const [blockDuration, setBlockDuration] = useState<FocusDurationMin>(45);
  const [blockProjectId, setBlockProjectId] = useState<string>('');

  // ── distraction journal UI state ────────────────────────────────────────────
  const [distractText, setDistractText] = useState('');

  // ── collaboration notes UI state ────────────────────────────────────────────
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteTo, setNoteTo] = useState('');

  // ── task ops ────────────────────────────────────────────────────────────────
  const addTask = useCallback(() => {
    const t = newTask.trim();
    if (!t) return;
    const next: WorkItem = {
      id: mkId('w'),
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
          // Session completed naturally → clear the active-focus marker.
          store.set('work', 'active_focus', null);
          const entry: LogicFocusLogEntry = {
            ts: sessionStartRef.current || Date.now(),
            duration_min: ((focusDuration ?? 25) as FocusDurationMin),
            duration_ms: timerDuration * 1000,
            ...(activeProjectId ? { project_id: activeProjectId } : {}),
          };
          setFocusLog([...(focusLog ?? []), entry]);
          return timerDuration;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerState, timerDuration, focusLog, setFocusLog, activeProjectId, focusDuration]);

  // Brown-noise audio mount: starts on running, fades on stop/done.
  useEffect(() => {
    if (timerState === 'running' && noiseEnabled) {
      const a = audioRef.current;
      if (a) {
        a.volume = 0.5;
        a.loop = true;
        // .play() may reject if no user gesture — silently ignore (we have one).
        void a.play().catch(() => { /* iOS will succeed because tap initiated state change */ });
      }
    } else {
      const a = audioRef.current;
      if (a && !a.paused) {
        a.pause();
        try { a.currentTime = 0; } catch { /* noop */ }
      }
    }
  }, [timerState, noiseEnabled]);

  const startTimer = useCallback(() => {
    const durationMin = focusDuration ?? 25;
    setTimerDuration(durationMin * 60);
    setTimerSec(0);
    const startedAt = Date.now();
    sessionStartRef.current = startedAt;
    setTimerState('running');
    // Publish the active focus session so notification suppression can
    // defer PATTERN_ALERT / CONTENT_DELIVERY cues until the session ends.
    const session: ActiveFocus = {
      startedAt,
      endsAt: startedAt + durationMin * 60_000,
    };
    store.set('work', 'active_focus', session);
  }, [focusDuration]);

  const stopTimer = useCallback(() => {
    // Log partial session (audit fix — was being discarded).
    if (timerSec >= 60) {
      const entry: LogicFocusLogEntry = {
        ts: sessionStartRef.current || Date.now(),
        duration_min: ((focusDuration ?? 25) as FocusDurationMin),
        duration_ms: timerSec * 1000,
        ...(activeProjectId ? { project_id: activeProjectId } : {}),
      };
      setFocusLog([...(focusLog ?? []), entry]);
    }
    setTimerState('idle');
    setTimerSec(0);
    // Session over → clear the active-focus marker so suppression lifts.
    store.set('work', 'active_focus', null);
  }, [timerSec, focusDuration, activeProjectId, focusLog, setFocusLog]);

  const resetTimer = useCallback(() => {
    setTimerState('idle');
    setTimerSec(0);
    store.set('work', 'active_focus', null);
  }, []);

  const todaySessions = useMemo(
    () =>
      (focusLog ?? []).filter((l) => {
        const ts = readLogTs(l);
        if (!ts) return false;
        return new Date(ts).toDateString() === new Date().toDateString();
      }),
    [focusLog],
  );

  // ── project ops ─────────────────────────────────────────────────────────────
  const addProject = useCallback(() => {
    const name = newProjectName.trim();
    if (!name) return;
    const p: Project = {
      id: mkId('proj'),
      name: sanitize(name),
      created_at: Date.now(),
    };
    setProjects([...(projects ?? []), p]);
    setActiveProjectId(p.id);
    setNewProjectName('');
    setShowProjectPicker(false);
  }, [newProjectName, projects, setProjects]);

  // Week-to-date billable rollup per project.
  const weeklyRollup = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    const sums = new Map<string, number>();
    for (const l of focusLog ?? []) {
      const ts = readLogTs(l);
      if (ts < weekAgo) continue;
      const pid = readLogProjectId(l);
      if (!pid) continue;
      sums.set(pid, (sums.get(pid) ?? 0) + readLogDurationMs(l));
    }
    const rows: Array<{ id: string; name: string; minutes: number }> = [];
    for (const p of projects ?? []) {
      const ms = sums.get(p.id) ?? 0;
      if (ms === 0) continue;
      rows.push({ id: p.id, name: p.name, minutes: Math.round(ms / 60_000) });
    }
    rows.sort((a, b) => b.minutes - a.minutes);
    return rows;
  }, [focusLog, projects]);

  const activeProjectName = useMemo(() => {
    if (!activeProjectId) return null;
    return (projects ?? []).find((p) => p.id === activeProjectId)?.name ?? null;
  }, [activeProjectId, projects]);

  // ── meetings ───────────────────────────────────────────────────────────────
  const thisWeekMeetings = useMemo(() => {
    const now = Date.now();
    const weekOut = now + 7 * 86_400_000;
    return (meetings ?? [])
      .filter((m) => m?.start_at && m.start_at >= now - 2 * 3600_000 && m.start_at <= weekOut)
      .sort((a, b) => a.start_at - b.start_at);
  }, [meetings]);

  const addMeeting = useCallback(() => {
    const title = meetTitle.trim();
    const when = meetWhen.trim();
    if (!title || !when) return;
    const startMs = Date.parse(when);
    if (isNaN(startMs)) return;
    const durMin = Math.max(5, Math.min(480, parseInt(meetDuration || '30', 10) || 30));
    const attendees = meetAttendees
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const m: Meeting = {
      id: mkId('mtg'),
      title: sanitize(title),
      start_at: startMs,
      end_at: startMs + durMin * 60_000,
      duration_min: durMin,
      attendees: attendees.length ? attendees : undefined,
    };
    setMeetings([...(meetings ?? []), m]);
    setMeetTitle('');
    setMeetWhen('');
    setMeetDuration('30');
    setMeetAttendees('');
    setMeetOpen(false);
  }, [meetTitle, meetWhen, meetDuration, meetAttendees, meetings, setMeetings]);

  const removeMeeting = useCallback((id: string | null | undefined) => {
    if (!id) return;
    setMeetings((meetings ?? []).filter((m) => m?.id !== id));
  }, [meetings, setMeetings]);

  // ── scheduled deep-work blocks ─────────────────────────────────────────────
  // Upcoming = not past, not cancelled. Past/cancelled blocks are hidden;
  // the orchestrator still skips cancelled blocks via b.cancelled_at.
  const upcomingBlocks = useMemo(() => {
    const now = Date.now();
    return (scheduledBlocks ?? [])
      .filter((b) => b?.start_at && b.start_at >= now && !b.cancelled_at)
      .sort((a, b) => a.start_at - b.start_at);
  }, [scheduledBlocks]);

  const addBlock = useCallback(() => {
    const when = blockWhen.trim();
    if (!when) return;
    const startMs = Date.parse(when);
    if (isNaN(startMs)) return;
    // Refuse past times — silent no-op (the disabled state guards already).
    if (startMs < Date.now()) return;
    const block: ScheduledFocusBlock = {
      id: mkId('block'),
      start_at: startMs,
      duration_min: blockDuration,
      ...(blockProjectId ? { project_id: blockProjectId } : {}),
      ...(blockTitle.trim() ? { label: sanitize(blockTitle.trim()) } : {}),
      created_at: Date.now(),
    };
    setScheduledBlocks([...(scheduledBlocks ?? []), block]);
    setBlockTitle('');
    setBlockWhen('');
    setBlockDuration(45);
    setBlockProjectId('');
    setBlockOpen(false);
  }, [blockWhen, blockDuration, blockProjectId, blockTitle, scheduledBlocks, setScheduledBlocks]);

  const cancelBlock = useCallback(
    (id: string | null | undefined) => {
      if (!id) return;
      setScheduledBlocks(
        (scheduledBlocks ?? []).map((b) =>
          b?.id === id ? { ...b, cancelled_at: Date.now() } : b,
        ),
      );
    },
    [scheduledBlocks, setScheduledBlocks],
  );

  const activeProjects = useMemo(
    () => (projects ?? []).filter((p) => !p.archived_at),
    [projects],
  );

  // ── distraction journal ─────────────────────────────────────────────────────
  const addDistraction = useCallback(() => {
    const w = distractText.trim();
    if (!w) return;
    const entry: DistractionEntry = {
      id: mkId('dx'),
      ts: Date.now(),
      what: sanitize(w),
    };
    setDistractions([...(distractions ?? []), entry]);
    setDistractText('');
  }, [distractText, distractions, setDistractions]);

  const removeDistraction = useCallback(
    (id: string) => {
      setDistractions((distractions ?? []).filter((d) => d?.id !== id));
    },
    [distractions, setDistractions],
  );

  // Recent distractions, newest first, capped to keep the list calm.
  const recentDistractions = useMemo(() => {
    return (distractions ?? [])
      .filter((d) => d?.what)
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
      .slice(0, 30);
  }, [distractions]);

  // Count of distractions logged today — a plain, un-judged tally.
  const distractionsToday = useMemo(() => {
    const today = new Date().toDateString();
    return (distractions ?? []).filter(
      (d) => d?.ts && new Date(d.ts).toDateString() === today,
    ).length;
  }, [distractions]);

  // ── pomodoro cycle ──────────────────────────────────────────────────────────
  // Backend cycle logic lands separately; until then the UI derives a simple,
  // deterministic cycle from today's completed focus sessions: after every
  // 4th block, a longer break is suggested. No streaks, no pressure.
  const pomodoro = useMemo(() => {
    const done = todaySessions.length;
    const inCycle = done % 4; // 0..3 blocks into the current set of four
    const blocksUntilLongBreak = inCycle === 0 ? 4 : 4 - inCycle;
    const longBreakNow = done > 0 && inCycle === 0;
    return { done, inCycle, blocksUntilLongBreak, longBreakNow };
  }, [todaySessions]);

  // ── collaboration / hand-off notes ──────────────────────────────────────────
  const addNote = useCallback(() => {
    const t = noteText.trim();
    if (!t) return;
    const note: HandoffNote = {
      id: mkId('hn'),
      ts: Date.now(),
      text: sanitize(t),
      ...(noteTo.trim() ? { to: sanitize(noteTo.trim()) } : {}),
    };
    setHandoffNotes([...(handoffNotes ?? []), note]);
    setNoteText('');
    setNoteTo('');
    setNoteOpen(false);
  }, [noteText, noteTo, handoffNotes, setHandoffNotes]);

  const removeNote = useCallback(
    (id: string) => {
      setHandoffNotes((handoffNotes ?? []).filter((n) => n?.id !== id));
    },
    [handoffNotes, setHandoffNotes],
  );

  const sortedNotes = useMemo(() => {
    return (handoffNotes ?? [])
      .filter((n) => n?.text)
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  }, [handoffNotes]);

  function fmtBlockWhen(ms: number): string {
    try {
      return new Date(ms).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).toLowerCase();
    } catch {
      return new Date(ms).toISOString();
    }
  }

  function fmtMeetingWhen(ms: number): string {
    try {
      return new Date(ms).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).toLowerCase();
    } catch {
      return new Date(ms).toISOString();
    }
  }

  // Calm relative-time stamp for journal-style lists (distractions, notes).
  function fmtLogWhen(ms: number): string {
    try {
      const now = Date.now();
      const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
      const time = new Date(ms)
        .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        .toLowerCase();
      if (sameDay) return `today · ${time}`;
      const day = new Date(ms)
        .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
        .toLowerCase();
      return `${day} · ${time}`;
    } catch {
      return new Date(ms).toISOString();
    }
  }

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
          // Top clears the notch; bottom clears the brain-dump bar +
          // home indicator (120px bar reserve + safe-area inset).
          padding:
            'calc(44px + env(safe-area-inset-top, 0px)) clamp(24px, 5vw, 56px) calc(120px + env(safe-area-inset-bottom, 0px))',
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
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={LABEL_STYLE}>
              focus <span style={{ color: FAINT, margin: '0 10px' }}>·</span>{' '}
              {todaySessions.length} today
              {activeProjectName && (
                <>
                  <span style={{ color: FAINT, margin: '0 10px' }}>·</span>
                  <span style={{ color: INK }}>{activeProjectName}</span>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([15, 25, 45, 90] as const).map((d) => (
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

          {/* ── project picker + noise toggle row ─────────────────────── */}
          {timerState === 'idle' && (
            <div
              style={{
                display: 'flex',
                gap: 14,
                paddingBottom: 16,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 9,
                    letterSpacing: '0.22em',
                    color: FAINT,
                    textTransform: 'uppercase',
                  }}
                >
                  project
                </span>
                <select
                  value={activeProjectId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__new__') {
                      setShowProjectPicker(true);
                      return;
                    }
                    setActiveProjectId(v || undefined);
                  }}
                  aria-label="project for this focus session"
                  style={{
                    padding: '8px 10px',
                    background: 'transparent',
                    border: `1px solid ${HAIRLINE_HI}`,
                    borderRadius: 2,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 10,
                    letterSpacing: '0.18em',
                    color: INK,
                    textTransform: 'lowercase',
                    cursor: 'pointer',
                  }}
                >
                  <option value="">no project</option>
                  {(projects ?? [])
                    .filter((p) => !p.archived_at)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  <option value="__new__">+ new project</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setNoiseEnabled((v) => !v)}
                  aria-pressed={noiseEnabled}
                  aria-label={noiseEnabled ? 'turn brown noise off' : 'turn brown noise on'}
                  style={{
                    padding: '8px 12px',
                    background: 'transparent',
                    color: noiseEnabled ? INK : FAINT,
                    border: `1px solid ${HAIRLINE_HI}`,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 10,
                    letterSpacing: '0.20em',
                    textTransform: 'uppercase',
                    borderRadius: 2,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: noiseEnabled ? ACCENT : 'transparent',
                      border: `1px solid ${noiseEnabled ? ACCENT : HAIRLINE_HI}`,
                      display: 'inline-block',
                    }}
                    aria-hidden="true"
                  />
                  noise
                </button>
              </div>
            </div>
          )}

          {/* inline new-project form */}
          {showProjectPicker && timerState === 'idle' && (
            <div
              style={{
                padding: '14px 16px',
                background: PAPER,
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 2,
                marginBottom: 16,
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addProject(); }}
                placeholder="project or client name"
                aria-label="new project name"
                style={{
                  flex: 1,
                  minWidth: 180,
                  padding: '10px 12px',
                  background: BG,
                  border: `1px solid ${HAIRLINE}`,
                  color: INK,
                  borderRadius: 2,
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 14,
                  outline: 'none',
                }}
              />
              <button
                onClick={addProject}
                disabled={!newProjectName.trim()}
                style={{
                  padding: '10px 18px',
                  background: newProjectName.trim() ? INK : 'transparent',
                  color: newProjectName.trim() ? BG : FAINT,
                  border: `1px solid ${newProjectName.trim() ? INK : HAIRLINE_HI}`,
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 10,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: newProjectName.trim() ? 'pointer' : 'default',
                  borderRadius: 2,
                }}
              >
                add
              </button>
              <button
                onClick={() => { setShowProjectPicker(false); setNewProjectName(''); }}
                style={{
                  padding: '10px 14px',
                  background: 'transparent',
                  color: FAINT,
                  border: 'none',
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 10,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                cancel
              </button>
            </div>
          )}

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

          {/* ── brown-noise audio (hidden) ───────────────────────────── */}
          <audio
            ref={audioRef}
            src="/audio/brown-noise.mp3"
            preload="auto"
            aria-hidden="true"
          />

          {/* ── pomodoro cycle indicator ─────────────────────────────── */}
          {/* Shows position in the 4-block cycle. Quiet by design: a row of
              ticks, no running tally, no exclamation. Only nudges toward a
              break. */}
          {pomodoro.done > 0 && (
            <div
              style={{
                marginTop: 24,
                padding: '18px 22px',
                background: PAPER,
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 2,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ display: 'flex', gap: 6 }} aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => {
                    const filled = i < (pomodoro.longBreakNow ? 4 : pomodoro.inCycle);
                    return (
                      <span
                        key={i}
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: filled ? ACCENT : 'transparent',
                          border: `1px solid ${filled ? ACCENT : HAIRLINE_HI}`,
                        }}
                      />
                    );
                  })}
                </div>
                <div style={LABEL_STYLE}>
                  {pomodoro.done} {pomodoro.done === 1 ? 'block' : 'blocks'} today
                </div>
              </div>
              <div
                style={{
                  fontFamily: "'DM Serif Display',serif",
                  fontStyle: 'italic',
                  fontSize: 'clamp(15px, 1.5vw, 17px)',
                  color: pomodoro.longBreakNow ? ACCENT : MUTED,
                  lineHeight: 1.4,
                }}
              >
                {pomodoro.longBreakNow
                  ? 'four blocks done. a longer break is earned — step away.'
                  : pomodoro.blocksUntilLongBreak === 1
                    ? 'one more block, then a longer break.'
                    : `${pomodoro.blocksUntilLongBreak} blocks until a longer break.`}
              </div>
            </div>
          )}

          {/* ── billable hours per project (week-to-date) ───────────── */}
          {weeklyRollup.length > 0 && (
            <div
              style={{
                marginTop: 32,
                padding: '20px 22px',
                background: PAPER,
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 2,
              }}
            >
              <div
                style={{
                  ...LABEL_STYLE,
                  paddingBottom: 14,
                  borderBottom: `1px solid ${HAIRLINE}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                }}
              >
                <span>this week · per project</span>
                <span style={{ color: FAINT }}>
                  {weeklyRollup.reduce((s, r) => s + r.minutes, 0)} min total
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {weeklyRollup.map((row) => {
                  const h = Math.floor(row.minutes / 60);
                  const m = row.minutes % 60;
                  const label = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
                  return (
                    <div
                      key={row.id}
                      style={{
                        padding: '12px 0',
                        borderBottom: `1px solid ${HAIRLINE}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        fontFamily: "'Inter Tight',sans-serif",
                        fontSize: 14,
                        color: INK,
                      }}
                    >
                      <span>{row.name}</span>
                      <span
                        style={{
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 11,
                          letterSpacing: '0.14em',
                          color: MUTED,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* ── meetings this week ───────────────────────────────────── */}
        <section style={{ paddingBottom: 48, borderTop: `1px solid ${HAIRLINE}`, paddingTop: 32 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingBottom: 20,
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={LABEL_STYLE}>
              meetings <span style={{ color: FAINT, margin: '0 10px' }}>·</span> this week
            </div>
            <button
              type="button"
              onClick={() => setMeetOpen((o) => !o)}
              style={{
                padding: '8px 16px',
                background: meetOpen ? INK : 'transparent',
                color: meetOpen ? BG : INK,
                border: `1px solid ${meetOpen ? INK : HAIRLINE_HI}`,
                fontFamily: "'DM Mono',monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                borderRadius: 2,
              }}
            >
              {meetOpen ? 'close' : '+ add meeting'}
            </button>
          </div>

          {meetOpen && (
            <div
              style={{
                padding: 22,
                background: PAPER,
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 2,
                marginBottom: 24,
                display: 'grid',
                gap: 12,
              }}
            >
              <input
                value={meetTitle}
                onChange={(e) => setMeetTitle(e.target.value)}
                placeholder="title (e.g. design review)"
                aria-label="meeting title"
                style={{
                  padding: '12px 14px',
                  background: BG,
                  border: `1px solid ${HAIRLINE}`,
                  color: INK,
                  borderRadius: 2,
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 15,
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  type="datetime-local"
                  value={meetWhen}
                  onChange={(e) => setMeetWhen(e.target.value)}
                  aria-label="meeting datetime"
                  style={{
                    flex: '1 1 240px',
                    padding: '10px 12px',
                    background: BG,
                    border: `1px solid ${HAIRLINE}`,
                    color: INK,
                    borderRadius: 2,
                    fontFamily: "'Inter Tight',sans-serif",
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
                <input
                  type="number"
                  min={5}
                  max={480}
                  value={meetDuration}
                  onChange={(e) => setMeetDuration(e.target.value)}
                  aria-label="duration in minutes"
                  style={{
                    width: 120,
                    padding: '10px 12px',
                    background: BG,
                    border: `1px solid ${HAIRLINE}`,
                    color: INK,
                    borderRadius: 2,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
              </div>
              <input
                value={meetAttendees}
                onChange={(e) => setMeetAttendees(e.target.value)}
                placeholder="attendees · comma separated · optional"
                aria-label="attendees"
                style={{
                  padding: '10px 12px',
                  background: BG,
                  border: `1px solid ${HAIRLINE}`,
                  color: INK,
                  borderRadius: 2,
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={addMeeting}
                  disabled={!meetTitle.trim() || !meetWhen.trim()}
                  style={{
                    padding: '10px 20px',
                    background: meetTitle.trim() && meetWhen.trim() ? INK : 'transparent',
                    color: meetTitle.trim() && meetWhen.trim() ? BG : FAINT,
                    border: `1px solid ${meetTitle.trim() && meetWhen.trim() ? INK : HAIRLINE_HI}`,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 10,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    cursor: meetTitle.trim() && meetWhen.trim() ? 'pointer' : 'default',
                    borderRadius: 2,
                  }}
                >
                  add
                </button>
                <button
                  type="button"
                  onClick={() => setMeetOpen(false)}
                  style={{
                    padding: '10px 14px',
                    background: 'transparent',
                    color: FAINT,
                    border: 'none',
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 10,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  cancel
                </button>
              </div>
            </div>
          )}

          {thisWeekMeetings.length === 0 ? (
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontStyle: 'italic',
                fontSize: 'clamp(16px, 1.6vw, 18px)',
                color: MUTED,
                lineHeight: 1.4,
                paddingTop: 4,
              }}
            >
              no meetings logged for the next 7 days. quiet week or the calendar is lying.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {thisWeekMeetings.map((m) => (
                <div
                  key={m.id ?? `${m.start_at}-${m.title ?? ''}`}
                  style={{
                    padding: '14px 0',
                    borderBottom: `1px solid ${HAIRLINE}`,
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 14,
                    alignItems: 'baseline',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "'Inter Tight',sans-serif",
                        fontSize: 16,
                        color: INK,
                        fontWeight: 500,
                      }}
                    >
                      {m.title || 'meeting'}
                    </div>
                    <div
                      style={{
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 10,
                        letterSpacing: '0.18em',
                        color: MUTED,
                        textTransform: 'lowercase',
                        paddingTop: 6,
                      }}
                    >
                      {fmtMeetingWhen(m.start_at)}
                      {m.duration_min ? ` · ${m.duration_min} min` : ''}
                      {m.attendees && m.attendees.length > 0
                        ? ` · ${m.attendees.join(', ')}`
                        : ''}
                    </div>
                    <div
                      style={{
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 9,
                        letterSpacing: '0.22em',
                        color: FAINT,
                        textTransform: 'uppercase',
                        paddingTop: 4,
                      }}
                    >
                      ping 30m prior
                    </div>
                  </div>
                  <button
                    onClick={() => removeMeeting(m.id)}
                    aria-label={`remove ${m.title ?? 'meeting'}`}
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
              ))}
            </div>
          )}
        </section>

        {/* ── scheduled deep work ──────────────────────────────────── */}
        <section style={{ paddingBottom: 48, borderTop: `1px solid ${HAIRLINE}`, paddingTop: 32 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingBottom: 20,
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={LABEL_STYLE}>
              scheduled deep work <span style={{ color: FAINT, margin: '0 10px' }}>·</span> ping 1h prior
            </div>
            <button
              type="button"
              onClick={() => setBlockOpen((o) => !o)}
              style={{
                padding: '8px 16px',
                background: blockOpen ? INK : 'transparent',
                color: blockOpen ? BG : INK,
                border: `1px solid ${blockOpen ? INK : HAIRLINE_HI}`,
                fontFamily: "'DM Mono',monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                borderRadius: 2,
              }}
            >
              {blockOpen ? 'close' : '+ schedule block'}
            </button>
          </div>

          {blockOpen && (
            <div
              style={{
                padding: 22,
                background: PAPER,
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 2,
                marginBottom: 24,
                display: 'grid',
                gap: 12,
              }}
            >
              <input
                value={blockTitle}
                onChange={(e) => setBlockTitle(e.target.value)}
                placeholder="title · optional (e.g. q3 deck)"
                aria-label="block title"
                style={{
                  padding: '12px 14px',
                  background: BG,
                  border: `1px solid ${HAIRLINE}`,
                  color: INK,
                  borderRadius: 2,
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 15,
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <input
                  type="datetime-local"
                  value={blockWhen}
                  onChange={(e) => setBlockWhen(e.target.value)}
                  aria-label="block datetime"
                  style={{
                    flex: '1 1 240px',
                    padding: '10px 12px',
                    background: BG,
                    border: `1px solid ${HAIRLINE}`,
                    color: INK,
                    borderRadius: 2,
                    fontFamily: "'Inter Tight',sans-serif",
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
                <select
                  value={String(blockDuration)}
                  onChange={(e) => setBlockDuration(Number(e.target.value) as FocusDurationMin)}
                  aria-label="block duration"
                  style={{
                    padding: '10px 12px',
                    background: BG,
                    border: `1px solid ${HAIRLINE}`,
                    color: INK,
                    borderRadius: 2,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 11,
                    letterSpacing: '0.18em',
                    textTransform: 'lowercase',
                    cursor: 'pointer',
                  }}
                >
                  {([15, 25, 45, 90] as const).map((d) => (
                    <option key={d} value={d}>{d} min</option>
                  ))}
                </select>
              </div>
              <select
                value={blockProjectId}
                onChange={(e) => setBlockProjectId(e.target.value)}
                aria-label="block project"
                style={{
                  padding: '10px 12px',
                  background: BG,
                  border: `1px solid ${HAIRLINE}`,
                  color: INK,
                  borderRadius: 2,
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 11,
                  letterSpacing: '0.18em',
                  textTransform: 'lowercase',
                  cursor: 'pointer',
                }}
              >
                <option value="">no project</option>
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={addBlock}
                  disabled={!blockWhen.trim()}
                  style={{
                    padding: '10px 20px',
                    background: blockWhen.trim() ? INK : 'transparent',
                    color: blockWhen.trim() ? BG : FAINT,
                    border: `1px solid ${blockWhen.trim() ? INK : HAIRLINE_HI}`,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 10,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    cursor: blockWhen.trim() ? 'pointer' : 'default',
                    borderRadius: 2,
                  }}
                >
                  schedule
                </button>
                <button
                  type="button"
                  onClick={() => setBlockOpen(false)}
                  style={{
                    padding: '10px 14px',
                    background: 'transparent',
                    color: FAINT,
                    border: 'none',
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 10,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  cancel
                </button>
              </div>
            </div>
          )}

          {upcomingBlocks.length === 0 ? (
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontStyle: 'italic',
                fontSize: 'clamp(16px, 1.6vw, 18px)',
                color: MUTED,
                lineHeight: 1.4,
                paddingTop: 4,
              }}
            >
              no blocks booked. schedule one — ollie pings you an hour before.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {upcomingBlocks.map((b) => {
                const projectName = b.project_id
                  ? (projects ?? []).find((p) => p.id === b.project_id)?.name
                  : null;
                return (
                  <div
                    key={b.id ?? `${b.start_at}-${b.label ?? ''}`}
                    style={{
                      padding: '14px 0',
                      borderBottom: `1px solid ${HAIRLINE}`,
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      gap: 14,
                      alignItems: 'baseline',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: "'Inter Tight',sans-serif",
                          fontSize: 16,
                          color: INK,
                          fontWeight: 500,
                        }}
                      >
                        {b.label || `deep work · ${b.duration_min} min`}
                      </div>
                      <div
                        style={{
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 10,
                          letterSpacing: '0.18em',
                          color: MUTED,
                          textTransform: 'lowercase',
                          paddingTop: 6,
                        }}
                      >
                        {fmtBlockWhen(b.start_at)}
                        {` · ${b.duration_min} min`}
                        {projectName ? ` · ${projectName}` : ''}
                      </div>
                      <div
                        style={{
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 9,
                          letterSpacing: '0.22em',
                          color: FAINT,
                          textTransform: 'uppercase',
                          paddingTop: 4,
                        }}
                      >
                        ping 1h prior
                      </div>
                    </div>
                    <button
                      onClick={() => cancelBlock(b.id)}
                      aria-label={`cancel ${b.label ?? 'deep work block'}`}
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
                      cancel
                    </button>
                  </div>
                );
              })}
            </div>
          )}
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

        {/* ── distraction journal ─────────────────────────────────────── */}
        <section style={{ paddingBottom: 48, borderTop: `1px solid ${HAIRLINE}`, paddingTop: 32 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingBottom: 8,
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={LABEL_STYLE}>
              distractions
              {distractionsToday > 0 && (
                <>
                  <span style={{ color: FAINT, margin: '0 10px' }}>·</span>
                  {distractionsToday} today
                </>
              )}
            </div>
          </div>
          <div
            style={{
              fontFamily: "'DM Serif Display',serif",
              fontStyle: 'italic',
              fontSize: 'clamp(15px, 1.5vw, 17px)',
              color: MUTED,
              lineHeight: 1.4,
              paddingBottom: 20,
              maxWidth: 540,
            }}
          >
            note what pulled you away — no fix needed, just so the shape becomes visible over time.
          </div>

          {/* add distraction input */}
          <div style={{ display: 'flex', gap: 10, paddingBottom: 24 }}>
            <input
              value={distractText}
              onChange={(e) => setDistractText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addDistraction();
              }}
              placeholder="what pulled you away? enter to log"
              aria-label="log a distraction"
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
              onClick={addDistraction}
              disabled={!distractText.trim()}
              style={{
                padding: '12px 22px',
                background: distractText.trim() ? INK : 'transparent',
                color: distractText.trim() ? BG : FAINT,
                border: `1px solid ${distractText.trim() ? INK : HAIRLINE_HI}`,
                fontFamily: "'DM Mono',monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: distractText.trim() ? 'pointer' : 'default',
                borderRadius: 2,
              }}
            >
              log
            </button>
          </div>

          {recentDistractions.length === 0 ? (
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontStyle: 'italic',
                fontSize: 'clamp(16px, 1.6vw, 18px)',
                color: MUTED,
                lineHeight: 1.4,
                paddingTop: 4,
              }}
            >
              nothing logged yet. when your focus slips, jot it here.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {recentDistractions.map((d) => (
                <div
                  key={d.id}
                  style={{
                    padding: '14px 0',
                    borderBottom: `1px solid ${HAIRLINE}`,
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 14,
                    alignItems: 'baseline',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "'Inter Tight',sans-serif",
                        fontSize: 16,
                        color: INK,
                        lineHeight: 1.5,
                      }}
                    >
                      {d.what}
                    </div>
                    <div
                      style={{
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 9,
                        letterSpacing: '0.22em',
                        color: FAINT,
                        textTransform: 'uppercase',
                        paddingTop: 6,
                      }}
                    >
                      {fmtLogWhen(d.ts)}
                    </div>
                  </div>
                  <button
                    onClick={() => removeDistraction(d.id)}
                    aria-label={`remove distraction: ${d.what}`}
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
              ))}
            </div>
          )}
        </section>

        {/* ── collaboration / hand-off notes ──────────────────────────── */}
        <section style={{ paddingBottom: 48, borderTop: `1px solid ${HAIRLINE}`, paddingTop: 32 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingBottom: 20,
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={LABEL_STYLE}>
              hand-off notes <span style={{ color: FAINT, margin: '0 10px' }}>·</span> what to pass on
            </div>
            <button
              type="button"
              onClick={() => setNoteOpen((o) => !o)}
              style={{
                padding: '8px 16px',
                background: noteOpen ? INK : 'transparent',
                color: noteOpen ? BG : INK,
                border: `1px solid ${noteOpen ? INK : HAIRLINE_HI}`,
                fontFamily: "'DM Mono',monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                borderRadius: 2,
              }}
            >
              {noteOpen ? 'close' : '+ add note'}
            </button>
          </div>

          {noteOpen && (
            <div
              style={{
                padding: 22,
                background: PAPER,
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 2,
                marginBottom: 24,
                display: 'grid',
                gap: 12,
              }}
            >
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="what does the next person need to know?"
                aria-label="hand-off note"
                rows={3}
                style={{
                  padding: '12px 14px',
                  background: BG,
                  border: `1px solid ${HAIRLINE}`,
                  color: INK,
                  borderRadius: 2,
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 15,
                  lineHeight: 1.5,
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
              <input
                value={noteTo}
                onChange={(e) => setNoteTo(e.target.value)}
                placeholder="for · name · optional"
                aria-label="hand-off recipient"
                style={{
                  padding: '10px 12px',
                  background: BG,
                  border: `1px solid ${HAIRLINE}`,
                  color: INK,
                  borderRadius: 2,
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={addNote}
                  disabled={!noteText.trim()}
                  style={{
                    padding: '10px 20px',
                    background: noteText.trim() ? INK : 'transparent',
                    color: noteText.trim() ? BG : FAINT,
                    border: `1px solid ${noteText.trim() ? INK : HAIRLINE_HI}`,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 10,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    cursor: noteText.trim() ? 'pointer' : 'default',
                    borderRadius: 2,
                  }}
                >
                  add
                </button>
                <button
                  type="button"
                  onClick={() => { setNoteOpen(false); setNoteText(''); setNoteTo(''); }}
                  style={{
                    padding: '10px 14px',
                    background: 'transparent',
                    color: FAINT,
                    border: 'none',
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 10,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  cancel
                </button>
              </div>
            </div>
          )}

          {sortedNotes.length === 0 ? (
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontStyle: 'italic',
                fontSize: 'clamp(16px, 1.6vw, 18px)',
                color: MUTED,
                lineHeight: 1.4,
                paddingTop: 4,
              }}
            >
              no notes yet. leave a thread for whoever picks this up next.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sortedNotes.map((n) => (
                <div
                  key={n.id}
                  style={{
                    padding: '16px 18px',
                    background: PAPER,
                    border: `1px solid ${HAIRLINE}`,
                    borderLeft: `2px solid ${WORK_ACCENT}`,
                    borderRadius: 2,
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 14,
                    alignItems: 'start',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "'Inter Tight',sans-serif",
                        fontSize: 15,
                        color: INK,
                        lineHeight: 1.55,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {n.text}
                    </div>
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
                      <span>{fmtLogWhen(n.ts)}</span>
                      {n.to && (
                        <>
                          <span>·</span>
                          <span style={{ color: MUTED }}>for {n.to}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeNote(n.id)}
                    aria-label={`remove hand-off note`}
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
              ))}
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
