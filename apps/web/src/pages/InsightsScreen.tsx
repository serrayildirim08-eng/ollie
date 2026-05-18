/**
 * InsightsScreen — cross-module weekly review.
 *
 * A calm editorial digest of what the user logged across modules in the
 * last 7 days. NOT a module-tile grid (Dashboard owns that). No scores,
 * no grades, no streaks — just a quiet record (anti-shame doctrine).
 *
 * Hide-not-lie: each section only renders if real data exists for it.
 * If nothing was logged this week, the whole screen collapses to a
 * single calm empty state.
 *
 * Data sources (all verified against module code 2026-05-15):
 *   - cycle.items          CycleItem[]    { ts, action }
 *   - sleep.records        SleepRecord[]  { night_of: 'YYYY-MM-DD', created_at? }
 *   - shared.habits_v2     StoredHabit[]  { completions: [{ ts }] }
 *   - work.focus_log       [{ at, duration_min }]
 *   - dump.items           StoredEntry[]  { ts }
 *   - goals.items          StoredGoal[]   { status_at, milestones: [{ completed_at }] }
 */

import { useMemo } from 'react';
import { FrostedCard } from '../components/FrostedCard';
import { useStoreSlice } from '../store';
import { getString, interpolate, pluralCategory, type Locale } from '../i18n';

export interface InsightsScreenProps {
  onNavigate: (to: 'home') => void;
}

const DAY = 86_400_000;
const WEEK = 7 * DAY;

interface CycleItem { ts?: number; action?: string }
interface SleepRecord { night_of?: string; created_at?: number }
interface HabitCompletion { ts?: number }
interface StoredHabit { completions?: HabitCompletion[] }
interface FocusEntry { at?: number; duration_min?: number }
interface DumpEntry { ts?: number }
interface GoalMilestone { completed_at?: number | null }
interface StoredGoal { status?: string; status_at?: number; milestones?: GoalMilestone[] }

/** Parse a 'YYYY-MM-DD' night_of into a ms timestamp (local midnight). */
function nightOfMs(s: string | undefined): number {
  if (!s) return 0;
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d).getTime();
}

interface LoggedRow {
  module: string;
  template: string;
  count: number;
  noun?: { one: string; many: string };
}

