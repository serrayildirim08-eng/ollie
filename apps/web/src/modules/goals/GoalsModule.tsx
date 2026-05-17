import React, { useMemo, useState, useEffect } from 'react';
import {
  detectLowMood,
  detectObstacleEcho,
  detectPreMortemEcho,
  retrieveUlyssesContract,
  detectActiveCap,
  detectResearchAsProgress,
  detectIdentityDrift,
  detectSunkCostFlag,
  classifyPacing,
} from '@ollie/logic/goals';
import { mkId } from '../../lib/mkId';
import type {
  Goal,
  GoalSession,
  GoalReview,
  DumpEntry,
  GoalCategory,
  Milestone,
  LowMoodSignal,
  UlyssesContractSignal,
  ActiveCapSignal,
  ResearchAsProgressSignal,
  IdentityDriftSignal,
  SunkCostSignal,
  PacingClassifiedSignal,
} from '@ollie/logic/goals';
import { emit as emitEvent } from '@ollie/events';
import { useStoreSlice } from '../../store';
import { ModuleHelp } from '../../components/ModuleHelp';

// ─── AI step-breakdown worker URL ───────────────────────────────────────────
const AI_PROXY_URL =
  ((import.meta as unknown as { env?: { VITE_AI_PROXY_URL?: string; VITE_AI_WORKER_URL?: string } }).env?.VITE_AI_PROXY_URL ??
    (import.meta as unknown as { env?: { VITE_AI_WORKER_URL?: string } }).env?.VITE_AI_WORKER_URL ??
    '');

// ─── categories ─────────────────────────────────────────────────────────────
const CATEGORIES: ReadonlyArray<GoalCategory> = [
  'career',
  'relationship',
  'health',
  'finance',
  'learning',
  'creative',
];

type CategoryFilter = GoalCategory | 'all';

// ─── palette (paper/ink canonical) ───────────────────────────────────────────

const BG = '#F2EEE4';
const PAPER = '#F8F4EA';
const INK = '#14130F';
const MUTED = '#4B4740';
const FAINT = '#7C7770';
const HAIRLINE = 'rgba(20,19,15,0.10)';
const HAIRLINE_HI = 'rgba(20,19,15,0.28)';
const ACCENT = '#4F6E5B';

// ─── local types ──────────────────────────────────────────────────────────────

interface StoredGoal extends Omit<Goal, 'obstacle' | 'premortem' | 'ulysses_contract' | 'role' | 'target_date_ts'> {
  title?: string;
  why?: string;
  target_date?: string | null;
  target_date_ts?: number | null;
  obstacle?: string | null;
  premortem?: string | null;
  ulysses_contract?: string | null;
  role?: string | null;
  status?: string;
  status_at?: number;
  paused_until?: number;
  created_at?: number;
  action?: string;
  // audit 2026-05-14 — frontend-pod scaffold
  category?: GoalCategory;
  progress?: number;
  milestones?: Milestone[];
  steps?: string[];
  converted_to_habit_at?: number;
}

interface AnyGoalPattern {
  pattern: string;
  copy: string;
  goal_id?: string;
  source_excerpt?: string;
  excerpt?: string;
  pacing?: string;
  days_since?: number;
  weeks_stuck?: number;
  anchor_type?: string;
  missing?: string;
  reason?: string;
  depth?: number;
  mode?: string;
  conflicts?: Array<{ goal_a_id: string; goal_b_id: string; tag_a: string; tag_b: string }>;
  has_hypothesis?: boolean;
  source?: { citation: string; url?: string };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function sanitize(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    const map: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c] ?? c;
  });
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase();
  } catch {
    return iso;
  }
}

function daysUntil(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diff = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return `${Math.abs(diff)} days ago`;
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return `in ${diff} days`;
}

// ─── label style const ───────────────────────────────────────────────────────

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: "'DM Mono',monospace",
  fontSize: 10,
  letterSpacing: '0.26em',
  color: MUTED,
  textTransform: 'uppercase',
  fontWeight: 500,
};

// ─── ProgressBlock ────────────────────────────────────────────────────────────
// SVG progress bar + optional manual control when no milestones exist.

interface ProgressBlockProps {
  goal: StoredGoal;
  onManualSet: (pct: number) => void;
}

