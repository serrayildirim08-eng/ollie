/**
 * SleepSoundPlayer — wind-down audio player for the sleep module.
 *
 * 6 sounds in a 2×3 grid. Real placeholders: brown-noise, rain, ocean (silent CC0 stubs
 * — swap with licensed assets when available). Stubbed: white-noise, pink-noise, fire.
 *
 * Autoplay quirk: browsers block audio without a prior user gesture. We initialise
 * Howler lazily on the first button tap (no eagerly-unlocked AudioContext) so Chrome's
 * autoplay policy is never hit.
 *
 * Visual language: matches SleepModule — bone palette, Courier New, no frosted glass
 * border (the module itself is not a sky/overlay surface). The FrostedCard is used for
 * the outer container because it is spec-required, but the sleep palette overrides tint.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Howl } from 'howler';
import { FrostedCard } from './FrostedCard';

// ─── palette (mirrors SleepModule C tokens) ──────────────────────────────────

const C = {
  bone:      '#F2EEE4',
  ink:       '#14130F',
  inkSoft:   '#4B4740',
  inkFaint:  '#7C7770',
  inkGhost:  '#C8C4BA',
  rule:      'rgba(20,19,15,0.10)',
  ruleSoft:  'rgba(20,19,15,0.06)',
  accent:    '#4F6E5B',
  warn:      '#B89556',
} as const;

const COURIER = "'Courier New', Courier, monospace";

// ─── sound definitions ────────────────────────────────────────────────────────

interface SoundDef {
  id:    string;
  label: string;
  src:   string | null;   // null = stubbed, no asset yet
  stub:  boolean;
}

const SOUNDS: SoundDef[] = [
  // Row 1
  { id: 'brown-noise', label: 'brown noise', src: '/audio/brown-noise.mp3', stub: false },
  // TODO(license): replace null with real white-noise .mp3 path once licensed
  { id: 'white-noise', label: 'white noise', src: null,                    stub: true  },
  // TODO(license): replace null with real pink-noise .mp3 path once licensed
  { id: 'pink-noise',  label: 'pink noise',  src: null,                    stub: true  },
  // Row 2
  { id: 'rain',        label: 'rain',        src: '/audio/rain.mp3',        stub: false },
  { id: 'ocean',       label: 'ocean',       src: '/audio/ocean.mp3',       stub: false },
  // TODO(license): replace null with real fire .mp3 path once licensed
  { id: 'fire',        label: 'fire',        src: null,                    stub: true  },
];

// ─── sleep timer chips ────────────────────────────────────────────────────────

interface TimerChip {
  label: string;
  minutes: number;
}

const TIMER_CHIPS: TimerChip[] = [
  { label: '5 min',  minutes: 5  },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '60 min', minutes: 60 },
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── component ────────────────────────────────────────────────────────────────

export function SleepSoundPlayer() {
  // Currently-playing sound id, or null.
  const [playing, setPlaying]       = useState<string | null>(null);
  // Volume 0–100.
  const [volume, setVolume]         = useState<number>(60);
  // Active timer duration in minutes, or null = none.
  const [timerMinutes, setTimerMinutes] = useState<number | null>(null);
  // Remaining milliseconds when a timer is active.
  const [remaining, setRemaining]   = useState<number>(0);

  // Howl instance cache — keyed by sound id.
  const howlCache = useRef<Record<string, Howl>>({});
  // setTimeout handle for the timer fade.
  const timerHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // setInterval handle for the countdown display.
  const tickHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Timestamp when the timer started (for accurate countdown).
  const timerStartRef = useRef<number>(0);
  // Duration of the active timer in ms (set once on start).
  const timerDurationRef = useRef<number>(0);

  // ── get or create Howl ──────────────────────────────────────────────────

  const getHowl = useCallback((def: SoundDef): Howl | null => {
    if (!def.src) return null;
    if (howlCache.current[def.id]) return howlCache.current[def.id];
    const h = new Howl({
      src:    [def.src],
      loop:   true,
      volume: volume / 100,
    });
    howlCache.current[def.id] = h;
    return h;
  }, [volume]);

  // ── sync volume to all cached Howls ─────────────────────────────────────

  useEffect(() => {
    const v = volume / 100;
    Object.values(howlCache.current).forEach((h) => h.volume(v));
  }, [volume]);

  // ── clear timer helpers ──────────────────────────────────────────────────

  const clearTimer = useCallback(() => {
    if (timerHandleRef.current !== null) {
      clearTimeout(timerHandleRef.current);
      timerHandleRef.current = null;
    }
    if (tickHandleRef.current !== null) {
      clearInterval(tickHandleRef.current);
      tickHandleRef.current = null;
    }
    setTimerMinutes(null);
    setRemaining(0);
  }, []);

  // ── stop the currently playing sound (immediate) ─────────────────────────

  const stopCurrent = useCallback((fadeMs = 300) => {
    if (!playing) return;
    const h = howlCache.current[playing];
    if (h) {
      h.fade(h.volume(), 0, fadeMs);
      setTimeout(() => h.stop(), fadeMs + 20);
    }
    setPlaying(null);
  }, [playing]);

  // ── start the sleep timer ────────────────────────────────────────────────

  const startTimer = useCallback((minutes: number) => {
    clearTimer();
    const durationMs = minutes * 60 * 1000;
    timerStartRef.current    = Date.now();
    timerDurationRef.current = durationMs;
    setTimerMinutes(minutes);
    setRemaining(durationMs);

    // Countdown tick every second.
    tickHandleRef.current = setInterval(() => {
      const elapsed = Date.now() - timerStartRef.current;
      const left    = Math.max(0, timerDurationRef.current - elapsed);
      setRemaining(left);
    }, 1000);

    // On expiry: 5-second fade-out then stop.
    timerHandleRef.current = setTimeout(() => {
      if (tickHandleRef.current !== null) {
        clearInterval(tickHandleRef.current);
        tickHandleRef.current = null;
      }
      setRemaining(0);
      setTimerMinutes(null);

      // Fade-out playing sound over 5s.
      setPlaying((currentlyPlaying) => {
        if (currentlyPlaying) {
          const h = howlCache.current[currentlyPlaying];
          if (h) {
            h.fade(h.volume(), 0, 5000);
            setTimeout(() => h.stop(), 5100);
          }
        }
        return null;
      });
    }, durationMs);
  }, [clearTimer]);

  // ── toggle a sound ───────────────────────────────────────────────────────

  const toggleSound = useCallback((def: SoundDef) => {
    if (def.stub || !def.src) return;

    if (playing === def.id) {
      // Tap same → fade out + stop.
      stopCurrent(300);
      clearTimer();
      return;
    }

    // Stop whatever was playing first.
    if (playing) {
      const prev = howlCache.current[playing];
      if (prev) {
        prev.fade(prev.volume(), 0, 200);
        setTimeout(() => prev.stop(), 220);
      }
    }

    const h = getHowl(def);
    if (!h) return;

    // Set correct volume before play (Howl may have been cached at different vol).
    h.volume(volume / 100);
    h.play();
    setPlaying(def.id);
  }, [playing, stopCurrent, clearTimer, getHowl, volume]);

  // ── cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      clearTimer();
      Object.values(howlCache.current).forEach((h) => { h.stop(); h.unload(); });
    };
  }, [clearTimer]);

  // ─── render ──────────────────────────────────────────────────────────────

  return (
    <FrostedCard
      style={{
        background: 'rgba(242, 238, 228, 0.82)',   // bone tint — matches sleep palette
        border: `1px solid ${C.rule}`,
        borderRadius: 0,                            // sleep module uses sharp edges
        padding: '24px 28px',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
      as="section"
      aria-label="wind-down sounds"
    >
      {/* header row */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 11, letterSpacing: '0.20em', textTransform: 'uppercase',
          color: C.inkSoft, fontWeight: 700, fontFamily: COURIER,
          borderBottom: `1px solid ${C.rule}`, paddingBottom: 10,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>wind-down sounds</span>
          {playing && (
            <span style={{ color: C.accent, fontWeight: 700, letterSpacing: '0.12em' }}>
              playing
            </span>
          )}
        </div>
      </div>

      {/* 2×3 sound grid */}
      <div
        role="group"
        aria-label="sound selection"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          marginBottom: 24,
        }}
      >
        {SOUNDS.map((def) => {
          const isActive  = playing === def.id;
          const isStubbed = def.stub;
          return (
            <button
              key={def.id}
              type="button"
              onClick={() => toggleSound(def)}
              disabled={isStubbed}
              aria-pressed={isActive}
              aria-label={isStubbed ? `${def.label} (coming soon)` : def.label}
              style={{
                fontFamily: COURIER,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'lowercase',
                padding: '14px 10px',
                border: isActive
                  ? `1.5px solid ${C.accent}`
                  : `1.5px solid ${C.rule}`,
                background: isActive
                  ? `rgba(79, 110, 91, 0.08)`
                  : 'transparent',
                color: isStubbed
                  ? C.inkGhost
                  : isActive
                  ? C.accent
                  : C.ink,
                cursor: isStubbed ? 'default' : 'pointer',
                textAlign: 'center',
                transition: 'border-color 120ms ease, color 120ms ease, background 120ms ease',
                // Subtle "disabled" treatment without red/error styling.
                opacity: isStubbed ? 0.45 : 1,
              }}
            >
              {def.label}
              {isStubbed && (
                <span
                  style={{
                    display: 'block',
                    fontSize: 9,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    marginTop: 3,
                    color: C.inkFaint,
                    fontWeight: 400,
                  }}
                >
                  soon
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* volume slider */}
      <div style={{ marginBottom: 22 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 8,
        }}>
          <label
            htmlFor="sleep-volume"
            style={{
              fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
              color: C.inkSoft, fontWeight: 700, fontFamily: COURIER,
            }}
          >
            volume
          </label>
          <span style={{
            fontSize: 12, color: C.inkFaint, fontFamily: COURIER, fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {volume}
          </span>
        </div>
        <input
          id="sleep-volume"
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-valuenow={volume}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="volume"
          style={{
            width: '100%',
            accentColor: C.accent,
            cursor: 'pointer',
            height: 2,
            appearance: 'auto',
          }}
        />
      </div>

      {/* sleep timer */}
      <div>
        <div style={{
          fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
          color: C.inkSoft, fontWeight: 700, fontFamily: COURIER,
          marginBottom: 10,
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        }}>
          <span>sleep timer</span>
          {timerMinutes !== null && (
            <span
              role="timer"
              aria-live="polite"
              aria-label={`timer: ${formatRemaining(remaining)} remaining`}
              style={{
                fontSize: 13, fontVariantNumeric: 'tabular-nums',
                color: C.accent, letterSpacing: '0.08em',
              }}
            >
              {formatRemaining(remaining)}
            </span>
          )}
        </div>

        <div
          role="group"
          aria-label="sleep timer duration"
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
        >
          {TIMER_CHIPS.map((chip) => {
            const isActive = timerMinutes === chip.minutes;
            return (
              <button
                key={chip.minutes}
                type="button"
                onClick={() => {
                  if (isActive) {
                    clearTimer();
                  } else {
                    startTimer(chip.minutes);
                  }
                }}
                aria-pressed={isActive}
                aria-label={`${isActive ? 'cancel' : 'set'} ${chip.label} sleep timer`}
                style={{
                  fontFamily: COURIER,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.10em',
                  textTransform: 'lowercase',
                  padding: '8px 14px',
                  border: isActive ? `1.5px solid ${C.accent}` : `1.5px solid ${C.rule}`,
                  background: isActive ? 'rgba(79, 110, 91, 0.08)' : 'transparent',
                  color: isActive ? C.accent : C.inkSoft,
                  cursor: 'pointer',
                  borderRadius: 999,
                  transition: 'border-color 120ms ease, color 120ms ease',
                }}
              >
                {chip.label}
              </button>
            );
          })}
          {timerMinutes !== null && (
            <button
              type="button"
              onClick={clearTimer}
              aria-label="cancel sleep timer"
              style={{
                fontFamily: COURIER,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.10em',
                textTransform: 'lowercase',
                padding: '8px 14px',
                border: `1.5px solid ${C.rule}`,
                background: 'transparent',
                color: C.inkFaint,
                cursor: 'pointer',
                borderRadius: 999,
              }}
            >
              cancel
            </button>
          )}
        </div>
      </div>
    </FrostedCard>
  );
}