export function InsightsScreen({ onNavigate }: InsightsScreenProps) {
  const [settings] = useStoreSlice<{ locale?: string }>('shared', 'settings', {});
  const locale: Locale = settings?.locale === 'es' ? 'es' : 'en';
  const t = (key: string) => getString(locale, `insights.${key}`);

  const [cycleItems] = useStoreSlice<CycleItem[]>('cycle', 'items', []);
  const [sleepRecords] = useStoreSlice<SleepRecord[]>('sleep', 'records', []);
  const [habits] = useStoreSlice<StoredHabit[]>('shared', 'habits_v2', []);
  const [focusLog] = useStoreSlice<FocusEntry[]>('work', 'focus_log', []);
  const [dumpItems] = useStoreSlice<DumpEntry[]>('dump', 'items', []);
  const [goals] = useStoreSlice<StoredGoal[]>('goals', 'items', []);

  // Window: now back 7 days.
  const now = Date.now();
  const since = now - WEEK;

  const dateRange = useMemo(() => {
    const fmt = (ms: number) =>
      new Date(ms)
        .toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' })
        .toLowerCase();
    return interpolate(t('range_label'), { 0: fmt(since), 1: fmt(now) });
  }, [locale, since, now]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── what the user logged this week ──────────────────────────────────────
  const logged = useMemo<LoggedRow[]>(() => {
    const rows: LoggedRow[] = [];

    const cycleCount = (cycleItems ?? []).filter(
      (i) => typeof i?.ts === 'number' && i.ts >= since,
    ).length;
    if (cycleCount > 0) {
      rows.push({
        module: 'cycle',
        template: t('logged_cycle'),
        count: cycleCount,
        noun: { one: t('noun_entry_one'), many: t('noun_entry_many') },
      });
    }

    const sleepCount = (sleepRecords ?? []).filter((r) => {
      const ms = typeof r?.created_at === 'number' ? r.created_at : nightOfMs(r?.night_of);
      return ms >= since;
    }).length;
    if (sleepCount > 0) {
      rows.push({
        module: 'sleep',
        template: t('logged_sleep'),
        count: sleepCount,
        noun: { one: t('noun_night_one'), many: t('noun_night_many') },
      });
    }

    const habitTicks = (habits ?? []).reduce(
      (acc, h) =>
        acc + (h?.completions ?? []).filter((c) => typeof c?.ts === 'number' && c.ts >= since).length,
      0,
    );
    if (habitTicks > 0) {
      rows.push({
        module: 'habits',
        template: t('logged_habits'),
        count: habitTicks,
        noun: { one: t('noun_thing_one'), many: t('noun_thing_many') },
      });
    }

    const focusMin = (focusLog ?? [])
      .filter((f) => typeof f?.at === 'number' && f.at >= since)
      .reduce((acc, f) => acc + (f?.duration_min ?? 0), 0);
    if (focusMin > 0) {
      const focusText =
        focusMin < 60 ? `${focusMin}m` : `${Math.floor(focusMin / 60)}h ${focusMin % 60}m`;
      // template is pre-rendered (count sentinel 0) — interpolate fills
      // the ${0} token, replacing every occurrence.
      rows.push({
        module: 'work',
        template: interpolate(t('logged_work'), { 0: focusText }),
        count: 0,
        noun: undefined,
      });
    }

    const dumpCount = (dumpItems ?? []).filter(
      (d) => typeof d?.ts === 'number' && d.ts >= since,
    ).length;
    if (dumpCount > 0) {
      rows.push({
        module: 'dump',
        template: t('logged_dump'),
        count: dumpCount,
        noun: { one: t('noun_thing_one'), many: t('noun_thing_many') },
      });
    }

    const goalsMoved = (goals ?? []).filter((g) => {
      const statusTouched = typeof g?.status_at === 'number' && g.status_at >= since;
      const milestoneTouched = (g?.milestones ?? []).some(
        (m) => typeof m?.completed_at === 'number' && (m.completed_at ?? 0) >= since,
      );
      return statusTouched || milestoneTouched;
    }).length;
    if (goalsMoved > 0) {
      rows.push({
        module: 'goals',
        template: t('logged_goals'),
        count: goalsMoved,
        noun: { one: t('noun_thing_one'), many: t('noun_thing_many') },
      });
    }

    return rows;
  }, [cycleItems, sleepRecords, habits, focusLog, dumpItems, goals, since]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── gently noticed patterns — only emitted when grounded in real data ───
  const patterns = useMemo<string[]>(() => {
    const out: string[] = [];
    // A pattern is only a pattern with enough signal. We keep this
    // conservative: observation, never judgement.
    const dumpThisWeek = (dumpItems ?? []).filter(
      (d) => typeof d?.ts === 'number' && d.ts >= since,
    ).length;
    if (dumpThisWeek >= 5) {
      out.push(
        t('pattern_busy_mind') === 'insights.pattern_busy_mind'
          ? ''
          : t('pattern_busy_mind'),
      );
    }
    return out.filter(Boolean);
  }, [dumpItems, since]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── from a while ago — a dump entry from ~1 year ago today ──────────────
  const resurfaced = useMemo<DumpEntry & { text?: string } | null>(() => {
    const yearAgo = now - 365 * DAY;
    const lo = yearAgo - 3 * DAY;
    const hi = yearAgo + 3 * DAY;
    const match = (dumpItems as Array<DumpEntry & { text?: string; text_rendered?: string }>)
      ?.filter((d) => typeof d?.ts === 'number' && d.ts >= lo && d.ts <= hi)
      .sort((a, b) => Math.abs((a.ts ?? 0) - yearAgo) - Math.abs((b.ts ?? 0) - yearAgo))[0];
    if (!match) return null;
    const text = (match.text_rendered ?? match.text ?? '').trim();
    return text ? { ts: match.ts, text } : null;
  }, [dumpItems, now]);

  const hasContent = logged.length > 0 || patterns.length > 0 || resurfaced != null;

  return (
    <main
      style={{
        position: 'relative',
        width: '100vw',
        minHeight: '100vh',
        background: 'var(--bone)',
        color: 'var(--ink)',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 48px)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 560,
          margin: '0 auto',
          padding: '0 max(env(safe-area-inset-left, 0px), 22px) 0 max(env(safe-area-inset-right, 0px), 22px)',
        }}
      >
        {/* ── back ────────────────────────────────────────────────────── */}
        <BackButton label={t('back')} onClick={() => onNavigate('home')} />

        {/* ── masthead ────────────────────────────────────────────────── */}
        <header style={{ marginTop: 8, marginBottom: 28 }}>
          <h1
            style={{
              fontFamily: 'var(--font-editor)',
              fontSize: 'var(--t-h1)',
              fontWeight: 400,
              lineHeight: 1.1,
              margin: 0,
              letterSpacing: '-0.01em',
            }}
          >
            {t('title')}
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-system)',
              fontStyle: 'italic',
              fontSize: 'var(--t-body)',
              color: 'var(--ink-soft)',
              margin: '8px 0 0',
              lineHeight: 1.5,
            }}
          >
            {t('subtitle')}
          </p>
          <p style={metaLine}>{dateRange}</p>
        </header>

        {!hasContent && (
          <FrostedCard style={{ padding: '32px 24px', textAlign: 'center' }}>
            <p
              style={{
                fontFamily: 'var(--font-editor)',
                fontSize: 'var(--t-h3, 24px)',
                fontWeight: 400,
                margin: 0,
                color: 'var(--ink)',
              }}
            >
              {t('empty_title')}
            </p>
            <p
              style={{
                fontFamily: 'var(--font-system)',
                fontSize: 'var(--t-body)',
                color: 'var(--ink-soft)',
                margin: '10px 0 0',
                lineHeight: 1.5,
              }}
            >
              {t('empty_body')}
            </p>
          </FrostedCard>
        )}

        {/* ── what you logged ─────────────────────────────────────────── */}
        {logged.length > 0 && (
          <section aria-label={t('section_logged')} style={{ marginBottom: 28 }}>
            <SectionLabel>{t('section_logged')}</SectionLabel>
            <FrostedCard style={{ padding: '4px 0' }}>
              {logged.map((row, i) => (
                <div
                  key={row.module}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 14,
                    padding: '16px 22px',
                    borderTop: i > 0 ? '1px solid var(--rule)' : 'none',
                    minHeight: 44,
                    boxSizing: 'border-box',
                  }}
                >
                  <span style={moduleTag}>{t(`module_${row.module}`)}</span>
                  <span
                    style={{
                      fontFamily: 'var(--font-system)',
                      fontSize: 'var(--t-body)',
                      color: 'var(--ink)',
                      lineHeight: 1.45,
                    }}
                  >
                    {renderLoggedRow(row)}
                  </span>
                </div>
              ))}
            </FrostedCard>
          </section>
        )}

        {/* ── gently noticed ──────────────────────────────────────────── */}
        {patterns.length > 0 && (
          <section aria-label={t('section_patterns')} style={{ marginBottom: 28 }}>
            <SectionLabel>{t('section_patterns')}</SectionLabel>
            <FrostedCard style={{ padding: '20px 22px' }}>
              {patterns.map((p, i) => (
                <p
                  key={i}
                  style={{
                    fontFamily: 'var(--font-editor)',
                    fontSize: 'var(--t-body)',
                    color: 'var(--ink)',
                    margin: i > 0 ? '14px 0 0' : 0,
                    lineHeight: 1.5,
                  }}
                >
                  {p}
                </p>
              ))}
            </FrostedCard>
          </section>
        )}

        {/* ── from a while ago ────────────────────────────────────────── */}
        {resurfaced && (
          <section aria-label={t('section_resurface')} style={{ marginBottom: 8 }}>
            <SectionLabel>{t('section_resurface')}</SectionLabel>
            <FrostedCard style={{ padding: '20px 22px' }}>
              <p style={metaLine}>{t('resurface_caption')}</p>
              <p
                style={{
                  fontFamily: 'var(--font-editor)',
                  fontSize: 'var(--t-body)',
                  fontStyle: 'italic',
                  color: 'var(--ink)',
                  margin: '8px 0 0',
                  lineHeight: 1.55,
                }}
              >
                {(resurfaced as { text?: string }).text}
              </p>
            </FrostedCard>
          </section>
        )}
      </div>
    </main>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function renderLoggedRow(row: LoggedRow): string {
  // work row is already rendered (count === 0 sentinel).
  if (row.count === 0 && !row.noun) return row.template;
  // CLDR `one` category for en/es is exactly count === 1, so this is
  // behavior-identical to the prior `row.count === 1`; row.noun is already
  // resolved per-locale upstream.
  const noun = row.noun
    ? pluralCategory('en', row.count) === 'one'
      ? row.noun.one
      : row.noun.many
    : '';
  // interpolate replaces every occurrence of each token (the old chained
  // .replace stopped at the first hit per token).
  return interpolate(row.template, { 0: String(row.count), 1: noun });
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: 'var(--t-meta, 10px)',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
        margin: '0 0 12px',
        fontWeight: 400,
      }}
    >
      {children}
    </h2>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: 'transparent',
        border: 'none',
        padding: '14px 8px 14px 0',
        marginTop: 6,
        minHeight: 44,
        cursor: 'pointer',
        fontFamily: "'DM Mono', monospace",
        fontSize: 'var(--t-meta, 11px)',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M10 3 L5 8 L10 13"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </button>
  );
}

const metaLine: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 'var(--t-meta, 10px)',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-faint)',
  margin: '12px 0 0',
};

const moduleTag: React.CSSProperties = {
  flexShrink: 0,
  fontFamily: "'DM Mono', monospace",
  fontSize: 'var(--t-meta, 9px)',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
  width: 64,
};
