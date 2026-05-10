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
import type {
  Goal,
  GoalSession,
  GoalReview,
  DumpEntry,
  LowMoodSignal,
  UlyssesContractSignal,
  ActiveCapSignal,
  ResearchAsProgressSignal,
  IdentityDriftSignal,
  SunkCostSignal,
  PacingClassifiedSignal,
} from '@ollie/logic/goals';
import { useStoreSlice } from '../../store';
import { ModuleHelp } from '../../components/ModuleHelp';

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

  // ── Filter ───────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<'active' | 'done' | 'dropped' | 'graveyard' | 'all'>(
    'active',
  );

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
      id: `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: t,
      why: draftWhy.trim() || undefined,
      target_date: targetIso,
      target_date_ts: typeof targetTs === 'number' && !isNaN(targetTs) ? targetTs : null,
      obstacle: draftObstacle.trim() || null,
      premortem: draftPremortem.trim() || null,
      ulysses_contract: draftUlysses.trim() || null,
      role: draftRole.trim() || null,
      pacing,
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
    setAddOpen(false);
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
        .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)),
    [goals, filter],
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
        background: BG,
        color: INK,
        fontFamily: "'Inter Tight','DM Sans',sans-serif",
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
            paddingBottom: 28,
            borderBottom: `1px solid ${HAIRLINE}`,
            marginBottom: 32,
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
    </div>
  );
}
