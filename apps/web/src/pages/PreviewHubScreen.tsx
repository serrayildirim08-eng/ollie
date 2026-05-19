/**
 * PreviewHubScreen — the dev/preview index for the clean-slate v2 redesign
 *
 * Mounted at `/preview` (hash route `index.html#/preview`). This is a
 * TAPPABLE index so the v2 preview surfaces are reachable in the native
 * iOS Capacitor app — where there is NO URL bar and a hash route cannot
 * be typed. Serra reaches this hub from Settings → "preview the new
 * design"; from here every preview surface is one tap away.
 *
 * Two groups:
 *   - "the full new app" → one row → `/preview/v2` (the assembled v2
 *     experience, the v2-shell).
 *   - "individual modules" → 12 rows → each `/preview/{module}` route.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis` and the 13 other
 * `/preview/*` routes) so it is reachable directly. It is purely
 * additive: nothing in the live app, `GatedLayout`, or any existing
 * `/preview/*` route is touched.
 *
 * This is a dev/preview surface — it loosely matches the v2 visual
 * language (warm paper, editorial serif title, mono small-caps labels)
 * but does not need to be precious. It must be clean, calm, tappable,
 * and iPhone-correct: safe-area padding, border-box sizing, no overflow.
 */
import React from 'react';

export interface PreviewHubScreenProps {
  /**
   * Open a preview route. The router passes a navigate so a tap on a row
   * pushes a real history entry (hardware Back returns to the hub).
   */
  onOpen: (path: string) => void;
  /** Return out of the hub — the router passes a navigate to settings. */
  onExit: () => void;
}

/** One preview destination. `path` is the hash route the row opens. */
interface PreviewEntry {
  /** human label, lowercase to match the app voice */
  label: string;
  /** one-line dry description under the label */
  hint: string;
  /** the route to open, e.g. `/preview/money` */
  path: string;
}

const FULL_APP: PreviewEntry = {
  label: 'the full new app',
  hint: 'the complete assembled v2 experience',
  path: '/preview/v2',
};

const MODULES: PreviewEntry[] = [
  { label: 'money',      hint: 'spending · subscriptions · set-aside', path: '/preview/money' },
  { label: 'cycle',      hint: 'period · symptoms · phases',          path: '/preview/cycle' },
  { label: 'sleep',      hint: 'nights · debt · wind-down',           path: '/preview/sleep' },
  { label: 'body',       hint: 'movement · energy · check-ins',       path: '/preview/body' },
  { label: 'medication', hint: 'doses · refills · adherence',         path: '/preview/medication' },
  { label: 'habits',     hint: 'routines · gentle streaks',           path: '/preview/habits' },
  { label: 'partner',    hint: 'shared notes · the other person',     path: '/preview/partner' },
  { label: 'admin',      hint: 'paperwork · errands · the boring',    path: '/preview/admin' },
  { label: 'pets',       hint: 'feeds · vet · care log',              path: '/preview/pets' },
  { label: 'grocery',    hint: 'list · pantry · runs',                path: '/preview/grocery' },
  { label: 'work',       hint: 'matters · focus · the day job',       path: '/preview/work' },
  { label: 'goals',      hint: 'intentions · milestones',             path: '/preview/goals' },
];

// ─── tokens ──────────────────────────────────────────────────────────────────
//
// Mirrors SettingsScreen's local style object — calm, editorial, warm
// paper. Inline styles are the established pattern across these preview /
// settings pages (no Tailwind here), so we match it rather than fight it.

