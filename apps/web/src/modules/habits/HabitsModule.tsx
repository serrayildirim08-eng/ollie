import { useMemo, useState, useEffect, useRef } from 'react';
import type { Habit, HabitCompletion } from '@ollie/logic/habits';
import { useStoreSlice } from '../../store';
import { ModuleHelp } from '../../components/ModuleHelp';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoredHabit extends Habit {
  cueTime?: 'morning' | 'anytime' | 'evening';
  completions?: StoredCompletion[];
}

interface StoredCompletion extends HabitCompletion {
  ts: number;
}

interface PatternEntry {
  pattern: string;
  confidence: string;
  sample_n: number;
  copy: string;
  source?: { citation: string; url?: string };
}

// ─── Color tokens (paper/ink canon 2026-05-08) ───────────────────────────────

const BG       = '#F2EEE4';
const INK      = '#14130F';
const MUTED    = 'rgba(20,19,15,0.55)';
const V_MUTED  = 'rgba(20,19,15,0.30)';
const HAIRLINE = 'rgba(20,19,15,0.10)';
const HAIRLINE_SOFT = 'rgba(20,19,15,0.06)';
const ACCENT   = '#4F6E5B';

// ─── Default habits seed ─────────────────────────────────────────────────────

const DEFAULT_HABITS: StoredHabit[] = [
  { id: 'h_teeth', name: 'brush teeth',  cue: 'after waking',        cueTime: 'morning',  completions: [] },
  { id: 'h_water', name: 'drink water',  cue: 'before coffee',       cueTime: 'morning',  completions: [] },
  { id: 'h_vitd',  name: 'vitamin d',    cue: 'when coffee',         cueTime: 'morning',  completions: [] },
  { id: 'h_move',  name: 'move',         cue: 'before the sun sets', cueTime: 'anytime',  completions: [] },
  { id: 'h_meds',  name: 'evening meds', cue: 'after dinner',        cueTime: 'evening',  completions: [] },
  { id: 'h_wind',  name: 'wind down',    cue: 'after ten',           cueTime: 'evening',  completions: [] },
];

const SECTIONS = [
  { key: 'morning' as const, label: 'morning', short: 'MOR' },
  { key: 'anytime' as const, label: 'anytime', short: 'ANY' },
  { key: 'evening' as const, label: 'evening', short: 'EVE' },
];

// ─── HabitsWaterPrompt · Sprint 5 · F5 ────────────────────────────────────────
// Reads `habits.surface_water_habit` written by the cross-module router
// when `body:hydration_drop_detected` fires. Quiet, factual, dismissable.
// No streaks · no shame · no urgency.

interface WaterPromptEntry {
  id?: string;
  reason: string;
  ts: number;
}

function HabitsWaterPrompt() {
  const [prompts, setPrompts] = useStoreSlice<WaterPromptEntry[] | WaterPromptEntry | null>(
    'habits',
    'surface_water_habit',
    [],
  );
  // The cross-module router writes additively (push to array) BUT for
  // singletons might write the entry directly. Normalize both shapes.
  const list: WaterPromptEntry[] = Array.isArray(prompts)
    ? prompts
    : prompts && typeof prompts === 'object'
      ? [prompts as WaterPromptEntry]
      : [];
  const visible = list.filter((p) => p?.reason);
  if (visible.length === 0) return null;
  return (
    <section
      style={{
        marginBottom: 28,
        padding: '14px 18px',
        background: 'rgba(91,143,181,0.06)',
        borderLeft: `2px solid ${ACCENT}`,
        borderRadius: 2,
      }}
    >
      {visible.map((p, i) => (
        <div
          key={p.id ?? `wp-${i}`}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '4px 0' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontFamily: "'Inter Tight', 'DM Sans', sans-serif", fontSize: 14, color: INK }}>
              water — {p.reason}
            </span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: MUTED }}>
              from body · gentle reminder
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = visible.filter((_, j) => j !== i);
              setPrompts(next);
            }}
            aria-label="dismiss water prompt"
            style={{
              minHeight: 44,
              padding: '6px 12px',
              background: 'transparent',
              color: MUTED,
              border: `1px solid ${HAIRLINE}`,
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              borderRadius: 2,
            }}
          >
            dismiss
          </button>
        </div>
      ))}
    </section>
  );
}

