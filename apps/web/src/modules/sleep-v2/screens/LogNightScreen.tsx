/**
 * sleep-v2 · LogNightScreen — the log-last-night sheet (sleep-log.html)
 *
 * One thing: how did last night feel. The primary is a calm 2×2 of feel
 * tiles (solid · ok · rough · bad) — one tap, amber edge on the chosen
 * one. The calm secondary, set apart by a quiet "or" divider, is a
 * free-text line ollie parses. One amber "save" commit.
 *
 * Real data: a feel pick is written via `useSleepActions.logFeel` (the
 * same `quality` merge the live `SleepModule.logFeel` performs); a typed
 * sentence is written via `logFromText` (the live `parseSleepDump` path).
 * Both land in `sleep.records` keyed by `night_of`.
 */
import { useMemo, useState } from 'react';
import { Screen, AmberButton, IconCheck, IconPencil, v2 } from '../../money-v2/v2';
import { useSleepActions } from '../useSleepActions';
import { FEEL_OPTIONS, logSheetSubline, type FeelOption } from '../selectors';

export interface LogNightScreenProps {
  now: number;
  onBack: () => void;
}

/** the four small face glyphs for the feel tiles */
function FeelGlyph({ feel, on }: { feel: FeelOption['key']; on: boolean }) {
  const stroke = on ? v2.accent : v2.mute;
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke,
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  if (feel === 'solid') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 13s1.5 2 4 2 4-2 4-2" />
      </svg>
    );
  }
  if (feel === 'ok') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 14h8" />
      </svg>
    );
  }
  if (feel === 'rough') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 15s1.5-2 4-2 4 2 4 2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 16s1.5-3 4-3 4 3 4 3" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </svg>
  );
}

export function LogNightScreen({ now, onBack }: LogNightScreenProps) {
  const actions = useSleepActions(now);
  const subline = useMemo(() => logSheetSubline(now), [now]);

  const [feel, setFeel] = useState<FeelOption['key'] | null>(null);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);

  const dirty = feel !== null || text.trim().length > 0;

  function save() {
    if (!dirty) {
      onBack();
      return;
    }
    // a free-text sentence takes priority — it carries the most detail
    if (text.trim().length > 0) {
      actions.logFromText(text.trim());
    }
    if (feel !== null) {
      const opt = FEEL_OPTIONS.find((o) => o.key === feel);
      if (opt) actions.logFeel(opt.quality);
    }
    setSaved(true);
    window.setTimeout(onBack, 750);
  }

  return (
    <Screen label="log last night" scroll contentStyle={{ paddingTop: 0 }} onBack={onBack}>
      {/* the lead */}
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
        }}
      >
        <b style={{ fontWeight: 500 }}>how did last night feel</b>
      </div>
      <div style={{ marginTop: 6, fontSize: 13, color: v2.mute, fontWeight: 500 }}>
        {subline}
      </div>

      {/* THE PRIMARY — the 4-button quick log */}
      <div
        style={{
          marginTop: 30,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 11,
        }}
      >
        {FEEL_OPTIONS.map((o) => {
          const on = feel === o.key;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={on}
              onClick={() => setFeel(on ? null : o.key)}
              style={{
                boxSizing: 'border-box',
                height: 88,
                borderRadius: 20,
                border: `1px solid ${on ? v2.accent : v2.line}`,
                background: on ? '#FCF6EA' : v2.card,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 9,
                boxShadow: '0 6px 16px rgba(42,38,34,.04)',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <FeelGlyph feel={o.key} on={on} />
              <span
                style={{
                  fontSize: 16,
                  color: v2.ink,
                  fontWeight: on ? 600 : 500,
                  letterSpacing: '-0.01em',
                }}
              >
                {o.key}
              </span>
            </button>
          );
        })}
      </div>

      {/* the calm "or" divider */}
      <div
        style={{
          marginTop: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <span style={{ flex: 1, height: 1, background: v2.line }} />
        <span
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.04em',
          }}
        >
          or
        </span>
        <span style={{ flex: 1, height: 1, background: v2.line }} />
      </div>

      {/* the secondary — free-text, ollie parses it */}
      <div style={{ marginTop: 22 }}>
        <div
          style={{
            fontSize: 14,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
          }}
        >
          <IconPencil stroke={v2.sage} />
          <span>say more — i&rsquo;ll parse it</span>
        </div>
        <label
          style={{
            marginTop: 14,
            display: 'block',
            borderBottom: `1px solid ${v2.line}`,
            paddingBottom: 11,
          }}
        >
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="bed 23:48, woke 6:30, two coffees…"
            aria-label="say more about last night"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: 'none',
              background: 'transparent',
              outline: 'none',
              fontSize: 15,
              color: v2.ink,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              fontFamily: v2.sans,
              padding: 0,
              lineHeight: 1.5,
            }}
          />
        </label>
        <div
          style={{
            marginTop: 13,
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          say times if you remember them &mdash; don&rsquo;t if you don&rsquo;t. ollie
          pulls out bed &amp; wake times, caffeine and how long it took you to drop.
        </div>
      </div>

      {/* save — the one commit */}
      <AmberButton block icon={<IconCheck size={20} />} onClick={save} style={{ marginTop: 32 }}>
        save
      </AmberButton>

      {saved && (
        <div
          role="status"
          style={{
            marginTop: 16,
            textAlign: 'center',
            fontSize: 13,
            color: v2.sage,
            fontWeight: 600,
            letterSpacing: '0.01em',
          }}
        >
          noted.
        </div>
      )}
    </Screen>
  );
}
