/**
 * sleep-v2 · SoundsScreen — the sleep-sounds player (sleep-sounds.html)
 *
 * One quiet player, centred and deeply calm: one large play disc with
 * soft concentric sound-rings, the sound name below, a 3-dot sound
 * switcher, and a soft sleep timer that fades the player out.
 *
 * STUB SURFACE — honest note: this v2 screen is the calm presentation
 * layer. The actual ambient-audio engine is the live
 * `components/SleepSoundPlayer` (a Web-Audio looper); wiring real
 * playback into the preview is out of scope here, exactly as the
 * money-v2 / cycle-v2 notification screens are presentation-only. The
 * play/pause and sleep-timer controls are real interactive state — they
 * just don't drive audio yet. Selecting a sound + timer is local UI
 * state; nothing is persisted.
 */
import { useState } from 'react';
import { Screen, IconPlay, IconPause, IconMoon, v2 } from '../../money-v2/v2';

export interface SoundsScreenProps {
  onBack: () => void;
  onSafe: () => void;
}

interface SoundDef {
  name: string;
  kind: string;
}

/** the three calm sounds the v2 player offers */
const SOUNDS: SoundDef[] = [
  { name: 'brown noise', kind: 'a low, even hum · no melody' },
  { name: 'soft rain', kind: 'a steady patter · nothing sharp' },
  { name: 'deep ocean', kind: 'a slow swell · far from the shore' },
];

/** the sleep-timer spans, in minutes; 0 = off */
const TIMER_SPANS: { label: string; minutes: number }[] = [
  { label: '20m', minutes: 20 },
  { label: '45m', minutes: 45 },
  { label: '1h', minutes: 60 },
  { label: 'off', minutes: 0 },
];

export function SoundsScreen({ onBack, onSafe }: SoundsScreenProps) {
  const [soundIndex, setSoundIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [timer, setTimer] = useState(1); // default 45m

  const sound = SOUNDS[soundIndex];
  const span = TIMER_SPANS[timer];

  return (
    <Screen
      label="sounds"
      glyph={<IconMoon stroke={v2.accent} />}
      onBack={onBack}
      onSafe={onSafe}
      centered
      contentStyle={{ paddingTop: 0 }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          maxWidth: 320,
          margin: '0 auto',
        }}
      >
        {/* THE ONE THING — the play disc */}
        <button
          type="button"
          aria-label={playing ? 'pause sound' : 'play sound'}
          aria-pressed={playing}
          onClick={() => setPlaying((p) => !p)}
          style={{
            boxSizing: 'border-box',
            width: 200,
            height: 200,
            borderRadius: '50%',
            border: 'none',
            padding: 0,
            background:
              'radial-gradient(circle at 50% 44%,#F2EEDF 0%,#EFE9D8 60%,#EAE2D4 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            boxShadow: '0 18px 40px rgba(42,38,34,.1)',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {/* the soft concentric sound-rings */}
          <svg
            width={168}
            height={168}
            viewBox="0 0 168 168"
            fill="none"
            style={{ position: 'absolute' }}
            aria-hidden
          >
            <circle cx="84" cy="84" r="78" stroke={v2.sage} strokeWidth={1.4} opacity={playing ? 0.3 : 0.22} />
            <circle cx="84" cy="84" r="62" stroke={v2.sage} strokeWidth={1.4} opacity={playing ? 0.42 : 0.34} />
            <circle cx="84" cy="84" r="46" stroke={v2.sage} strokeWidth={1.4} opacity={playing ? 0.58 : 0.5} />
          </svg>
          {/* the amber play / pause glyph */}
          <span
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: v2.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1,
              boxShadow: '0 12px 28px rgba(201,146,62,.34)',
            }}
          >
            {playing ? (
              <IconPause size={24} fill="#fff" />
            ) : (
              <IconPlay size={24} fill="#fff" />
            )}
          </span>
        </button>

        {/* the sound name + kind */}
        <div
          style={{
            marginTop: 36,
            fontSize: 30,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.025em',
          }}
        >
          {sound.name}
        </div>
        <div
          style={{
            marginTop: 7,
            fontSize: 13,
            color: v2.mute,
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          {sound.kind}
        </div>

        {/* the 3-dot sound switcher */}
        <div style={{ marginTop: 22, display: 'flex', gap: 9 }}>
          {SOUNDS.map((s, i) => (
            <button
              key={s.name}
              type="button"
              aria-label={`switch to ${s.name}`}
              aria-pressed={i === soundIndex}
              onClick={() => setSoundIndex(i)}
              style={{
                width: 7,
                height: 7,
                padding: 0,
                borderRadius: '50%',
                border: 'none',
                background: i === soundIndex ? v2.ink : v2.line,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            />
          ))}
        </div>

        {/* the soft sleep timer */}
        <div style={{ marginTop: 46, width: '100%' }}>
          <div
            style={{
              fontSize: 11,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              textAlign: 'center',
            }}
          >
            sleep timer
          </div>
          <div
            style={{
              marginTop: 15,
              display: 'flex',
              justifyContent: 'center',
              gap: 9,
            }}
          >
            {TIMER_SPANS.map((t, i) => {
              const on = i === timer;
              return (
                <button
                  key={t.label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTimer(i)}
                  style={{
                    boxSizing: 'border-box',
                    border: `1px solid ${on ? v2.accent : v2.line}`,
                    background: on ? '#FCF6EA' : v2.card,
                    borderRadius: 16,
                    padding: '9px 15px',
                    fontSize: 14,
                    color: v2.ink,
                    fontWeight: on ? 600 : 500,
                    letterSpacing: '-0.01em',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div
            style={{
              marginTop: 16,
              fontSize: 12,
              color: v2.mute,
              fontWeight: 400,
              textAlign: 'center',
            }}
          >
            {span.minutes > 0 ? (
              <>
                fades out in <b style={{ color: v2.ink, fontWeight: 600 }}>{span.label}</b>,
                gently &mdash; no hard stop.
              </>
            ) : (
              'no timer — the sound plays until you stop it.'
            )}
          </div>
        </div>
      </div>
    </Screen>
  );
}