// ─── HabitsNoticed ────────────────────────────────────────────────────────────

function HabitsNoticed({ habits }: { habits: StoredHabit[] }) {
  const [patterns] = useStoreSlice<PatternEntry[]>('habits', 'patterns', []);

  const list = useMemo(
    () => (Array.isArray(patterns) ? patterns : []),
    [patterns],
  );
  const habitCount = habits.length;

  if (list.length === 0) {
    return (
      <div style={{ marginTop: 24, paddingTop: 18, borderTop: `1px solid ${HAIRLINE}` }}>
        <div style={{
          fontFamily: "'DM Mono', monospace", fontSize: 9,
          letterSpacing: '0.3em', textTransform: 'uppercase',
          color: MUTED, paddingBottom: 14,
        }}>noticed</div>
        <div style={{
          fontFamily: "'DM Sans', sans-serif", fontSize: 13,
          color: MUTED, lineHeight: 1.55, fontStyle: 'italic', padding: '4px 0',
        }}>
          {habitCount === 0
            ? 'no habits yet. add one with a cue and patterns surface around 2 weeks of data.'
            : `patterns surface around 2 weeks of data. ${habitCount} habit${habitCount === 1 ? '' : 's'} tracked. observation, not pressure.`}
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 24, paddingTop: 18, borderTop: `1px solid ${HAIRLINE}` }}>
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 9,
        letterSpacing: '0.3em', textTransform: 'uppercase',
        color: MUTED, paddingBottom: 14,
      }}>noticed</div>
      {list.map((p) => (
        <div key={p.pattern} style={{
          padding: '14px 16px',
          background: 'rgba(79,110,91,0.08)',
          borderLeft: `2px solid ${ACCENT}`,
          borderRadius: 2, marginBottom: 10,
        }}>
          <div style={{
            fontFamily: "'DM Sans', sans-serif", fontSize: 14,
            color: INK, lineHeight: 1.55,
          }}>{p.copy}</div>
          <div style={{
            fontFamily: "'DM Mono', monospace", fontSize: 9,
            letterSpacing: '0.2em', color: MUTED,
            textTransform: 'uppercase', paddingTop: 8,
            display: 'flex', gap: 14, flexWrap: 'wrap',
          }}>
            <span>{p.confidence || 'medium'} confidence · {p.sample_n || 0} samples</span>
            {p.source?.url && (
              <a
                href={p.source.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: MUTED, textDecoration: 'underline', textUnderlineOffset: '2px' }}
              >
                {(p.source.citation || '').split(',')[0]}
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── HabitsModule ─────────────────────────────────────────────────────────────

export function HabitsModule({ onBack }: { onBack: () => void }) {
  // ── Store slices ──────────────────────────────────────────────────────────
  const [habits, setHabits] = useStoreSlice<StoredHabit[]>('shared', 'habits_v2', DEFAULT_HABITS);

  // Init seed once if store is empty
  const habitsArr: StoredHabit[] = useMemo(
    () => (Array.isArray(habits) && habits.length > 0 ? habits : DEFAULT_HABITS),
    [habits],
  );

  // ── Local UI state ────────────────────────────────────────────────────────
  const [addingOpen, setAddingOpen] = useState(false);
  const [draft, setDraft] = useState<{ name: string; cue: string; cueTime: 'morning' | 'anytime' | 'evening' }>({
    name: '', cue: '', cueTime: 'anytime',
  });
  const [cueError, setCueError] = useState<'missing-name' | 'missing-cue' | null>(null);
  const [recentCheck, setRecentCheck] = useState<{ id: string; ts: number } | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // ── Derived date values ───────────────────────────────────────────────────
  const now = useMemo(() => new Date(), []);
  const todayKey  = now.toDateString();
  const todayStart = useMemo(() => { const d = new Date(now); d.setHours(0,0,0,0); return d; }, [now]);
  const dayNum   = now.getDate();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
  const monthName = now.toLocaleDateString('en-US', { month: 'long' });
  const year     = now.getFullYear();
  const dayOfYear = Math.floor((now.getTime() - new Date(year, 0, 0).getTime()) / 86400000);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isCheckedToday(h: StoredHabit): boolean {
    const c = h.completions ?? [];
    const last = c[c.length - 1];
    return !!(last && new Date(last.ts).toDateString() === todayKey);
  }

  function lastCompletion(h: StoredHabit): StoredCompletion | undefined {
    const c = h.completions ?? [];
    return c[c.length - 1];
  }

  function daysSinceLast(h: StoredHabit): number | null {
    const last = lastCompletion(h);
    if (!last) return null;
    const d = new Date(last.ts); d.setHours(0,0,0,0);
    return Math.round((todayStart.getTime() - d.getTime()) / 86400000);
  }

  function lastLabel(h: StoredHabit): string {
    const d = daysSinceLast(h);
    if (d === null) return 'never';
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 7) return `${d} days ago`;
    return `${Math.floor(d / 7)} weeks ago`;
  }

  function fmtTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  function toggleCheck(id: string): void {
    const cutoff = Date.now() - 90 * 86400000;
    const updated = habitsArr.map((h) => {
      if (h.id !== id) return h;
      const c = [...(h.completions ?? [])].filter(
        (e) => typeof e.ts === 'number' && e.ts >= cutoff,
      );
      const last = c[c.length - 1];
      if (last && new Date(last.ts).toDateString() === todayKey) {
        c.pop();
        return { ...h, completions: c };
      }
      c.push({ ts: Date.now() });
      return { ...h, completions: c };
    });
    setHabits(updated);
    const checked = updated.find((x) => x.id === id);
    if (checked && isCheckedToday(checked)) {
      setRecentCheck({ id, ts: Date.now() });
    } else {
      setRecentCheck(null);
    }
  }

  function removeHabit(id: string): void {
    setHabits(habitsArr.filter((h) => h.id !== id));
  }

  function addHabit(): void {
    const name = draft.name.trim();
    const cue  = draft.cue.trim();
    if (!name) { setCueError('missing-name'); return; }
    if (!cue)  { setCueError('missing-cue');  return; }
    setCueError(null);
    const h: StoredHabit = {
      id: 'h_' + Date.now().toString(36),
      name,
      cue,
      cueTime: draft.cueTime,
      completions: [],
    };
    setHabits([...habitsArr, h]);
    setDraft({ name: '', cue: '', cueTime: 'anytime' });
    setAddingOpen(false);
  }

  // ── Focus add input when opened ───────────────────────────────────────────
  useEffect(() => {
    if (addingOpen) nameInputRef.current?.focus();
  }, [addingOpen]);

  // ── Ordered list (morning → anytime → evening) ────────────────────────────
  const ordered = useMemo(() => {
    const out: Array<{ habit: StoredHabit; section: typeof SECTIONS[number]; firstOfSection: boolean }> = [];
    SECTIONS.forEach((s) => {
      const list = habitsArr.filter((h) => (h.cueTime ?? 'anytime') === s.key);
      list.forEach((h, i) => out.push({ habit: h, section: s, firstOfSection: i === 0 }));
    });
    return out;
  }, [habitsArr]);

  // `isCheckedToday` is a render-scoped fn whose only inputs are its `h`
  // argument and `todayKey`; both are already covered by the deps below.
  // Adding the fn itself would just break memoization (new ref each render)
  // without changing the result.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doneToday   = useMemo(() => habitsArr.filter((h) => isCheckedToday(h)).length, [habitsArr, todayKey]);
  const totalCount  = habitsArr.length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: '100vw', minHeight: '100vh', overflowY: 'auto', overflowX: 'hidden',
      background: BG, color: INK,
      fontFamily: "'Inter Tight', sans-serif",
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {/* Phone-stack: the desktop two-column hero/ledger collapses to a
          single vertical column below 760px so it fits an iPhone. The
          masthead gets left clearance for the fixed back button, and the
          dense 3-column habit rows reflow so cue/meta drop below the name. */}
      <style>{`
        @media (max-width: 760px) {
          .habits-main { display: flex !important; flex-direction: column !important; }
          .habits-divider { width: 100% !important; height: 1px !important; align-self: stretch !important; }
          .habits-hero { padding: 32px 24px 28px 24px !important; }
          .habits-ledger-pane { padding: 28px 24px 28px 24px !important; }
          .habits-masthead {
            padding-top: 52px !important;
          }
          .habit-row {
            grid-template-columns: 32px 1fr !important;
            row-gap: 10px !important;
            column-gap: 14px !important;
          }
          .habit-row > .habit-meta {
            grid-column: 1 / -1 !important;
            align-items: flex-start !important;
            min-width: 0 !important;
          }
          .habit-row .habit-name {
            font-size: 26px !important;
          }
          /* long names step down a tier on phones so they wrap to fewer
             lines and never crowd the row (P4 cosmetic, iter 3) */
          .habit-row .habit-name-long {
            font-size: 20px !important;
            letter-spacing: -0.01em !important;
          }
        }
      `}</style>
      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        aria-label="back to dashboard"
        style={{
          position: 'fixed', top: 'calc(20px + env(safe-area-inset-top))', left: 24, zIndex: 40,
          background: 'none', border: 'none', padding: '6px 8px',
          fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
          letterSpacing: '0.26em', color: INK, opacity: 0.7,
          cursor: 'pointer', textTransform: 'uppercase',
        }}
      >
        ← back
      </button>

      {/* Help */}
      <div style={{ position: 'fixed', top: 'calc(20px + env(safe-area-inset-top))', right: 24, zIndex: 40 }}>
        <ModuleHelp moduleId="habits" />
      </div>

      {/* Masthead */}
      <header className="habits-masthead" style={{
        flexShrink: 0,
        padding: '20px 24px 16px 24px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        flexWrap: 'wrap', gap: 12,
        borderBottom: `1px solid ${HAIRLINE}`,
        position: 'relative', zIndex: 2,
      }}>
        <div style={{
          display: 'flex', gap: 14, alignItems: 'baseline',
          fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
          letterSpacing: '0.32em', color: INK, textTransform: 'uppercase',
        }}>
          <span>ollie</span>
          <span style={{ color: MUTED }}>habits</span>
          <span style={{ color: MUTED }}>volume 01</span>
        </div>
        <div style={{
          display: 'flex', gap: 14, alignItems: 'baseline',
          fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
          letterSpacing: '0.32em', color: MUTED, textTransform: 'uppercase',
        }}>
          <span>day {dayOfYear}</span>
          <span>—</span>
          <span style={{ color: INK }}>
            {String(dayNum).padStart(2, '0')}.{String(now.getMonth() + 1).padStart(2, '0')}.{String(year).slice(2)}
          </span>
        </div>
      </header>

      {/* Main: 40% hero / 60% ledger — stacks on phones (see <style> above) */}
      <main className="habits-main" style={{
        flex: 1, minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(360px, 38%) 1px minmax(0, 1fr)',
        position: 'relative', zIndex: 1,
      }}>
        {/* Left: hero */}
        <section className="habits-hero" style={{
          padding: '46px 40px 40px 90px',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          minHeight: 0,
        }}>
          <div>
            <div style={{
              fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
              letterSpacing: '0.36em', color: MUTED,
              textTransform: 'uppercase', marginBottom: 18,
            }}>— the day</div>

            <div style={{
              fontFamily: "'Inter Tight', sans-serif", fontWeight: 600,
              fontSize: 'clamp(120px, 40vw, 220px)', color: INK, letterSpacing: '-0.06em',
              lineHeight: 0.82, fontVariantNumeric: 'tabular-nums',
            }}>{String(dayNum).padStart(2, '0')}</div>

            <div style={{
              fontFamily: "'Inter Tight', sans-serif", fontWeight: 500,
              fontSize: 28, color: INK, letterSpacing: '-0.01em',
              textTransform: 'uppercase', marginTop: 16,
            }}>{dayOfWeek}</div>
            <div style={{
              fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 500,
              letterSpacing: '0.36em', color: MUTED,
              textTransform: 'uppercase', marginTop: 10,
            }}>{monthName} · {year}</div>
          </div>

          {/* Bottom count */}
          <div>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 14,
              borderTop: `1px solid ${HAIRLINE}`, paddingTop: 18,
            }}>
              <div style={{
                fontFamily: "'Inter Tight', sans-serif", fontWeight: 600,
                fontSize: 68, color: INK, letterSpacing: '-0.04em',
                lineHeight: 0.9, fontVariantNumeric: 'tabular-nums',
              }}>{String(doneToday).padStart(2, '0')}</div>
              <div style={{
                fontFamily: "'Inter Tight', sans-serif", fontWeight: 500,
                fontSize: 28, color: V_MUTED, letterSpacing: '-0.02em', lineHeight: 0.9,
              }}>/ {String(totalCount).padStart(2, '0')}</div>
              <div style={{ flex: 1 }} />
              <div style={{
                fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
                letterSpacing: '0.32em', color: MUTED, textTransform: 'uppercase',
              }}>marked</div>
            </div>
            <div style={{
              fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
              letterSpacing: '0.28em', color: V_MUTED,
              textTransform: 'uppercase', marginTop: 14,
            }}>no streaks · no shame · just today</div>
          </div>
        </section>

        {/* Divider */}
        <div className="habits-divider" style={{ width: 1, background: HAIRLINE, alignSelf: 'stretch' }} />

        {/* Right: ledger */}
        <section className="habits-ledger-pane" style={{
          padding: '44px 56px 28px 56px',
          display: 'flex', flexDirection: 'column',
          minHeight: 0, position: 'relative',
        }}>
          <div style={{
            fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
            letterSpacing: '0.36em', color: MUTED,
            textTransform: 'uppercase', marginBottom: 14,
          }}>— ledger</div>

          {/* Scrollable habit list */}
          <div
            className="habits-ledger"
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}
          >
            {ordered.length === 0 ? (
              <div style={{ padding: '80px 0', textAlign: 'center' }}>
                <div style={{
                  fontFamily: "'Inter Tight', sans-serif", fontWeight: 500,
                  fontSize: 36, color: MUTED, textTransform: 'uppercase',
                  letterSpacing: '-0.01em', marginBottom: 14,
                }}>no habits.</div>
                <div style={{
                  fontFamily: "'DM Sans', sans-serif", fontStyle: 'italic',
                  fontSize: 16, color: MUTED, lineHeight: 1.5,
                  maxWidth: 380, margin: '0 auto',
                }}>add 1-3 habits to start. enter one below.</div>
              </div>
            ) : (
              ordered.map(({ habit: h, section: s, firstOfSection }, idx) => {
                const checked = isCheckedToday(h);
                const lc = lastCompletion(h);
                const ls = lastLabel(h);
                const justChecked =
                  recentCheck !== null &&
                  recentCheck.id === h.id &&
                  Date.now() - recentCheck.ts < 4000;

                return (
                  <div key={h.id}>
                    {firstOfSection && idx > 0 && (
                      <div style={{ height: 1, background: HAIRLINE, margin: '12px 0' }} />
                    )}
                    <div
                      className="habit-row"
                      role="button"
                      tabIndex={0}
                      aria-label={`toggle habit ${h.name ?? ''}`}
                      onClick={() => toggleCheck(h.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleCheck(h.id);
                        }
                      }}
                      style={{
                        padding: '18px 0',
                        borderBottom: `1px solid ${HAIRLINE_SOFT}`,
                        cursor: 'pointer', position: 'relative',
                        display: 'grid', gridTemplateColumns: '48px 1fr auto',
                        columnGap: 24, alignItems: 'center',
                      }}
                    >
                      {/* ordinal */}
                      <div style={{
                        fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 500,
                        color: V_MUTED, letterSpacing: '0.08em',
                        fontVariantNumeric: 'tabular-nums', textAlign: 'left',
                      }}>{String(idx + 1).padStart(2, '0')}</div>

                      {/* name + strikethrough — minWidth:0 lets this grid cell
                          shrink below its content so long names wrap instead of
                          overflowing the 402px phone row (P4 cosmetic, iter 3) */}
                      <div style={{ position: 'relative', justifySelf: 'start', minWidth: 0, maxWidth: '100%' }}>
                        <div
                          className={`habit-name${(h.name ?? '').length > 16 ? ' habit-name-long' : ''}`}
                          style={{
                            fontFamily: "'Inter Tight', sans-serif", fontWeight: 500,
                            fontSize: 34, color: checked ? MUTED : INK,
                            letterSpacing: '-0.02em', lineHeight: 1.05,
                            textTransform: 'uppercase',
                            overflowWrap: 'anywhere', wordBreak: 'break-word',
                            transition: 'color 400ms ease',
                          }}
                        >{h.name ?? ''}</div>
                        <div
                          aria-hidden="true"
                          style={{
                            position: 'absolute', left: -4, top: '54%',
                            height: 3, background: ACCENT,
                            width: checked ? 'calc(100% + 8px)' : '0%',
                            transition: 'width 440ms cubic-bezier(0.77, 0, 0.175, 1)',
                          }}
                        />
                      </div>

                      {/* cue + meta */}
                      <div className="habit-meta" style={{
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'flex-end', gap: 6, minWidth: 180,
                      }}>
                        <div style={{
                          fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
                          letterSpacing: '0.26em', color: checked ? V_MUTED : MUTED,
                          textTransform: 'uppercase',
                        }}>
                          {h.cue ? `when · ${h.cue}` : s.label}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {checked ? (
                            <span style={{
                              fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 600,
                              color: ACCENT, letterSpacing: '0.24em', textTransform: 'uppercase',
                              animation: justChecked ? 'habitsAckIn 380ms ease-out 180ms both' : undefined,
                            }}>
                              {lc ? `done · ${fmtTime(lc.ts)}` : 'done'}
                            </span>
                          ) : (
                            <span className="habit-last" style={{
                              fontFamily: "'DM Mono', monospace", fontSize: 9, fontWeight: 500,
                              color: V_MUTED, letterSpacing: '0.22em',
                              textTransform: 'uppercase',
                              opacity: 0, transition: 'opacity 200ms ease',
                            }}>
                              last · {ls}
                            </span>
                          )}
                          <span style={{
                            fontFamily: "'DM Mono', monospace", fontSize: 9, fontWeight: 500,
                            color: V_MUTED, letterSpacing: '0.24em', textTransform: 'uppercase',
                            padding: '3px 6px', border: `1px solid ${HAIRLINE}`, borderRadius: 2,
                          }}>{s.short}</span>
                          <button
                            type="button"
                            className="habit-forget"
                            onClick={(e) => { e.stopPropagation(); removeHabit(h.id); }}
                            title="remove"
                            aria-label={`remove habit ${h.name ?? ''}`}
                            style={{
                              background: 'none', border: 'none', padding: '10px 8px',
                              minHeight: 44,
                              fontFamily: "'Inter Tight', sans-serif", fontSize: 16,
                              color: V_MUTED, cursor: 'pointer',
                              opacity: 0, transition: 'opacity 180ms ease',
                            }}
                          >×</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {/* Inline add form */}
            {addingOpen && (
              <div style={{ marginTop: 20, padding: '20px 0', borderTop: `1px solid ${HAIRLINE}` }}>
                <input
                  ref={nameInputRef}
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && addHabit()}
                  placeholder="new habit"
                  aria-label="habit name"
                  style={{
                    width: '100%', background: 'transparent',
                    border: 'none', outline: 'none', padding: '6px 0',
                    fontFamily: "'Inter Tight', sans-serif", fontWeight: 500,
                    fontSize: 32, color: INK, letterSpacing: '-0.02em',
                    textTransform: 'uppercase',
                  }}
                />
                <input
                  value={draft.cue}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, cue: e.target.value }));
                    if (cueError === 'missing-cue') setCueError(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && addHabit()}
                  placeholder="when? e.g. after coffee — required"
                  aria-label="habit cue"
                  style={{
                    width: '100%', background: 'transparent',
                    border: 'none', outline: 'none', padding: '6px 0', marginTop: 8,
                    borderBottom: `1px solid ${cueError === 'missing-cue' ? '#A03E2A' : HAIRLINE_SOFT}`,
                    fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 500,
                    color: MUTED, letterSpacing: '0.18em', textTransform: 'uppercase',
                  }}
                />
                {cueError === 'missing-cue' && (
                  <div role="alert" style={{
                    marginTop: 6, fontSize: 11, fontWeight: 500, color: '#A03E2A',
                    fontFamily: "'DM Mono', monospace", letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                  }}>
                    cue required. a habit without a cue is wishful thinking — wood &amp; neal 2007.
                  </div>
                )}
                {cueError === 'missing-name' && (
                  <div role="alert" style={{
                    marginTop: 6, fontSize: 11, fontWeight: 500, color: '#A03E2A',
                    fontFamily: "'DM Mono', monospace", letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                  }}>
                    name a habit before saving.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, marginTop: 18, alignItems: 'center' }}>
                  {SECTIONS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, cueTime: s.key }))}
                      style={{
                        background: draft.cueTime === s.key ? INK : 'transparent',
                        border: `1px solid ${draft.cueTime === s.key ? INK : HAIRLINE}`,
                        padding: '8px 14px',
                        fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 600,
                        letterSpacing: '0.28em',
                        color: draft.cueTime === s.key ? BG : INK,
                        textTransform: 'uppercase', cursor: 'pointer',
                      }}
                    >{s.label}</button>
                  ))}
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={addHabit}
                    style={{
                      background: ACCENT, border: 'none',
                      padding: '10px 22px',
                      fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 600,
                      letterSpacing: '0.28em', color: INK,
                      textTransform: 'uppercase', cursor: 'pointer',
                    }}
                  >set</button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft({ name: '', cue: '', cueTime: 'anytime' });
                      setCueError(null);
                      setAddingOpen(false);
                    }}
                    style={{
                      background: 'none', border: 'none',
                      fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
                      letterSpacing: '0.28em', color: MUTED,
                      textTransform: 'uppercase', cursor: 'pointer', padding: '10px 8px',
                    }}
                  >cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {!addingOpen && (
            <div style={{
              flexShrink: 0, marginTop: 18,
              paddingTop: 14, borderTop: `1px solid ${HAIRLINE}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{
                fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
                letterSpacing: '0.28em', color: MUTED, textTransform: 'uppercase',
              }}>— {totalCount} rites on file</div>
              <button
                type="button"
                onClick={() => setAddingOpen(true)}
                style={{
                  background: 'none', border: 'none', padding: '6px 0',
                  fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: 600,
                  letterSpacing: '0.32em', color: ACCENT,
                  textTransform: 'uppercase', cursor: 'pointer',
                }}
              >+ new entry</button>
            </div>
          )}

          <HabitsWaterPrompt />

          <HabitsNoticed habits={habitsArr} />
        </section>
      </main>

      <style>{`
        @keyframes habitsAckIn {
          from { opacity: 0; transform: translateY(-2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .habit-row:hover { background: rgba(241,235,217,0.03); }
        .habit-row:hover .habit-last { opacity: 1 !important; }
        .habit-row:hover .habit-forget { opacity: 1 !important; }
        .habits-ledger::-webkit-scrollbar { width: 5px; }
        .habits-ledger::-webkit-scrollbar-thumb { background: rgba(20,19,15,0.10); border-radius: 0; }
        .habits-ledger::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}