function ProgressBlock({ goal, onManualSet }: ProgressBlockProps) {
  const hasMilestones = (goal.milestones ?? []).length > 0;
  const pct = typeof goal.progress === 'number' ? goal.progress : 0;
  const show = hasMilestones || typeof goal.progress === 'number';
  if (!show && !hasMilestones) {
    // surface a tiny inline control so user can start tracking
    return (
      <div style={{ paddingTop: 14 }}>
        <button
          type="button"
          onClick={() => onManualSet(0)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: FAINT,
            fontFamily: "'DM Mono',monospace",
            fontSize: 9,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          + track progress
        </button>
      </div>
    );
  }
  return (
    <div style={{ paddingTop: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingBottom: 6,
          fontFamily: "'DM Mono',monospace",
          fontSize: 9,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: FAINT,
        }}
      >
        <span>progress</span>
        <span style={{ color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
      </div>
      <svg
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="goal progress"
        viewBox="0 0 200 4"
        preserveAspectRatio="none"
        style={{ width: '100%', height: 4, display: 'block' }}
      >
        <rect x="0" y="0" width="200" height="4" fill="rgba(255,255,255,0.6)" />
        <rect x="0" y="0" width="200" height="4" fill={HAIRLINE} />
        <rect x="0" y="0" width={Math.max(0, Math.min(200, (pct / 100) * 200))} height="4" fill={ACCENT} />
      </svg>
      {!hasMilestones && (
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct}
          onChange={(e) => onManualSet(Number(e.target.value))}
          aria-label="set goal progress manually"
          style={{
            width: '100%',
            marginTop: 6,
            accentColor: ACCENT,
            cursor: 'pointer',
          }}
        />
      )}
    </div>
  );
}

// ─── MilestoneBlock ───────────────────────────────────────────────────────────

interface MilestoneBlockProps {
  goal: StoredGoal;
  draft: { title: string; target: string };
  onDraftChange: (d: { title: string; target: string }) => void;
  onAdd: () => void;
  onToggle: (msId: string) => void;
  onRemove: (msId: string) => void;
}

function MilestoneBlock({
  goal,
  draft,
  onDraftChange,
  onAdd,
  onToggle,
  onRemove,
}: MilestoneBlockProps) {
  const list = goal.milestones ?? [];
  return (
    <div style={{ paddingTop: 18 }}>
      <div
        style={{
          fontFamily: "'DM Mono',monospace",
          fontSize: 9,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color: FAINT,
          paddingBottom: 8,
        }}
      >
        milestones
      </div>

      {list.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10 }}>
          {list.map((m) => {
            const done = !!m.completed_at;
            return (
              <div
                key={m.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderBottom: `1px solid ${HAIRLINE}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => onToggle(m.id)}
                  aria-pressed={done}
                  aria-label={done ? 'mark milestone open' : 'mark milestone done'}
                  style={{
                    width: 18,
                    height: 18,
                    padding: 0,
                    background: 'transparent',
                    border: `1.5px solid ${done ? ACCENT : HAIRLINE_HI}`,
                    borderRadius: 3,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {done && (
                    <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
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
                <span
                  style={{
                    fontFamily: "'Inter Tight',sans-serif",
                    fontSize: 14,
                    color: done ? MUTED : INK,
                    textDecoration: done ? 'line-through' : 'none',
                  }}
                >
                  {m.title}
                </span>
                <span
                  style={{
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 9,
                    letterSpacing: '0.18em',
                    color: FAINT,
                    textTransform: 'lowercase',
                  }}
                >
                  {m.target_date
                    ? new Date(m.target_date).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      }).toLowerCase()
                    : ''}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(m.id)}
                  aria-label={`remove ${m.title}`}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: FAINT,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 9,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={draft.title}
          onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAdd();
          }}
          placeholder="+ add milestone"
          aria-label="milestone title"
          style={{
            flex: '1 1 180px',
            padding: '8px 10px',
            background: 'transparent',
            border: `1px solid ${HAIRLINE}`,
            color: INK,
            borderRadius: 2,
            fontFamily: "'Inter Tight',sans-serif",
            fontSize: 13,
            outline: 'none',
          }}
        />
        <input
          type="date"
          value={draft.target}
          onChange={(e) => onDraftChange({ ...draft, target: e.target.value })}
          aria-label="milestone target date"
          style={{
            padding: '8px 10px',
            background: 'transparent',
            border: `1px solid ${HAIRLINE}`,
            color: INK,
            borderRadius: 2,
            fontFamily: "'DM Mono',monospace",
            fontSize: 12,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={!draft.title.trim()}
          style={{
            padding: '8px 14px',
            background: draft.title.trim() ? INK : 'transparent',
            color: draft.title.trim() ? BG : FAINT,
            border: `1px solid ${draft.title.trim() ? INK : HAIRLINE_HI}`,
            fontFamily: "'DM Mono',monospace",
            fontSize: 9,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            cursor: draft.title.trim() ? 'pointer' : 'default',
            borderRadius: 2,
          }}
        >
          add
        </button>
      </div>
    </div>
  );
}

// ─── StepBlock — AI step breakdown ────────────────────────────────────────────

interface StepBlockProps {
  goal: StoredGoal;
  busy: boolean;
  error: string | undefined;
  onAsk: () => void;
  onToggle: (idx: number) => void;
}

function StepBlock({ goal, busy, error, onAsk, onToggle }: StepBlockProps) {
  const steps = goal.steps ?? [];
  const done = (goal as StoredGoal & { steps_done?: boolean[] }).steps_done ?? [];
  return (
    <div style={{ paddingTop: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          paddingBottom: 10,
        }}
      >
        <button
          type="button"
          onClick={onAsk}
          disabled={busy}
          style={{
            padding: '8px 14px',
            minHeight: 36,
            background: 'transparent',
            color: busy ? FAINT : INK,
            border: `1px solid ${HAIRLINE_HI}`,
            borderRadius: 2,
            cursor: busy ? 'wait' : 'pointer',
            fontFamily: "'DM Mono',monospace",
            fontSize: 9,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
          }}
        >
          {busy ? 'asking…' : steps.length > 0 ? 'ask again' : 'ask claude for steps'}
        </button>
        {error && (
          <span
            style={{
              fontFamily: "'Inter Tight',sans-serif",
              fontSize: 12,
              fontStyle: 'italic',
              color: MUTED,
            }}
          >
            {error}
          </span>
        )}
      </div>

      {steps.length > 0 && (
        <ol
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {steps.map((s, i) => {
            const isDone = !!done[i];
            return (
              <li
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: 10,
                  alignItems: 'center',
                  padding: '6px 0',
                  borderBottom: `1px solid ${HAIRLINE}`,
                }}
              >
                <button
                  type="button"
                  onClick={() => onToggle(i)}
                  aria-pressed={isDone}
                  aria-label={isDone ? 'mark step open' : 'mark step done'}
                  style={{
                    width: 18,
                    height: 18,
                    padding: 0,
                    background: 'transparent',
                    border: `1.5px solid ${isDone ? ACCENT : HAIRLINE_HI}`,
                    borderRadius: 3,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isDone && (
                    <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
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
                <span
                  style={{
                    fontFamily: "'Inter Tight',sans-serif",
                    fontSize: 14,
                    color: isDone ? MUTED : INK,
                    textDecoration: isDone ? 'line-through' : 'none',
                  }}
                >
                  {s}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ─── GoalsNoticed — patterns surface from store ───────────────────────────────

function GoalsNoticed() {
  const [patterns] = useStoreSlice<AnyGoalPattern[]>('goals', 'patterns', []);
  const [dismissed, setDismissed] = useStoreSlice<Record<string, number>>(
    'goals',
    'patterns_dismissed',
    {},
  );

  const list = Array.isArray(patterns) ? patterns : [];

  function idOf(p: AnyGoalPattern): string {
    if (!p?.pattern) return '?';
    if (p.pattern === 'pacing-breach' && p.goal_id) return `${p.pattern}:${p.goal_id}`;
    if (p.pattern === 'missing-anchor-pair' && p.goal_id)
      return `${p.pattern}:${p.goal_id}:${p.missing ?? ''}`;
    if (p.pattern === 'floating-goal' && p.goal_id)
      return `${p.pattern}:${p.goal_id}:${p.reason ?? ''}`;
    if (p.pattern === 'missing-construal' && p.goal_id)
      return `${p.pattern}:${p.goal_id}:${p.missing ?? ''}`;
    if (p.pattern === 'anti-goal-opportunity' && p.goal_id)
      return `${p.pattern}:${p.goal_id}:${p.mode ?? ''}`;
    if (p.pattern === 'experiment-candidate' && p.goal_id) return `${p.pattern}:${p.goal_id}`;
    if (p.pattern === 'anti-goal-in-dump' && p.excerpt)
      return `${p.pattern}:${p.excerpt.slice(0, 24)}`;
    if (p.pattern === 'goal-interference') return p.pattern;
    if (p.pattern === 'contagion') return p.pattern;
    return p.pattern + (p.goal_id ? `:${p.goal_id}` : '');
  }

  function dismiss(id: string) {
    setDismissed({ ...(dismissed ?? {}), [id]: Date.now() });
  }

  const visible = list.filter((p) => p?.copy && !(dismissed?.[idOf(p)]));

  function metaFor(p: AnyGoalPattern): string[] {
    const bits: string[] = [];
    if (p.pacing) bits.push(`${p.pacing} pacing`);
    if (typeof p.days_since === 'number') bits.push(`${p.days_since} days dormant`);
    if (typeof p.weeks_stuck === 'number') bits.push(`${p.weeks_stuck} weeks stuck`);
    if (p.anchor_type) bits.push(`${p.anchor_type} anchor`);
    if (p.missing) bits.push(`missing ${p.missing}`);
    if (p.reason) bits.push(p.reason);
    if (typeof p.depth === 'number') bits.push(`depth ${p.depth}`);
    if (p.mode) bits.push(p.mode);
    if (Array.isArray(p.conflicts))
      bits.push(`${p.conflicts.length} conflict${p.conflicts.length === 1 ? '' : 's'}`);
    if (p.has_hypothesis === true) bits.push('hypothesis set');
    if (p.has_hypothesis === false) bits.push('no hypothesis yet');
    return bits;
  }

  return (
    <section
      style={{ marginTop: 64, paddingTop: 28, borderTop: `1px solid ${HAIRLINE}` }}
    >
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
          nothing to mirror right now. add a goal, sit with one, see what surfaces.
        </div>
      ) : (
        visible.map((p, i) => {
          const id = idOf(p);
          const meta = metaFor(p);
          return (
            <div
              key={`${id}:${i}`}
              style={{
                padding: '18px 20px',
                background: PAPER,
                borderLeft: `2px solid ${ACCENT}`,
                borderRadius: 2,
                marginBottom: 12,
                position: 'relative',
              }}
            >
              <button
                type="button"
                onClick={() => dismiss(id)}
                aria-label="dismiss"
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
                  padding: '10px 8px',
                  minHeight: 44,
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
                {(p.pattern ?? '').replace(/-/g, ' ')}
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
                {p.copy}
              </div>
              {p.source_excerpt && (
                <div
                  style={{
                    fontFamily: "'Inter Tight',sans-serif",
                    fontSize: 13,
                    color: MUTED,
                    lineHeight: 1.5,
                    paddingTop: 8,
                    fontStyle: 'italic',
                  }}
                >
                  &ldquo;{p.source_excerpt}&rdquo;
                </div>
              )}
              {p.excerpt && (
                <div
                  style={{
                    fontFamily: "'Inter Tight',sans-serif",
                    fontSize: 13,
                    color: MUTED,
                    lineHeight: 1.5,
                    paddingTop: 8,
                    fontStyle: 'italic',
                  }}
                >
                  &ldquo;{p.excerpt}&rdquo;
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
              {p.source?.citation && (
                <div
                  style={{
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 9,
                    letterSpacing: '0.18em',
                    color: FAINT,
                    paddingTop: 8,
                    lineHeight: 1.5,
                  }}
                >
                  {p.source.url ? (
                    <a
                      href={p.source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: FAINT,
                        textDecoration: 'none',
                        borderBottom: `1px dotted ${FAINT}`,
                      }}
                    >
                      {p.source.citation}
                    </a>
                  ) : (
                    p.source.citation
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

// ─── AchievementGallery ───────────────────────────────────────────────────────
// A quiet place to look back at finished goals. ADHD anti-shame mission:
// celebration, but un-amplified — no streaks, no "great job!", no exclamation.
// Editorial restraint. Just: here is what you did, and when.

interface AchievementGalleryProps {
  goals: StoredGoal[];
}

function AchievementGallery({ goals }: AchievementGalleryProps) {
  // Completed goals only, most-recently finished first.
  const finished = useMemo(() => {
    return (goals ?? [])
      .filter((g) => g && g.status === 'done' && g.title)
      .sort((a, b) => (b.status_at ?? b.created_at ?? 0) - (a.status_at ?? a.created_at ?? 0));
  }, [goals]);

  if (finished.length === 0) return null;

  return (
    <section style={{ marginTop: 72, paddingTop: 36, borderTop: `1px solid ${HAIRLINE}` }}>
      <div style={{ ...LABEL_STYLE, paddingBottom: 6 }}>— what you finished</div>
      <div
        style={{
          fontFamily: "'DM Serif Display',serif",
          fontStyle: 'italic',
          fontSize: 'clamp(16px, 1.6vw, 19px)',
          color: MUTED,
          lineHeight: 1.4,
          paddingBottom: 28,
          maxWidth: 540,
        }}
      >
        {finished.length === 1
          ? 'one goal carried all the way through. worth a look back.'
          : `${finished.length} goals carried all the way through. worth a look back.`}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {finished.map((g) => {
          const when = fmtDate(
            g.status_at
              ? new Date(g.status_at).toISOString()
              : g.created_at
                ? new Date(g.created_at).toISOString()
                : null,
          );
          return (
            <div
              key={g.id}
              style={{
                padding: '20px 22px',
                background: PAPER,
                border: `1px solid ${HAIRLINE}`,
                borderLeft: `2px solid ${ACCENT}`,
                borderRadius: 2,
              }}
            >
              <div
                style={{
                  fontFamily: "'DM Serif Display',serif",
                  fontSize: 'clamp(19px, 2vw, 23px)',
                  color: INK,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.25,
                }}
              >
                {g.title}
              </div>
              {g.why && (
                <div
                  style={{
                    fontFamily: "'Inter Tight',sans-serif",
                    fontStyle: 'italic',
                    fontSize: 15,
                    color: MUTED,
                    lineHeight: 1.5,
                    paddingTop: 8,
                  }}
                >
                  {g.why}
                </div>
              )}
              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 9,
                  letterSpacing: '0.22em',
                  color: FAINT,
                  textTransform: 'uppercase',
                  paddingTop: 14,
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span>finished</span>
                {when && (
                  <>
                    <span>·</span>
                    <span>{when}</span>
                  </>
                )}
                {g.category && (
                  <>
                    <span>·</span>
                    <span>{g.category}</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── GoalsModule ──────────────────────────────────────────────────────────────

export interface GoalsModuleProps {
  onBack?: () => void;
}

export function GoalsModule({ onBack }: GoalsModuleProps) {
  // ── Store slices ─────────────────────────────────────────────────────────
  const [goals, setGoals] = useStoreSlice<StoredGoal[]>('goals', 'items', []);
  const [sessions, setSessions] = useStoreSlice<GoalSession[]>('goals', 'sessions', []);
  const [reviews, setReviews] = useStoreSlice<GoalReview[]>('goals', 'reviews', []);
  const [dumps] = useStoreSlice<DumpEntry[]>('goals', 'dumps', []);

  // ── Draft state ──────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftWhy, setDraftWhy] = useState('');
  const [draftBy, setDraftBy] = useState('');
  const [draftObstacle, setDraftObstacle] = useState('');
  const [draftPremortem, setDraftPremortem] = useState('');
  const [draftUlysses, setDraftUlysses] = useState('');
  const [draftRole, setDraftRole] = useState('');
  const [draftPacing, setDraftPacing] = useState('');
  const [draftCategory, setDraftCategory] = useState<GoalCategory | ''>('');

  // ── Filter ───────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<'active' | 'done' | 'dropped' | 'graveyard' | 'all'>(
    'active',
  );
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  // ── AI step-breakdown state ──────────────────────────────────────────────
  const [stepFetching, setStepFetching] = useState<Record<string, boolean>>({});
  const [stepError, setStepError] = useState<Record<string, string>>({});

  // ── Milestone draft per goal ─────────────────────────────────────────────
  const [milestoneDrafts, setMilestoneDrafts] = useState<
    Record<string, { title: string; target: string }>
  >({});

  // ── Convert-to-habit modal state ─────────────────────────────────────────
  const [habitModal, setHabitModal] = useState<{
    goalId: string;
    title: string;
    cadence: 'daily' | 'weekly' | 'weekdays' | 'custom';
  } | null>(null);

  // ── Detector UI state — Phase 1 ──────────────────────────────────────────
  const [lowMoodBanner, setLowMoodBanner] = useState<LowMoodSignal | null>(null);
  const [obstacleEchoes, setObstacleEchoes] = useState<Record<string, { ts: number; dump_id: string }>>({});
  const [premortemEchoes, setPremortemEchoes] = useState<Record<string, { ts: number; dump_id: string }>>({});
  const [confirm, setConfirm] = useState<{
    kind: 'low_mood' | 'ulysses';
    goal_id: string;
    copy: string;
    lock_until_ts?: number;
    contract_text?: string;
  } | null>(null);

  // ── Detector UI state — Phase 2 ──────────────────────────────────────────
  const [capModal, setCapModal] = useState<{ pendingDraft: StoredGoal } | null>(null);
  const [researchEchoes, setResearchEchoes] = useState<
    Record<string, { thinking_count: number; ts: number }>
  >({});
  const [driftEchoes, setDriftEchoes] = useState<
    Record<string, { role: string; days_silent: number; ts: number }>
  >({});
  const [sunkEchoes, setSunkEchoes] = useState<Record<string, { ts: number }>>({});
  const [pacingResults, setPacingResults] = useState<
    Record<string, { pacing: string; dormancy_threshold_days: number | null; copy: string }>
  >({});
  const [reviewOpen, setReviewOpen] = useState<Record<string, boolean>>({});

  // ── Build draft ──────────────────────────────────────────────────────────
  function buildDraft(): StoredGoal | null {
    const t = draftTitle.trim();
    if (!t) return null;
    const targetIso = draftBy || null;
    const targetTs = targetIso ? Date.parse(targetIso) : null;
    const pacing =
      draftPacing === 'sprint' || draftPacing === 'marathon' || draftPacing === 'rolling'
        ? (draftPacing as 'sprint' | 'marathon' | 'rolling')
        : undefined;
    return {
      id: mkId('g'),
      title: t,
      why: draftWhy.trim() || undefined,
      target_date: targetIso,
      target_date_ts: typeof targetTs === 'number' && !isNaN(targetTs) ? targetTs : null,
      obstacle: draftObstacle.trim() || null,
      premortem: draftPremortem.trim() || null,
      ulysses_contract: draftUlysses.trim() || null,
      role: draftRole.trim() || null,
      pacing,
      category: draftCategory || undefined,
      status: 'active',
      created_at: Date.now(),
      action: 'add',
    };
  }

  function clearDraft() {
    setDraftTitle('');
    setDraftWhy('');
    setDraftBy('');
    setDraftObstacle('');
    setDraftPremortem('');
    setDraftUlysses('');
    setDraftRole('');
    setDraftPacing('');
    setDraftCategory('');
    setAddOpen(false);
  }

  // ── AI step breakdown via Cloudflare Worker ─────────────────────────────
  async function fetchSteps(goal: StoredGoal): Promise<void> {
    if (!goal.id || !goal.title) return;
    if (!AI_PROXY_URL) {
      setStepError((prev) => ({ ...prev, [goal.id!]: 'claude unreachable. try again.' }));
      return;
    }
    setStepFetching((prev) => ({ ...prev, [goal.id!]: true }));
    setStepError((prev) => {
      const n = { ...prev };
      delete n[goal.id!];
      return n;
    });
    try {
      const prompt =
        `Break this goal into 3-7 concrete actionable steps. ` +
        `Goal: ${goal.title}. ` +
        `Why: ${goal.why || 'not stated'}. ` +
        `Return ONLY a JSON array of short imperative step strings, no prose. Example: ["step one","step two"].`;
      const resp = await fetch(`${AI_PROXY_URL.replace(/\/$/, '')}/brain-dump`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!resp.ok) throw new Error(`http ${resp.status}`);
      const body = await resp.json();
      // Anthropic /v1/messages-style response: { content: [{type:'text', text:'...'}] }
      const text: string =
        (body?.content?.[0]?.text as string) ??
        (body?.completion as string) ??
        (typeof body === 'string' ? body : '');
      // Pull first JSON array out of the text.
      const match = text.match(/\[[\s\S]*\]/);
      const arr: unknown = match ? JSON.parse(match[0]) : null;
      const steps = Array.isArray(arr)
        ? arr.map((s) => String(s).trim()).filter((s) => s.length > 0).slice(0, 7)
        : [];
      if (steps.length === 0) throw new Error('no steps parsed');
      setGoals(
        (goals ?? []).map((g) =>
          g?.id === goal.id ? { ...g, steps } : g,
        ),
      );
    } catch (err) {
      console.warn('[GoalsModule] fetchSteps failed:', err);
      setStepError((prev) => ({ ...prev, [goal.id!]: 'claude unreachable. try again.' }));
    } finally {
      setStepFetching((prev) => {
        const n = { ...prev };
        delete n[goal.id!];
        return n;
      });
    }
  }

  function toggleStep(goalId: string, idx: number) {
    // Steps are simple strings; toggling completion stores a parallel
    // boolean array under steps_done. We piggyback as a Record on the goal.
    setGoals(
      (goals ?? []).map((g) => {
        if (g?.id !== goalId) return g;
        const done = (g as StoredGoal & { steps_done?: boolean[] }).steps_done ?? [];
        const next = [...done];
        next[idx] = !next[idx];
        return { ...g, steps_done: next };
      }) as StoredGoal[],
    );
  }

  // ── Milestone ops ───────────────────────────────────────────────────────
  function addMilestone(goalId: string) {
    const d = milestoneDrafts[goalId];
    if (!d?.title?.trim()) return;
    const ms: Milestone = {
      id: mkId('ms'),
      title: sanitize(d.title.trim()),
      target_date: d.target ? Date.parse(d.target) : undefined,
      completed_at: null,
      created_at: Date.now(),
    };
    setGoals(
      (goals ?? []).map((g) =>
        g?.id === goalId
          ? { ...g, milestones: [...(g.milestones ?? []), ms] }
          : g,
      ),
    );
    setMilestoneDrafts((prev) => ({ ...prev, [goalId]: { title: '', target: '' } }));
  }

  function toggleMilestone(goalId: string, msId: string) {
    setGoals(
      (goals ?? []).map((g) => {
        if (g?.id !== goalId) return g;
        const next = (g.milestones ?? []).map((m) =>
          m.id === msId
            ? { ...m, completed_at: m.completed_at ? null : Date.now() }
            : m,
        );
        // Auto-compute progress when milestones exist.
        const total = next.length;
        const done = next.filter((m) => m.completed_at).length;
        const progress = total > 0 ? Math.round((done / total) * 100) : g.progress;
        return { ...g, milestones: next, progress };
      }),
    );
  }

  function removeMilestone(goalId: string, msId: string) {
    setGoals(
      (goals ?? []).map((g) => {
        if (g?.id !== goalId) return g;
        const next = (g.milestones ?? []).filter((m) => m.id !== msId);
        const total = next.length;
        const done = next.filter((m) => m.completed_at).length;
        const progress = total > 0 ? Math.round((done / total) * 100) : g.progress;
        return { ...g, milestones: next, progress };
      }),
    );
  }

  // ── Progress manual setter (when no milestones) ──────────────────────────
  function setProgress(goalId: string, pct: number) {
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    setGoals(
      (goals ?? []).map((g) => (g?.id === goalId ? { ...g, progress: v } : g)),
    );
  }

  // ── Convert to habit (dispatches cross-module event) ─────────────────────
  function confirmConvertToHabit() {
    if (!habitModal) return;
    const { goalId, title, cadence } = habitModal;
    setGoals(
      (goals ?? []).map((g) =>
        g?.id === goalId ? { ...g, converted_to_habit_at: Date.now() } : g,
      ),
    );
    // Cross-module dispatch — backend pod wires habits orchestrator listener.
    try {
      emitEvent('goals:convert_to_habit', {
        goal_id: goalId,
        habit_title: title,
        cadence,
        ts: Date.now(),
      });
    } catch (err) {
      console.warn('[GoalsModule] emit goals:convert_to_habit failed:', err);
    }
    setHabitModal(null);
  }

  function commitDraft(draftGoal: StoredGoal, nextGoals: StoredGoal[]) {
    setGoals([...nextGoals, draftGoal]);
    try {
      const cp = classifyPacing(draftGoal as Goal, { now: Date.now() });
      if (cp) {
        setPacingResults((prev) => ({
          ...prev,
          [draftGoal.id!]: {
            pacing: cp.pacing,
            dormancy_threshold_days: cp.dormancy_threshold_days,
            copy: cp.copy,
          },
        }));
      }
    } catch {
      // classifier optional
    }
    clearDraft();
  }

  function save() {
    const draftGoal = buildDraft();
    if (!draftGoal) return;
    const activeNow = (goals ?? []).filter((g) => g && (g.status ?? 'active') === 'active');
    if (activeNow.length >= 5) {
      setCapModal({ pendingDraft: draftGoal });
      return;
    }
    commitDraft(draftGoal, goals ?? []);
  }

  function setStatus(id: string, status: string) {
    setGoals((goals ?? []).map((g) => (g?.id === id ? { ...g, status, status_at: Date.now() } : g)));
  }

  function moveToGraveyardThenSave(existingId: string) {
    if (!capModal?.pendingDraft) {
      setCapModal(null);
      return;
    }
    const pending = capModal.pendingDraft;
    const next = (goals ?? []).map((g) =>
      g?.id === existingId ? { ...g, status: 'graveyard', status_at: Date.now() } : g,
    );
    commitDraft(pending, next);
    setCapModal(null);
  }

  function tagSession(goal_id: string, type: 'thinking' | 'doing') {
    const list = Array.isArray(sessions) ? sessions : [];
    setSessions([...list, { goal_id, type, ts: Date.now() }]);
  }

  function tagReview(goal_id: string, alive_flag: 'want' | 'invested') {
    const list = Array.isArray(reviews) ? reviews : [];
    setReviews([...list, { goal_id, alive_flag, ts: Date.now() }]);
    setReviewOpen((prev) => ({ ...prev, [goal_id]: false }));
  }

  function hardDelete(id: string) {
    setGoals((goals ?? []).filter((g) => g?.id !== id));
  }

  function del(id: string) {
    try {
      const goal = (goals ?? []).find((g) => g?.id === id);
      if (!goal) return;
      const now = Date.now();
      const dumpHistory = { dumps: dumps as DumpEntry[], now };
      const mood = detectLowMood(dumpHistory, { now });
      if (mood && typeof mood.lock_until_ts === 'number' && mood.lock_until_ts > now) {
        setConfirm({
          kind: 'low_mood',
          goal_id: id,
          copy: mood.copy ?? "you're in a trough. let's not delete anything yet.",
          lock_until_ts: mood.lock_until_ts,
        });
        return;
      }
      const contract = retrieveUlyssesContract(null, { goal: goal as Goal, action: 'delete', now });
      if (contract && contract.contract_text) {
        setConfirm({
          kind: 'ulysses',
          goal_id: id,
          copy: contract.copy ?? `before you delete, you wanted to remember: ${contract.contract_text}`,
          contract_text: contract.contract_text,
        });
        return;
      }
    } catch (err) {
      console.error('[GoalsModule] delete suppression check failed:', err);
    }
    hardDelete(id);
  }

  function parkUntil(id: string, lock_until_ts: number | undefined) {
    setGoals(
      (goals ?? []).map((g) =>
        g?.id === id
          ? { ...g, status: 'paused', status_at: Date.now(), paused_until: lock_until_ts }
          : g,
      ),
    );
    setConfirm(null);
  }

  // ── Derived — memoised ───────────────────────────────────────────────────
  const visible = useMemo(
    () =>
      (goals ?? [])
        .filter((g) => g?.title)
        .filter((g) => (filter === 'all' ? true : (g.status ?? 'active') === filter))
        .filter((g) => (categoryFilter === 'all' ? true : g.category === categoryFilter))
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)),
    [goals, filter, categoryFilter],
  );

  const counts = useMemo(
    () => ({
      active: (goals ?? []).filter((g) => g && (g.status ?? 'active') === 'active').length,
      done: (goals ?? []).filter((g) => g?.status === 'done').length,
      dropped: (goals ?? []).filter((g) => g?.status === 'dropped').length,
      graveyard: (goals ?? []).filter((g) => g?.status === 'graveyard').length,
    }),
    [goals],
  );

  // Run inline detector passes for research/drift/sunk on mount + goals change
  useEffect(() => {
    if (!goals?.length) return;
    const now = Date.now();
    const dumpList = Array.isArray(dumps) ? (dumps as DumpEntry[]) : [];
    const sessionList = Array.isArray(sessions) ? (sessions as GoalSession[]) : [];
    const reviewList = Array.isArray(reviews) ? (reviews as GoalReview[]) : [];
    const history = { goals: goals as Goal[], dumps: dumpList, sessions: sessionList, reviews: reviewList, now };

    try {
      const rapList = detectResearchAsProgress(history, { now });
      if (rapList) {
        for (const r of rapList) {
          setResearchEchoes((prev) => ({
            ...prev,
            [r.goal_id]: { thinking_count: r.thinking_count, ts: now },
          }));
        }
      }
    } catch { /* optional */ }

    try {
      const driftList = detectIdentityDrift(history, { now });
      if (driftList) {
        for (const d of driftList) {
          setDriftEchoes((prev) => ({
            ...prev,
            [d.goal_id]: { role: d.role, days_silent: d.days_silent, ts: now },
          }));
        }
      }
    } catch { /* optional */ }

    try {
      const sunkList = detectSunkCostFlag(history, { now });
      if (sunkList) {
        for (const s of sunkList) {
          setSunkEchoes((prev) => ({ ...prev, [s.goal_id]: { ts: now } }));
        }
      }
    } catch { /* optional */ }
  }, [goals, dumps, sessions, reviews]);

  // Low mood detector on dumps change
  useEffect(() => {
    if (!dumps?.length) return;
    try {
      const now = Date.now();
      const mood = detectLowMood({ dumps: dumps as DumpEntry[], now }, { now });
      if (mood && mood.lock_until_ts > now) {
        setLowMoodBanner(mood);
      }
    } catch { /* optional */ }
  }, [dumps]);

  // Obstacle / premortem echoes — run on goals + dumps change
  useEffect(() => {
    if (!goals?.length || !dumps?.length) return;
    const now = Date.now();
    const dumpList = Array.isArray(dumps) ? (dumps as DumpEntry[]) : [];
    const sessionList = Array.isArray(sessions) ? (sessions as GoalSession[]) : [];
    const reviewList = Array.isArray(reviews) ? (reviews as GoalReview[]) : [];
    const history = {
      goals: goals as Goal[],
      dumps: dumpList,
      sessions: sessionList,
      reviews: reviewList,
      now,
    };
    try {
      const obsList = detectObstacleEcho(history, { now });
      if (obsList) {
        for (const obs of obsList) {
          setObstacleEchoes((prev) => ({ ...prev, [obs.goal_id]: { ts: now, dump_id: obs.dump_id } }));
        }
      }
    } catch { /* optional */ }
    try {
      const pmList = detectPreMortemEcho(history, { now });
      if (pmList) {
        for (const pm of pmList) {
          setPremortemEchoes((prev) => ({ ...prev, [pm.goal_id]: { ts: now, dump_id: pm.dump_id } }));
        }
      }
    } catch { /* optional */ }
  }, [goals, dumps, sessions, reviews]);

  // Auto-clear low mood banner once lock expires
  useEffect(() => {
    if (!lowMoodBanner) return;
    const remaining = lowMoodBanner.lock_until_ts - Date.now();
    if (remaining <= 0) {
      setLowMoodBanner(null);
      return;
    }
    const t = setTimeout(() => setLowMoodBanner(null), Math.min(remaining, 2_147_483_000));
    return () => clearTimeout(t);
  }, [lowMoodBanner]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        overflowX: 'hidden',
        background: BG,
        color: INK,
        fontFamily: "'Inter Tight','DM Sans',sans-serif",
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div
        style={{
          maxWidth: 920,
          margin: '0 auto',
          padding: '44px clamp(24px,5vw,56px) 120px',
        }}
      >
        {/* nav bar */}
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
              type="button"
              onClick={onBack}
              style={{
                background: 'none',
                border: 'none',
                color: MUTED,
                fontFamily: 'inherit',
                fontSize: 'inherit',
                letterSpacing: 'inherit',
                cursor: 'pointer',
                textTransform: 'uppercase',
                padding: 0,
                minHeight: 44,
              }}
            >
              ← dashboard
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginLeft: onBack ? 0 : 'auto' }}>
            <span>
              ollie <span style={{ color: FAINT, margin: '0 10px' }}>/</span>{' '}
              <span style={{ color: INK }}>goals</span>
            </span>
            <ModuleHelp moduleId="goals" />
          </div>
        </div>

        {/* masthead */}
        <div
          style={{
            paddingBottom: 20,
            borderBottom: `1px solid ${HAIRLINE}`,
            marginBottom: 32,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: 14,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 'clamp(34px,4vw,46px)',
                color: INK,
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              goals.
            </div>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontStyle: 'italic',
                fontSize: 'clamp(16px,1.5vw,18px)',
                color: MUTED,
                paddingTop: 10,
              }}
            >
              the big picture. keep it short. don&apos;t lie.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            style={{
              padding: '12px 22px',
              background: addOpen ? INK : 'transparent',
              color: addOpen ? BG : INK,
              border: `1px solid ${addOpen ? INK : HAIRLINE_HI}`,
              fontFamily: "'DM Mono',monospace",
              fontSize: 10,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              borderRadius: 2,
              transition: 'all 240ms',
              minHeight: 44,
            }}
          >
            {addOpen ? 'close' : '+ new goal'}
          </button>
        </div>

        {/* add form */}
        {addOpen && (
          <div
            style={{
              padding: 28,
              background: PAPER,
              border: `1px solid ${HAIRLINE}`,
              borderRadius: 2,
              marginBottom: 40,
            }}
          >
            <div style={{ ...LABEL_STYLE, paddingBottom: 10 }}>what</div>
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(sanitize(e.target.value))}
              placeholder="e.g. learn to drive"
              aria-label="goal title"
              style={{
                width: '100%',
                padding: '12px 14px',
                background: BG,
                border: `1px solid ${HAIRLINE}`,
                color: INK,
                borderRadius: 2,
                fontFamily: "'Inter Tight',sans-serif",
                fontSize: 17,
                outline: 'none',
                marginBottom: 18,
                boxSizing: 'border-box',
              }}
            />

            <div style={{ ...LABEL_STYLE, paddingBottom: 10 }}>why · one sentence</div>
            <input
              value={draftWhy}
              onChange={(e) => setDraftWhy(sanitize(e.target.value))}
              placeholder="e.g. so i can stop asking for rides"
              aria-label="why"
              style={{
                width: '100%',
                padding: '12px 14px',
                background: BG,
                border: `1px solid ${HAIRLINE}`,
                color: INK,
                borderRadius: 2,
                fontFamily: "'Inter Tight',sans-serif",
                fontSize: 15,
                fontStyle: 'italic',
                outline: 'none',
                marginBottom: 18,
                boxSizing: 'border-box',
              }}
            />

            <div style={{ ...LABEL_STYLE, paddingBottom: 10 }}>by when · optional</div>
            <input
              type="date"
              value={draftBy}
              onChange={(e) => setDraftBy(e.target.value)}
              aria-label="target date"
              style={{
                padding: '12px 14px',
                background: BG,
                border: `1px solid ${HAIRLINE}`,
                color: INK,
                borderRadius: 2,
                fontFamily: "'Inter Tight',sans-serif",
                fontSize: 15,
                outline: 'none',
                marginBottom: 28,
                minWidth: 200,
              }}
            />

            {/* advanced fields */}
            <div
              style={{ paddingTop: 8, borderTop: `1px solid ${HAIRLINE}`, marginTop: 4 }}
            >
              <div
                style={{
                  ...LABEL_STYLE,
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  paddingTop: 22,
                  paddingBottom: 8,
                }}
              >
                what could stop you?
              </div>
              <input
                value={draftObstacle}
                onChange={(e) => setDraftObstacle(sanitize(e.target.value))}
                placeholder="e.g. tired by 6pm, no time on weeknights"
                aria-label="obstacle"
                style={{
                  width: '100%',
                  padding: '10px 0',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${HAIRLINE}`,
                  color: INK,
                  borderRadius: 0,
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 14,
                  outline: 'none',
                  minHeight: 44,
                  boxSizing: 'border-box',
                }}
              />
              <div
                style={{
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 12,
                  fontStyle: 'italic',
                  color: FAINT,
                  paddingTop: 6,
                  paddingBottom: 22,
                }}
              >
                woop — naming the obstacle releases mental load.
              </div>

              <div
                style={{ ...LABEL_STYLE, fontSize: 10, letterSpacing: '0.18em', paddingBottom: 8 }}
              >
                6 months from now this is dead. why?
              </div>
              <textarea
                value={draftPremortem}
                onChange={(e) => setDraftPremortem(sanitize(e.target.value))}
                placeholder="e.g. i drifted onto a different idea, lost interest in week 4, never carved time."
                rows={3}
                aria-label="premortem"
                style={{
                  width: '100%',
                  padding: '10px 0',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${HAIRLINE}`,
                  color: INK,
                  borderRadius: 0,
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 14,
                  outline: 'none',
                  resize: 'vertical',
                  minHeight: 72,
                  boxSizing: 'border-box',
                  lineHeight: 1.5,
                }}
              />
              <div
                style={{
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 12,
                  fontStyle: 'italic',
                  color: FAINT,
                  paddingTop: 6,
                  paddingBottom: 22,
                }}
              >
                your future self warning your present self.
              </div>

              <div
                style={{ ...LABEL_STYLE, fontSize: 10, letterSpacing: '0.18em', paddingBottom: 8 }}
              >
                when you want to quit, remind yourself of:
              </div>
              <textarea
                value={draftUlysses}
                onChange={(e) => setDraftUlysses(sanitize(e.target.value))}
                placeholder="e.g. the version of me who started this, and why"
                rows={2}
                aria-label="ulysses contract"
                style={{
                  width: '100%',
                  padding: '10px 0',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${HAIRLINE}`,
                  color: INK,
                  borderRadius: 0,
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 14,
                  outline: 'none',
                  resize: 'vertical',
                  minHeight: 56,
                  boxSizing: 'border-box',
                  lineHeight: 1.5,
                }}
              />
              <div
                style={{
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 12,
                  fontStyle: 'italic',
                  color: FAINT,
                  paddingTop: 6,
                  paddingBottom: 22,
                }}
              >
                future-you to present-you. shown on delete.
              </div>

              <div
                style={{ ...LABEL_STYLE, fontSize: 10, letterSpacing: '0.18em', paddingBottom: 8 }}
              >
                role · optional
              </div>
              <input
                value={draftRole}
                onChange={(e) => setDraftRole(sanitize(e.target.value))}
                placeholder="e.g. writer, runner, founder"
                aria-label="role"
                style={{
                  width: '100%',
                  padding: '10px 0',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${HAIRLINE}`,
                  color: INK,
                  borderRadius: 0,
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 14,
                  outline: 'none',
                  minHeight: 44,
                  boxSizing: 'border-box',
                }}
              />
              <div
                style={{
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 12,
                  fontStyle: 'italic',
                  color: FAINT,
                  paddingTop: 6,
                  paddingBottom: 22,
                }}
              >
                one word. used to surface drift if untouched 30 days.
              </div>

              <div
                style={{ ...LABEL_STYLE, fontSize: 10, letterSpacing: '0.18em', paddingBottom: 8 }}
              >
                category · optional
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingBottom: 20 }}>
                {CATEGORIES.map((c) => {
                  const on = draftCategory === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setDraftCategory(on ? '' : c)}
                      aria-pressed={on}
                      style={{
                        padding: '8px 12px',
                        minHeight: 36,
                        background: on ? ACCENT : 'transparent',
                        color: on ? BG : MUTED,
                        border: `1px solid ${on ? ACCENT : HAIRLINE_HI}`,
                        borderRadius: 999,
                        cursor: 'pointer',
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 9,
                        letterSpacing: '0.22em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>

              <div
                style={{ ...LABEL_STYLE, fontSize: 10, letterSpacing: '0.18em', paddingBottom: 8 }}
              >
                pacing · optional
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingBottom: 6 }}>
                {(['sprint', 'marathon', 'rolling'] as const).map((p) => {
                  const on = draftPacing === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDraftPacing(on ? '' : p)}
                      aria-pressed={on}
                      style={{
                        padding: '10px 16px',
                        minHeight: 44,
                        background: on ? INK : 'transparent',
                        color: on ? BG : MUTED,
                        border: `1px solid ${on ? INK : HAIRLINE_HI}`,
                        borderRadius: 2,
                        cursor: 'pointer',
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 10,
                        letterSpacing: '0.22em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
              <div
                style={{
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 12,
                  fontStyle: 'italic',
                  color: FAINT,
                  paddingTop: 6,
                  paddingBottom: 4,
                }}
              >
                blank lets the system infer from your target date.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button
                type="button"
                onClick={save}
                disabled={!draftTitle.trim()}
                style={{
                  padding: '12px 22px',
                  background: draftTitle.trim() ? INK : 'transparent',
                  color: draftTitle.trim() ? BG : FAINT,
                  border: `1px solid ${draftTitle.trim() ? INK : HAIRLINE_HI}`,
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 10,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: draftTitle.trim() ? 'pointer' : 'default',
                  borderRadius: 2,
                  transition: 'all 240ms',
                  minHeight: 44,
                }}
              >
                save goal
              </button>
              <button
                type="button"
                onClick={clearDraft}
                style={{
                  padding: '12px 18px',
                  background: 'transparent',
                  color: MUTED,
                  border: 'none',
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 10,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  minHeight: 44,
                }}
              >
                cancel
              </button>
            </div>
          </div>
        )}

        {/* low mood banner */}
        {lowMoodBanner && (
          <div
            style={{
              padding: '20px 22px',
              background: '#EDE7DC',
              border: `1px solid ${HAIRLINE}`,
              borderRadius: 2,
              marginBottom: 32,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 9,
                  letterSpacing: '0.26em',
                  color: MUTED,
                  textTransform: 'uppercase',
                  paddingBottom: 8,
                }}
              >
                noticed
              </div>
              <div
                style={{
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 15,
                  color: INK,
                  lineHeight: 1.55,
                }}
              >
                {lowMoodBanner.copy}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLowMoodBanner(null)}
              style={{
                padding: '10px 14px',
                minHeight: 44,
                background: 'transparent',
                border: `1px solid ${HAIRLINE_HI}`,
                color: MUTED,
                borderRadius: 2,
                fontFamily: "'DM Mono',monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              dismiss
            </button>
          </div>
        )}

        {/* filter tabs */}
        <div
          style={{
            display: 'flex',
            gap: 18,
            paddingBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          {(
            [
              ['active', counts.active],
              ['done', counts.done],
              ['dropped', counts.dropped],
              ['graveyard', counts.graveyard],
              ['all', (goals ?? []).length],
            ] as const
          ).map(([k, n]) => {
            const on = filter === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k as typeof filter)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '6px 0',
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 11,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  color: on ? INK : FAINT,
                  borderBottom: `1px solid ${on ? ACCENT : 'transparent'}`,
                  transition: 'all 240ms',
                  minHeight: 44,
                }}
              >
                {k} <span style={{ color: on ? MUTED : FAINT, marginLeft: 6 }}>{n}</span>
              </button>
            );
          })}
        </div>

        {/* category filter row · hidden when no goals exist */}
        {(goals ?? []).length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              paddingBottom: 28,
              borderBottom: `1px solid ${HAIRLINE}`,
              marginBottom: 32,
              flexWrap: 'wrap',
            }}
          >
            {(['all', ...CATEGORIES] as CategoryFilter[]).map((c) => {
              const on = categoryFilter === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategoryFilter(c)}
                  aria-pressed={on}
                  style={{
                    padding: '6px 12px',
                    minHeight: 32,
                    background: on ? ACCENT : 'transparent',
                    color: on ? BG : FAINT,
                    border: `1px solid ${on ? ACCENT : HAIRLINE}`,
                    borderRadius: 999,
                    cursor: 'pointer',
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 9,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>
        )}

        {/* empty state */}
        {visible.length === 0 && (
          <div style={{ padding: '48px 0', textAlign: 'left' }}>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 'clamp(22px,2.2vw,28px)',
                color: MUTED,
                fontStyle: 'italic',
                lineHeight: 1.3,
                maxWidth: 520,
              }}
            >
              {filter === 'active' &&
                ((goals ?? []).length === 0
                  ? "what's one thing you're working toward? tap + new goal."
                  : 'nothing active. write one down — it counts as progress.')}
              {filter === 'done' && "nothing finished yet. that's fine."}
              {filter === 'dropped' &&
                'nothing dropped. smooth sailing or the list is lying.'}
              {filter === 'graveyard' && 'graveyard is empty. nothing buried yet.'}
              {filter === 'all' &&
                "what's one thing you're working toward? tap + new goal."}
            </div>
          </div>
        )}

        {/* goal list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {visible.map((g) => {
            const status = g.status ?? 'active';
            const isDone = status === 'done';
            const isDropped = status === 'dropped';
            const isGraveyard = status === 'graveyard';
            const dayStr = daysUntil(g.target_date);
            const overdue =
              g.target_date &&
              new Date(g.target_date).getTime() < Date.now() &&
              status === 'active';
            const obsEcho = g.id ? obstacleEchoes[g.id] ?? null : null;
            const pmEcho = g.id ? premortemEchoes[g.id] ?? null : null;
            const rapEcho = g.id ? researchEchoes[g.id] ?? null : null;
            const drift = g.id ? driftEchoes[g.id] ?? null : null;
            const sunk = g.id ? sunkEchoes[g.id] ?? null : null;
            const pace = g.id ? pacingResults[g.id] ?? null : null;
            const reviewIsOpen = g.id ? !!reviewOpen[g.id] : false;

            return (
              <div
                key={g.id}
                style={{
                  padding: '24px 0',
                  borderBottom: `1px solid ${HAIRLINE}`,
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '14px 24px',
                  alignItems: 'start',
                  opacity: isDropped || isGraveyard ? 0.5 : 1,
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: "'Inter Tight',sans-serif",
                      fontSize: 'clamp(18px,2vw,22px)',
                      fontWeight: 600,
                      color: INK,
                      letterSpacing: '-0.01em',
                      lineHeight: 1.25,
                      textDecoration:
                        isDone || isDropped || isGraveyard ? 'line-through' : 'none',
                      textDecorationThickness: '1px',
                      textDecorationColor: MUTED,
                    }}
                  >
                    {g.title}
                  </div>
                  {g.why && (
                    <div
                      style={{
                        fontFamily: "'Inter Tight',sans-serif",
                        fontStyle: 'italic',
                        fontSize: 15,
                        color: MUTED,
                        lineHeight: 1.5,
                        paddingTop: 8,
                      }}
                    >
                      {g.why}
                    </div>
                  )}

                  {/* G11 identity drift */}
                  {drift && status === 'active' && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: '10px 12px',
                        border: `1px solid ${HAIRLINE}`,
                        borderRadius: 2,
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 10,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 9,
                          letterSpacing: '0.26em',
                          color: MUTED,
                          textTransform: 'uppercase',
                        }}
                      >
                        drift
                      </span>
                      <span
                        style={{
                          fontFamily: "'Inter Tight',sans-serif",
                          fontSize: 12,
                          color: FAINT,
                          lineHeight: 1.5,
                        }}
                      >
                        {(drift.role || 'this') +
                          " role hasn't been touched in " +
                          (drift.days_silent || 30) +
                          ' days. role changed, or season?'}
                      </span>
                    </div>
                  )}

                  {/* G5 research-as-progress */}
                  {rapEcho && status === 'active' && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '10px 12px',
                        border: `1px solid ${HAIRLINE}`,
                        borderRadius: 2,
                        fontFamily: "'Inter Tight',sans-serif",
                        fontSize: 13,
                        color: INK,
                        lineHeight: 1.5,
                      }}
                    >
                      {(rapEcho.thinking_count ?? 0) +
                        " thinking, 0 doing — what's the smallest doing step?"}
                    </div>
                  )}

                  {/* G13 sunk cost */}
                  {sunk && status === 'active' && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '12px 14px',
                        background: '#EDE7DC',
                        border: `1px solid ${HAIRLINE}`,
                        borderRadius: 2,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 9,
                          letterSpacing: '0.26em',
                          color: MUTED,
                          textTransform: 'uppercase',
                          paddingBottom: 6,
                        }}
                      >
                        noticed
                      </div>
                      <div
                        style={{
                          fontFamily: "'Inter Tight',sans-serif",
                          fontSize: 13,
                          color: INK,
                          lineHeight: 1.5,
                          paddingBottom: 10,
                        }}
                      >
                        3 reviews &lsquo;already invested&rsquo;, not &lsquo;still want&rsquo;. graveyard?
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setStatus(g.id!, 'graveyard');
                            setSunkEchoes((prev) => {
                              const n = { ...prev };
                              delete n[g.id!];
                              return n;
                            });
                          }}
                          style={{
                            padding: '10px 16px',
                            minHeight: 44,
                            background: INK,
                            color: BG,
                            border: `1px solid ${INK}`,
                            borderRadius: 2,
                            cursor: 'pointer',
                            fontFamily: "'DM Mono',monospace",
                            fontSize: 10,
                            letterSpacing: '0.22em',
                            textTransform: 'uppercase',
                          }}
                        >
                          graveyard
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            tagReview(g.id!, 'want');
                            setSunkEchoes((prev) => {
                              const n = { ...prev };
                              delete n[g.id!];
                              return n;
                            });
                          }}
                          style={{
                            padding: '10px 16px',
                            minHeight: 44,
                            background: 'transparent',
                            color: MUTED,
                            border: `1px solid ${HAIRLINE_HI}`,
                            borderRadius: 2,
                            cursor: 'pointer',
                            fontFamily: "'DM Mono',monospace",
                            fontSize: 10,
                            letterSpacing: '0.22em',
                            textTransform: 'uppercase',
                          }}
                        >
                          keep, still want
                        </button>
                      </div>
                    </div>
                  )}

                  {/* obstacle / premortem echo chips */}
                  {(obsEcho || pmEcho) && status === 'active' && (
                    <div
                      style={{ paddingTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}
                    >
                      {obsEcho && (
                        <span
                          style={{
                            padding: '6px 10px',
                            border: `1px solid ${HAIRLINE}`,
                            borderRadius: 2,
                            background: PAPER,
                            fontFamily: "'DM Mono',monospace",
                            fontSize: 10,
                            letterSpacing: '0.18em',
                            color: MUTED,
                            textTransform: 'uppercase',
                          }}
                        >
                          you predicted this obstacle
                        </span>
                      )}
                      {pmEcho && (
                        <span
                          style={{
                            padding: '6px 10px',
                            border: `1px solid ${HAIRLINE}`,
                            borderRadius: 2,
                            background: PAPER,
                            fontFamily: "'DM Mono',monospace",
                            fontSize: 10,
                            letterSpacing: '0.18em',
                            color: MUTED,
                            textTransform: 'uppercase',
                          }}
                        >
                          your premortem predicted this
                        </span>
                      )}
                    </div>
                  )}

                  {/* G14 pacing chip */}
                  {pace?.copy && status === 'active' && (
                    <div style={{ paddingTop: 10 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '6px 10px',
                          border: `1px solid ${HAIRLINE}`,
                          borderRadius: 2,
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 9,
                          letterSpacing: '0.22em',
                          color: MUTED,
                          textTransform: 'uppercase',
                        }}
                      >
                        {pace.pacing}
                        {pace.dormancy_threshold_days
                          ? ` · stales after ${pace.dormancy_threshold_days} days`
                          : ' · continuous'}
                      </span>
                    </div>
                  )}

                  {/* session tag pills + review picker */}
                  {status === 'active' && (
                    <div
                      style={{ paddingTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}
                    >
                      <button
                        type="button"
                        onClick={() => tagSession(g.id!, 'thinking')}
                        style={{
                          padding: '10px 14px',
                          minHeight: 44,
                          background: 'transparent',
                          color: MUTED,
                          border: `1px solid ${HAIRLINE_HI}`,
                          borderRadius: 2,
                          cursor: 'pointer',
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 10,
                          letterSpacing: '0.22em',
                          textTransform: 'uppercase',
                        }}
                      >
                        thinking
                      </button>
                      <button
                        type="button"
                        onClick={() => tagSession(g.id!, 'doing')}
                        style={{
                          padding: '10px 14px',
                          minHeight: 44,
                          background: 'transparent',
                          color: INK,
                          border: `1px solid ${HAIRLINE_HI}`,
                          borderRadius: 2,
                          cursor: 'pointer',
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 10,
                          letterSpacing: '0.22em',
                          textTransform: 'uppercase',
                        }}
                      >
                        doing
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setReviewOpen((prev) => ({ ...prev, [g.id!]: !prev[g.id!] }))
                        }
                        style={{
                          padding: '10px 14px',
                          minHeight: 44,
                          background: 'transparent',
                          color: FAINT,
                          border: `1px solid ${HAIRLINE}`,
                          borderRadius: 2,
                          cursor: 'pointer',
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 10,
                          letterSpacing: '0.22em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {reviewIsOpen ? 'close' : 'review'}
                      </button>
                    </div>
                  )}

                  {reviewIsOpen && status === 'active' && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '10px 12px',
                        border: `1px solid ${HAIRLINE}`,
                        borderRadius: 2,
                        display: 'flex',
                        gap: 8,
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 9,
                          letterSpacing: '0.26em',
                          color: MUTED,
                          textTransform: 'uppercase',
                          marginRight: 4,
                        }}
                      >
                        still alive?
                      </span>
                      <button
                        type="button"
                        onClick={() => tagReview(g.id!, 'want')}
                        style={{
                          padding: '10px 14px',
                          minHeight: 44,
                          background: INK,
                          color: BG,
                          border: `1px solid ${INK}`,
                          borderRadius: 2,
                          cursor: 'pointer',
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 10,
                          letterSpacing: '0.22em',
                          textTransform: 'uppercase',
                        }}
                      >
                        still want
                      </button>
                      <button
                        type="button"
                        onClick={() => tagReview(g.id!, 'invested')}
                        style={{
                          padding: '10px 14px',
                          minHeight: 44,
                          background: 'transparent',
                          color: FAINT,
                          border: `1px solid ${HAIRLINE_HI}`,
                          borderRadius: 2,
                          cursor: 'pointer',
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 10,
                          letterSpacing: '0.22em',
                          textTransform: 'uppercase',
                        }}
                      >
                        already invested
                      </button>
                    </div>
                  )}

                  {g.target_date && (
                    <div
                      style={{
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 10,
                        letterSpacing: '0.22em',
                        color: overdue ? ACCENT : FAINT,
                        textTransform: 'uppercase',
                        paddingTop: 10,
                        fontWeight: 500,
                      }}
                    >
                      {fmtDate(g.target_date)} · {dayStr}
                      {overdue && ' · past target'}
                    </div>
                  )}

                  {/* category chip */}
                  {g.category && (
                    <div style={{ paddingTop: 10 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '4px 10px',
                          border: `1px solid ${HAIRLINE_HI}`,
                          borderRadius: 999,
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 9,
                          letterSpacing: '0.22em',
                          color: MUTED,
                          textTransform: 'uppercase',
                        }}
                      >
                        {g.category}
                      </span>
                    </div>
                  )}

                  {/* progress bar — sage fill, frosted bg */}
                  {status === 'active' && (
                    <ProgressBlock
                      goal={g}
                      onManualSet={(v) => setProgress(g.id!, v)}
                    />
                  )}

                  {/* milestones */}
                  {status === 'active' && (
                    <MilestoneBlock
                      goal={g}
                      draft={milestoneDrafts[g.id!] ?? { title: '', target: '' }}
                      onDraftChange={(d) =>
                        setMilestoneDrafts((prev) => ({ ...prev, [g.id!]: d }))
                      }
                      onAdd={() => addMilestone(g.id!)}
                      onToggle={(msId) => toggleMilestone(g.id!, msId)}
                      onRemove={(msId) => removeMilestone(g.id!, msId)}
                    />
                  )}

                  {/* AI step breakdown */}
                  {status === 'active' && (
                    <StepBlock
                      goal={g}
                      busy={!!stepFetching[g.id!]}
                      error={stepError[g.id!]}
                      onAsk={() => fetchSteps(g)}
                      onToggle={(idx) => toggleStep(g.id!, idx)}
                    />
                  )}

                  {/* convert to habit */}
                  {(status === 'active' || status === 'done') && !g.converted_to_habit_at && (
                    <div style={{ paddingTop: 16 }}>
                      <button
                        type="button"
                        onClick={() =>
                          setHabitModal({
                            goalId: g.id!,
                            title: g.title ?? 'goal',
                            cadence: 'daily',
                          })
                        }
                        style={{
                          padding: '8px 14px',
                          minHeight: 36,
                          background: 'transparent',
                          color: MUTED,
                          border: `1px solid ${HAIRLINE_HI}`,
                          borderRadius: 2,
                          cursor: 'pointer',
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 9,
                          letterSpacing: '0.22em',
                          textTransform: 'uppercase',
                        }}
                      >
                        convert to habit
                      </button>
                    </div>
                  )}

                  {g.converted_to_habit_at && (
                    <div
                      style={{
                        paddingTop: 12,
                        fontFamily: "'DM Mono',monospace",
                        fontSize: 9,
                        letterSpacing: '0.22em',
                        color: FAINT,
                        textTransform: 'uppercase',
                      }}
                    >
                      added to your habits.
                    </div>
                  )}
                </div>

                {/* action buttons */}
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    flexWrap: 'wrap',
                    justifyContent: 'flex-end',
                  }}
                >
                  {status === 'active' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setStatus(g.id!, 'done')}
                        title="mark done"
                        style={{
                          padding: '8px 14px',
                          background: 'transparent',
                          border: `1px solid ${HAIRLINE_HI}`,
                          color: MUTED,
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 10,
                          letterSpacing: '0.2em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                          borderRadius: 2,
                          minHeight: 44,
                        }}
                      >
                        done
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatus(g.id!, 'dropped')}
                        title="drop"
                        style={{
                          padding: '8px 14px',
                          background: 'transparent',
                          border: `1px solid ${HAIRLINE_HI}`,
                          color: FAINT,
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 10,
                          letterSpacing: '0.2em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                          borderRadius: 2,
                          minHeight: 44,
                        }}
                      >
                        drop
                      </button>
                    </>
                  )}
                  {(status === 'done' || status === 'dropped' || status === 'graveyard') && (
                    <>
                      <button
                        type="button"
                        onClick={() => setStatus(g.id!, 'active')}
                        style={{
                          padding: '8px 14px',
                          background: 'transparent',
                          border: `1px solid ${HAIRLINE_HI}`,
                          color: MUTED,
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 10,
                          letterSpacing: '0.2em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                          borderRadius: 2,
                          minHeight: 44,
                        }}
                      >
                        reactivate
                      </button>
                      <button
                        type="button"
                        onClick={() => del(g.id!)}
                        style={{
                          padding: '8px 14px',
                          background: 'transparent',
                          border: `1px solid ${HAIRLINE_HI}`,
                          color: FAINT,
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 10,
                          letterSpacing: '0.2em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                          borderRadius: 2,
                          minHeight: 44,
                        }}
                      >
                        delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <AchievementGallery goals={goals ?? []} />

        <GoalsNoticed />

        <div
          style={{
            marginTop: 72,
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
          ollie <span style={{ color: MUTED, margin: '0 10px' }}>·</span> goals{' '}
          <span style={{ color: MUTED, margin: '0 10px' }}>·</span> mmxxvi
        </div>
      </div>

      {/* G2 active cap modal */}
      {capModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCapModal(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17,17,17,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              background: BG,
              color: INK,
              padding: 32,
              borderRadius: 2,
              border: `1px solid ${HAIRLINE}`,
              maxHeight: '86vh',
              overflow: 'auto',
            }}
          >
            <div
              style={{
                fontFamily: "'DM Mono',monospace",
                fontSize: 9,
                letterSpacing: '0.26em',
                color: MUTED,
                textTransform: 'uppercase',
                paddingBottom: 14,
              }}
            >
              cap reached
            </div>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 24,
                color: INK,
                lineHeight: 1.25,
                letterSpacing: '-0.01em',
                paddingBottom: 18,
              }}
            >
              active goals at cap.
            </div>
            <div style={{ borderTop: `1px solid ${HAIRLINE}`, paddingTop: 18 }}>
              <div
                style={{
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 14,
                  color: INK,
                  lineHeight: 1.6,
                  paddingBottom: 18,
                }}
              >
                you have 5 active goals. cap is real — pick one to move to graveyard before
                adding this.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {(goals ?? [])
                  .filter((g) => g && (g.status ?? 'active') === 'active')
                  .slice(0, 5)
                  .map((g) => (
                    <div
                      key={g.id}
                      style={{
                        padding: '14px 0',
                        borderBottom: `1px solid ${HAIRLINE}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "'Inter Tight',sans-serif",
                          fontSize: 15,
                          color: INK,
                          lineHeight: 1.4,
                          flex: '1 1 200px',
                        }}
                      >
                        {g.title}
                      </div>
                      <button
                        type="button"
                        onClick={() => moveToGraveyardThenSave(g.id!)}
                        style={{
                          padding: '10px 14px',
                          minHeight: 44,
                          background: 'transparent',
                          color: MUTED,
                          border: `1px solid ${HAIRLINE_HI}`,
                          borderRadius: 2,
                          cursor: 'pointer',
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 10,
                          letterSpacing: '0.22em',
                          textTransform: 'uppercase',
                        }}
                      >
                        graveyard
                      </button>
                    </div>
                  ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, paddingTop: 24 }}>
              <button
                type="button"
                onClick={() => setCapModal(null)}
                style={{
                  padding: '12px 18px',
                  minHeight: 44,
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
        </div>
      )}

      {/* delete suppression modal — G4 trough park or G15 ulysses */}
      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirm(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17,17,17,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              background: BG,
              color: INK,
              padding: 32,
              borderRadius: 2,
              border: `1px solid ${HAIRLINE}`,
            }}
          >
            <div
              style={{
                fontFamily: "'DM Mono',monospace",
                fontSize: 9,
                letterSpacing: '0.26em',
                color: MUTED,
                textTransform: 'uppercase',
                paddingBottom: 14,
              }}
            >
              {confirm.kind === 'low_mood' ? 'trough detected' : 'before you delete'}
            </div>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 24,
                color: INK,
                lineHeight: 1.25,
                letterSpacing: '-0.01em',
                paddingBottom: 18,
              }}
            >
              {confirm.kind === 'low_mood' ? 'park it for 72 hours.' : 'a note from past you.'}
            </div>
            <div style={{ borderTop: `1px solid ${HAIRLINE}`, paddingTop: 18 }}>
              <div
                style={{
                  fontFamily: "'Inter Tight',sans-serif",
                  fontSize: 14,
                  color: INK,
                  lineHeight: 1.6,
                }}
              >
                {confirm.copy}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, paddingTop: 28, flexWrap: 'wrap' }}>
              {confirm.kind === 'low_mood' ? (
                <button
                  type="button"
                  onClick={() => parkUntil(confirm.goal_id, confirm.lock_until_ts)}
                  style={{
                    padding: '12px 22px',
                    minHeight: 44,
                    background: INK,
                    color: BG,
                    border: `1px solid ${INK}`,
                    borderRadius: 2,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 10,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  park 72h
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirm(null)}
                  style={{
                    padding: '12px 22px',
                    minHeight: 44,
                    background: INK,
                    color: BG,
                    border: `1px solid ${INK}`,
                    borderRadius: 2,
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 10,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  keep going
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const id = confirm.goal_id;
                  setConfirm(null);
                  hardDelete(id);
                }}
                style={{
                  padding: '12px 16px',
                  minHeight: 44,
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
                delete anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* convert-to-habit modal */}
      {habitModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setHabitModal(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17,17,17,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              background: BG,
              color: INK,
              padding: 32,
              borderRadius: 2,
              border: `1px solid ${HAIRLINE}`,
            }}
          >
            <div
              style={{
                fontFamily: "'DM Mono',monospace",
                fontSize: 9,
                letterSpacing: '0.26em',
                color: MUTED,
                textTransform: 'uppercase',
                paddingBottom: 14,
              }}
            >
              convert to habit
            </div>
            <div
              style={{
                fontFamily: "'DM Serif Display',serif",
                fontSize: 22,
                color: INK,
                lineHeight: 1.3,
                letterSpacing: '-0.01em',
                paddingBottom: 18,
              }}
            >
              {habitModal.title}
            </div>
            <div
              style={{
                fontFamily: "'DM Mono',monospace",
                fontSize: 9,
                letterSpacing: '0.22em',
                color: FAINT,
                textTransform: 'uppercase',
                paddingBottom: 10,
              }}
            >
              cadence
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingBottom: 24 }}>
              {(['daily', 'weekdays', 'weekly', 'custom'] as const).map((c) => {
                const on = habitModal.cadence === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setHabitModal({ ...habitModal, cadence: c })}
                    aria-pressed={on}
                    style={{
                      padding: '10px 16px',
                      minHeight: 44,
                      background: on ? INK : 'transparent',
                      color: on ? BG : MUTED,
                      border: `1px solid ${on ? INK : HAIRLINE_HI}`,
                      borderRadius: 2,
                      cursor: 'pointer',
                      fontFamily: "'DM Mono',monospace",
                      fontSize: 10,
                      letterSpacing: '0.22em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={confirmConvertToHabit}
                style={{
                  padding: '12px 22px',
                  minHeight: 44,
                  background: INK,
                  color: BG,
                  border: `1px solid ${INK}`,
                  borderRadius: 2,
                  fontFamily: "'DM Mono',monospace",
                  fontSize: 10,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                add to habits
              </button>
              <button
                type="button"
                onClick={() => setHabitModal(null)}
                style={{
                  padding: '12px 18px',
                  minHeight: 44,
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
        </div>
      )}
    </div>
  );
}