const styles = {
  page: {
    minHeight: '100dvh',
    background: 'var(--bone)',
    color: 'var(--ink)',
    fontFamily: 'var(--font-system)',
    boxSizing: 'border-box',
    // Fold the iPhone safe areas into the padding so the header clears
    // the notch and the last row clears the home indicator.
    padding:
      'calc(32px + env(safe-area-inset-top, 0px)) 24px calc(96px + env(safe-area-inset-bottom, 0px))',
  } as React.CSSProperties,
  wrap: {
    maxWidth: '560px',
    margin: '0 auto',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '32px',
  } as React.CSSProperties,
  back: {
    background: 'none',
    border: 'none',
    color: 'var(--ink-soft)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--t-meta)',
    letterSpacing: 'var(--ls-caps-small)',
    textTransform: 'uppercase',
    cursor: 'pointer',
    padding: '8px 0',
  } as React.CSSProperties,
  title: {
    fontFamily: 'var(--font-editor)',
    fontSize: 'var(--t-h1)',
    fontWeight: 400,
    color: 'var(--ink)',
    margin: 0,
    lineHeight: 'var(--lh-headline)',
  } as React.CSSProperties,
  standfirst: {
    fontFamily: 'var(--font-system)',
    fontSize: 'var(--t-body)',
    color: 'var(--ink-soft)',
    lineHeight: 'var(--lh-body)',
    margin: '12px 0 0',
    maxWidth: 460,
  } as React.CSSProperties,
  section: {
    margin: '40px 0 0',
    paddingTop: '24px',
    borderTop: '1px solid var(--rule)',
  } as React.CSSProperties,
  sectionHeader: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--t-kicker)',
    letterSpacing: 'var(--ls-caps)',
    textTransform: 'uppercase',
    color: 'var(--ink-faint)',
    margin: '0 0 8px',
  } as React.CSSProperties,
  // a tappable preview row — a real button so keyboard + a11y carry
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    width: '100%',
    boxSizing: 'border-box',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid var(--rule-soft)',
    textAlign: 'left',
    padding: '16px 2px',
    cursor: 'pointer',
    color: 'var(--ink)',
    fontFamily: 'var(--font-system)',
  } as React.CSSProperties,
  rowLabel: {
    fontFamily: 'var(--font-system)',
    fontSize: 'var(--t-body)',
    color: 'var(--ink)',
    margin: 0,
  } as React.CSSProperties,
  rowHint: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--t-meta)',
    letterSpacing: 'var(--ls-caps-small)',
    textTransform: 'uppercase',
    color: 'var(--ink-faint)',
    margin: '5px 0 0',
  } as React.CSSProperties,
  // the "open" chevron affordance — Phosphor-style caret, hairline, no
  // ASCII arrow. Sage on the full-app row so it reads as the headline.
  caret: {
    flexShrink: 0,
    color: 'var(--ink-faint)',
  } as React.CSSProperties,
  // the full-app row gets a warm paper card so it reads as the headline
  // of the page without shouting (no drop shadow, just a calm surface).
  featureRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--paper)',
    border: '1px solid var(--rule)',
    borderRadius: '12px',
    textAlign: 'left',
    padding: '20px',
    cursor: 'pointer',
    color: 'var(--ink)',
    fontFamily: 'var(--font-system)',
  } as React.CSSProperties,
  featureLabel: {
    fontFamily: 'var(--font-editor)',
    fontSize: 'var(--t-h3)',
    fontWeight: 400,
    color: 'var(--ink)',
    margin: 0,
    lineHeight: 'var(--lh-headline)',
  } as React.CSSProperties,
  footnote: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--t-meta)',
    letterSpacing: 'var(--ls-caps-small)',
    textTransform: 'uppercase',
    color: 'var(--ink-ghost)',
    margin: '40px 0 0',
    lineHeight: 1.6,
  } as React.CSSProperties,
};

/** A 1.5px-stroke chevron — Phosphor caret-right, never an ASCII arrow. */
function Caret({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={styles.caret}
    >
      <path
        d="M6 3.5 L10.5 8 L6 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PreviewHubScreen({ onOpen, onExit }: PreviewHubScreenProps) {
  return (
    <main style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.topBar}>
          <button
            type="button"
            onClick={onExit}
            style={styles.back}
            aria-label="back to settings"
          >
            back
          </button>
        </div>

        <h1 style={styles.title}>preview.</h1>
        <p style={styles.standfirst}>
          the clean-slate v2 redesign, reachable here so you can click
          through it on your phone.
        </p>

        {/* ─── the full new app ─────────────────────────────────────── */}
        <section style={styles.section} aria-label="the full new app">
          <h2 style={styles.sectionHeader}>the full new app</h2>
          <button
            type="button"
            onClick={() => onOpen(FULL_APP.path)}
            style={styles.featureRow}
            aria-label={`open ${FULL_APP.label}`}
          >
            <div>
              <p style={styles.featureLabel}>{FULL_APP.label}</p>
              <p style={styles.rowHint}>{FULL_APP.hint}</p>
            </div>
            <Caret size={18} />
          </button>
        </section>

        {/* ─── individual modules ───────────────────────────────────── */}
        <section style={styles.section} aria-label="individual modules">
          <h2 style={styles.sectionHeader}>individual modules</h2>
          {MODULES.map((m) => (
            <button
              key={m.path}
              type="button"
              onClick={() => onOpen(m.path)}
              style={styles.row}
              aria-label={`open ${m.label} preview`}
            >
              <div>
                <p style={styles.rowLabel}>{m.label}</p>
                <p style={styles.rowHint}>{m.hint}</p>
              </div>
              <Caret />
            </button>
          ))}
        </section>

        <p style={styles.footnote}>
          dev preview · nothing here replaces the live app
        </p>
      </div>
    </main>
  );
}
