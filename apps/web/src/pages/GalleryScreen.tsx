/**
 * GalleryScreen — a vitrine of finished things.
 *
 * Goals roadmap #23. A quiet showcase of completed goals and completed
 * milestones. ANTI-SHAME by construction (Ollie doctrine):
 *   - NOT a trophy wall, NOT a streak grid, NOT a scoreboard.
 *   - No counts-as-pressure, no "X to go", no comparison.
 *   - Just a shelf — a record of what was finished, set down to rest.
 *
 * Real data only (verified against GoalsModule + @ollie/logic/goals):
 *   - goals.items : StoredGoal[]
 *       completed goal      = status === 'done'  (status_at = finished ts)
 *       completed milestone = milestone.completed_at is a number
 *
 * Hide-not-lie: a section renders only if it has real entries. With no
 * finished goals AND no finished milestones the screen is one calm
 * empty state. No fake/sample shelf is ever shown.
 */

import { useMemo } from 'react';
import { FrostedCard } from '../components/FrostedCard';
import { useStoreSlice } from '../store';
import { getString, type Locale } from '../i18n';

export interface GalleryScreenProps {
  onNavigate: (to: 'home') => void;
}

interface GoalMilestone {
  id?: string;
  title?: string;
  completed_at?: number | null;
}
interface StoredGoal {
  id?: string;
  title?: string;
  label?: string;
  status?: string;
  status_at?: number;
  milestones?: GoalMilestone[];
}

interface FinishedGoal {
  id: string;
  title: string;
  finishedAt: number | null;
}
interface FinishedMilestone {
  id: string;
  title: string;
  fromGoal: string;
  finishedAt: number | null;
}

function goalTitle(g: StoredGoal): string {
  return (g.title ?? g.label ?? '').trim();
}

export function GalleryScreen({ onNavigate }: GalleryScreenProps) {
  const [settings] = useStoreSlice<{ locale?: string }>('shared', 'settings', {});
  const locale: Locale = settings?.locale === 'es' ? 'es' : 'en';
  const t = (key: string) => getString(locale, `gallery.${key}`);

  const [goals] = useStoreSlice<StoredGoal[]>('goals', 'items', []);

  const finishedGoals = useMemo<FinishedGoal[]>(() => {
    return (goals ?? [])
      .filter((g) => g && g.status === 'done' && goalTitle(g).length > 0)
      .map((g) => ({
        id: g.id ?? `g_${Math.random().toString(36).slice(2)}`,
        title: goalTitle(g),
        finishedAt: typeof g.status_at === 'number' ? g.status_at : null,
      }))
      // newest finished first; undated sink to the bottom
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  }, [goals]);

  const finishedMilestones = useMemo<FinishedMilestone[]>(() => {
    const out: FinishedMilestone[] = [];
    for (const g of goals ?? []) {
      if (!g) continue;
      const parent = goalTitle(g);
      for (const m of g.milestones ?? []) {
        if (typeof m?.completed_at === 'number' && (m.title ?? '').trim().length > 0) {
          out.push({
            id: m.id ?? `m_${Math.random().toString(36).slice(2)}`,
            title: (m.title ?? '').trim(),
            fromGoal: parent,
            finishedAt: m.completed_at,
          });
        }
      }
    }
    return out.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  }, [goals]);

  const isEmpty = finishedGoals.length === 0 && finishedMilestones.length === 0;

  const fmtDate = (ms: number | null): string => {
    if (ms == null) return t('no_date');
    const d = new Date(ms).toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    return t('completed_on').replace('${0}', d.toLowerCase());
  };

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
        <BackButton label={t('back')} onClick={() => onNavigate('home')} />

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
        </header>

        {isEmpty && (
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

        {/* ── completed goals ─────────────────────────────────────────── */}
        {finishedGoals.length > 0 && (
          <section aria-label={t('section_goals')} style={{ marginBottom: 30 }}>
            <SectionLabel>{t('section_goals')}</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {finishedGoals.map((g) => (
                <FrostedCard key={g.id} style={{ padding: '20px 22px' }}>
                  <span style={kindTag}>{t('goal_label')}</span>
                  <p
                    style={{
                      fontFamily: 'var(--font-editor)',
                      fontSize: 'var(--t-h3, 21px)',
                      fontWeight: 400,
                      color: 'var(--ink)',
                      margin: '8px 0 0',
                      lineHeight: 1.25,
                    }}
                  >
                    {g.title}
                  </p>
                  <p style={dateLine}>{fmtDate(g.finishedAt)}</p>
                </FrostedCard>
              ))}
            </div>
          </section>
        )}

        {/* ── completed milestones ────────────────────────────────────── */}
        {finishedMilestones.length > 0 && (
          <section aria-label={t('section_milestones')}>
            <SectionLabel>{t('section_milestones')}</SectionLabel>
            <FrostedCard style={{ padding: '4px 0' }}>
              {finishedMilestones.map((m, i) => (
                <div
                  key={m.id}
                  style={{
                    padding: '16px 22px',
                    borderTop: i > 0 ? '1px solid var(--rule)' : 'none',
                    minHeight: 44,
                    boxSizing: 'border-box',
                  }}
                >
                  <p
                    style={{
                      fontFamily: 'var(--font-system)',
                      fontSize: 'var(--t-body)',
                      color: 'var(--ink)',
                      margin: 0,
                      lineHeight: 1.45,
                    }}
                  >
                    {m.title}
                  </p>
                  <p style={{ ...dateLine, marginTop: 6 }}>
                    {m.fromGoal
                      ? `${t('from_goal').replace('${0}', m.fromGoal)} · ${fmtDate(m.finishedAt)}`
                      : fmtDate(m.finishedAt)}
                  </p>
                </div>
              ))}
            </FrostedCard>
          </section>
        )}
      </div>
    </main>
  );
}

// ─── parts ────────────────────────────────────────────────────────────────────

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

const kindTag: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 'var(--t-meta, 9px)',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
};

const dateLine: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 'var(--t-meta, 10px)',
  letterSpacing: '0.06em',
  color: 'var(--ink-faint)',
  margin: '12px 0 0',
};
