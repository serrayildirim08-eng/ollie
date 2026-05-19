/**
 * v2-shell · NoticedScreen — one pattern the app found (noticed.html)
 *
 * DIRECTION.md: "Noticed shows one pattern." SCREENS.md: "One observed-link
 * mark, one calm sentence. Faint dots = more patterns wait. No feed."
 *
 * The screen renders ONE pattern at a time from the `patterns` prop; faint
 * dots page through any others. It is deliberately structural — the shell
 * supplies the pattern list. Wiring the full cross-module detector
 * pipeline (`@ollie/logic/patterns`, which needs cycle records + sleep
 * sessions + dump entries assembled) is a follow-up: see ShellApp's
 * `useNoticedPatterns`. Until then Noticed shows the calm empty line
 * (SCREENS.md: "ollie hasn't noticed anything yet — it needs a few days").
 *
 * A pattern's `lead` text is rendered with an optional sage-emphasised
 * `accent` fragment, matching noticed.html's `<b>` (sage, not bold).
 */
import { useEffect, useState } from 'react';
import { v2 } from '../../money-v2/v2';

const box = { boxSizing: 'border-box' as const };

/** one observed pattern, as Noticed renders it */
export interface NoticedPattern {
  /** the sentence before the emphasised fragment */
  lead: string;
  /** the sage-emphasised fragment ("40 min less") — optional */
  accent?: string;
  /** the sentence after the emphasised fragment */
  tail?: string;
}

export interface NoticedScreenProps {
  patterns: NoticedPattern[];
}

export function NoticedScreen({ patterns }: NoticedScreenProps) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
  }, [patterns.length]);

  const empty = patterns.length === 0;
  const p = empty ? null : patterns[Math.min(idx, patterns.length - 1)];

  return (
    <div
      style={{
        ...box,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 46px',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {/* one glyph — a soft observed-link mark */}
      <span
        aria-hidden
        style={{
          ...box,
          width: 64,
          height: 64,
          borderRadius: '50%',
          border: `1.5px solid ${v2.line}`,
          background: v2.card,
          boxShadow: '0 8px 22px rgba(42,38,34,.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 40,
        }}
      >
        <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={v2.sage} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="3.4" />
          <circle cx="17" cy="17" r="3.4" />
          <path d="M9.4 9.4l5.2 5.2" />
        </svg>
      </span>

      {/* the one pattern — one calm sentence */}
      <p
        style={{
          fontSize: empty ? 21 : 25,
          lineHeight: 1.5,
          color: empty ? v2.mute : v2.ink,
          textAlign: 'center',
          letterSpacing: '-.012em',
          fontWeight: 400,
        }}
      >
        {empty ? (
          "ollie hasn't noticed anything yet — it needs a few days"
        ) : (
          <>
            {p?.lead}
            {p?.accent && <span style={{ color: v2.sage }}>{` ${p.accent}`}</span>}
            {p?.tail && ` ${p.tail}`}
          </>
        )}
      </p>

      {/* faint dots — how many other patterns wait */}
      {!empty && patterns.length > 1 && (
        <div style={{ ...box, marginTop: 50, display: 'flex', gap: 8 }} role="tablist" aria-label="patterns">
          {patterns.slice(0, 5).map((_, i) => {
            const on = i === idx;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={on}
                aria-label={`pattern ${i + 1}`}
                onClick={() => setIdx(i)}
                style={{
                  ...box,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: on ? v2.ink : v2.line,
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
