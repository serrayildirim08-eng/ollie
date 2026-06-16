/**
 * FocusTimer — Pomodoro / deep-work timer for the work module.
 *
 * States: idle → running → paused → done
 * Stop from running/paused → idle (no record written; partial sessions are
 * not focus sessions per the data model).
 *
 * On finish:
 *   1. Writes a FocusSessionData row via events.addFocus().
 *   2. Fires window CustomEvent 'ollie:notify' for the notification adapter.
 *
 * Brown noise: toggled via a quiet glyph button. Asset at
 * apps/native/public/assets/audio/brown-noise.m4a (ffmpeg-generated 120s
 * constant-level loop), served at /assets/audio/brown-noise.m4a and looped
 * at 0.35 volume while a session runs.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Stack } from '../../layout';
import { Text } from '../../ui';
import { fonts, fontSizes, letterSpacings } from '../../theme/tokens';
import { events } from './repo';
import { NotifyPrimeLine } from '../../notify/NotifyPrimeLine';

// ─── constants ────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: '25 min', value: 25 },
  { label: '50 min', value: 50 },
] as const;

const MIN_CUSTOM = 1;
const MAX_CUSTOM = 180;

const DONE_DISPLAY_MS = 3000; // how long the "complete" state shows before reset

const SMCP: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: letterSpacings.caps,
};

// ─── types ────────────────────────────────────────────────────────────────────

type TimerState = 'idle' | 'running' | 'paused' | 'done';

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function clampCustom(raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return MIN_CUSTOM;
  return Math.min(MAX_CUSTOM, Math.max(MIN_CUSTOM, n));
}

function fireNotify(durationMin: number, project: string | null): void {
  const proj = project?.trim() || null;
  const body = proj
    ? `${durationMin}m on ${proj} · logged`
    : `${durationMin}m · logged`;
  window.dispatchEvent(
    new CustomEvent('ollie:notify', {
      detail: { title: 'focus complete', body },
    }),
  );
}

// ─── component ────────────────────────────────────────────────────────────────

export interface FocusTimerProps {
  /** Called after a completed session is written. Parent can refresh data. */
  onSessionLogged?: () => void;
}

export function FocusTimer({ onSessionLogged }: FocusTimerProps): JSX.Element {
  const [selectedPreset, setSelectedPreset] = useState<25 | 50 | 'custom'>(25);
  const [customInput, setCustomInput] = useState('');
  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [project, setProject] = useState('');
  const [lastProject, setLastProject] = useState('');
  const [noiseOn, setNoiseOn] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noiseRef = useRef<HTMLAudioElement | null>(null);
  const projectId = useId();
  const customId = useId();

  // ── derived ──────────────────────────────────────────────────────────────

  const chosenDuration =
    selectedPreset === 'custom'
      ? clampCustom(customInput || '25')
      : selectedPreset;

  // Seconds for the chosen duration (recomputed only when idle).
  const idleTotalSeconds = chosenDuration * 60;

  // ── audio ─────────────────────────────────────────────────────────────────
  // Brown noise asset lives at apps/native/public/assets/audio/brown-noise.m4a
  // (ffmpeg-generated, 120s constant-level loop), served at /assets/audio/.
  const NOISE_AVAILABLE = true;

  useEffect(() => {
    if (!NOISE_AVAILABLE) return;
    if (noiseOn && timerState === 'running') {
      if (!noiseRef.current) {
        noiseRef.current = new Audio('/assets/audio/brown-noise.m4a');
        noiseRef.current.loop = true;
        noiseRef.current.volume = 0.35;
      }
      void noiseRef.current.play().catch(() => {
        // autoplay may be blocked; silently ignore
      });
    } else {
      noiseRef.current?.pause();
    }
  }, [noiseOn, timerState, NOISE_AVAILABLE]);

  // Pause noise when paused / stopped
  useEffect(() => {
    if (timerState !== 'running') {
      noiseRef.current?.pause();
    }
  }, [timerState]);

  // ── countdown ─────────────────────────────────────────────────────────────

  const stopInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopInterval();
      noiseRef.current?.pause();
    };
  }, [stopInterval]);

  useEffect(() => {
    if (timerState !== 'running') {
      stopInterval();
      return;
    }

    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          // Will hit 0 — completion handled in the effect below via state
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return stopInterval;
  }, [timerState, stopInterval]);

  // When seconds hit 0 while running → trigger completion
  useEffect(() => {
    if (timerState !== 'running' || secondsLeft !== 0) return;

    stopInterval();

    const proj = project.trim() || null;
    if (proj) setLastProject(proj);

    // write record async, don't block UI
    void events
      .addFocus({ durationMin: chosenDuration, project: proj })
      .then(() => {
        fireNotify(chosenDuration, proj);
        onSessionLogged?.();
      })
      .catch((err: unknown) => {
        console.error('[FocusTimer] addFocus failed', err);
      });

    setTimerState('done');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerState, secondsLeft]);

  // Auto-reset: once in 'done' state, return to idle after DONE_DISPLAY_MS
  useEffect(() => {
    if (timerState !== 'done') return;
    const resetDuration = chosenDuration;
    const t = setTimeout(() => {
      setTimerState('idle');
      setSecondsLeft(resetDuration * 60);
    }, DONE_DISPLAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerState]);

  // ── handlers ──────────────────────────────────────────────────────────────

  const handlePreset = (v: 25 | 50 | 'custom') => {
    if (timerState !== 'idle') return;
    setSelectedPreset(v);
    if (v !== 'custom') {
      setSecondsLeft(v * 60);
    }
  };

  const handleCustomChange = (raw: string) => {
    setCustomInput(raw);
    if (selectedPreset === 'custom') {
      const clamped = clampCustom(raw || '25');
      setSecondsLeft(clamped * 60);
    }
  };

  const handleStart = () => {
    if (timerState === 'idle') {
      setSecondsLeft(idleTotalSeconds);
      setTimerState('running');
    }
  };

  const handlePause = () => {
    if (timerState === 'running') setTimerState('paused');
  };

  const handleResume = () => {
    if (timerState === 'paused') setTimerState('running');
  };

  const handleStop = () => {
    if (timerState === 'running' || timerState === 'paused') {
      stopInterval();
      setTimerState('idle');
      setSecondsLeft(idleTotalSeconds);
    }
  };

  // ── display values ────────────────────────────────────────────────────────

  const displaySeconds =
    timerState === 'idle' ? idleTotalSeconds : secondsLeft;

  const isDimmed = timerState === 'paused';
  const isDone = timerState === 'done';
  const isIdle = timerState === 'idle';
  const isRunning = timerState === 'running';

  return (
    <Stack gap={24} style={{ width: '100%' }}>
      {/* ── preset row ─────────────────────────────────────────────────── */}
      <Stack gap={12}>
        <Text
          scale="caption"
          color="var(--ollie-color-ink-faint)"
          style={SMCP}
          as="span"
        >
          duration
        </Text>
        <div
          role="group"
          aria-label="Focus duration presets"
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
        >
          {PRESETS.map((p) => (
            <PresetChip
              key={p.value}
              label={p.label}
              active={selectedPreset === p.value}
              disabled={!isIdle}
              onClick={() => handlePreset(p.value)}
            />
          ))}
          <PresetChip
            label="custom"
            active={selectedPreset === 'custom'}
            disabled={!isIdle}
            onClick={() => handlePreset('custom')}
          />
          {selectedPreset === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label
                htmlFor={customId}
                style={{
                  ...SMCP,
                  fontSize: fontSizes.caption,
                  color: 'var(--ollie-color-ink-faint)',
                }}
              >
                min
              </label>
              <input
                id={customId}
                type="number"
                min={MIN_CUSTOM}
                max={MAX_CUSTOM}
                value={customInput}
                disabled={!isIdle}
                onChange={(e) => handleCustomChange(e.target.value)}
                aria-label="Custom duration in minutes"
                style={{
                  width: 56,
                  fontFamily: fonts.sans,
                  fontSize: fontSizes.body,
                  color: 'var(--ollie-color-ink)',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--ollie-color-hairline)',
                  padding: '2px 4px',
                  outline: 'none',
                  textAlign: 'center',
                }}
              />
            </div>
          )}
        </div>
      </Stack>

      {/* ── project label ──────────────────────────────────────────────── */}
      <Stack gap={8}>
        <label
          htmlFor={projectId}
          style={{
            ...SMCP,
            fontSize: fontSizes.caption,
            color: 'var(--ollie-color-ink-faint)',
            display: 'block',
          }}
        >
          project
        </label>
        <input
          id={projectId}
          type="text"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          placeholder={lastProject || 'optional'}
          maxLength={80}
          style={{
            fontFamily: fonts.sans,
            fontSize: fontSizes.body,
            color: 'var(--ollie-color-ink)',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--ollie-color-hairline)',
            padding: '4px 0',
            width: '100%',
            outline: 'none',
          }}
        />
      </Stack>

      {/* ── time display ───────────────────────────────────────────────── */}
      <div
        style={{
          borderTop: '1px solid var(--ollie-color-hairline)',
          borderBottom: '1px solid var(--ollie-color-hairline)',
          padding: '32px 0',
          textAlign: 'center',
        }}
      >
        {isDone ? (
          <span
            aria-live="polite"
            style={{
              fontFamily: fonts.serif,
              fontSize: fontSizes.h2,
              color: 'var(--ollie-color-sage)',
              letterSpacing: letterSpacings.body,
            }}
          >
            complete
          </span>
        ) : (
          <span
            aria-live="off"
            aria-label={`${Math.floor(displaySeconds / 60)} minutes ${displaySeconds % 60} seconds remaining`}
            style={{
              fontFamily: fonts.serif,
              fontSize: fontSizes.display, // 64px per tokens
              color: isDimmed ? 'var(--ollie-color-ink-faint)' : 'var(--ollie-color-ink)',
              letterSpacing: letterSpacings.display,
              // tabular nums so digits don't jitter
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              transition: 'color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
              display: 'block',
            }}
          >
            {formatTime(displaySeconds)}
          </span>
        )}
      </div>

      {/* ── controls ───────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        {isIdle && (
          <ControlButton
            onClick={handleStart}
            variant="start"
            aria-label="Start focus session"
          >
            start
          </ControlButton>
        )}

        {isRunning && (
          <>
            <ControlButton
              onClick={handlePause}
              variant="ink"
              aria-label="Pause focus session"
            >
              pause
            </ControlButton>
            <ControlButton
              onClick={handleStop}
              variant="ghost"
              aria-label="Stop and discard focus session"
            >
              stop
            </ControlButton>
          </>
        )}

        {timerState === 'paused' && (
          <>
            <ControlButton
              onClick={handleResume}
              variant="start"
              aria-label="Resume focus session"
            >
              resume
            </ControlButton>
            <ControlButton
              onClick={handleStop}
              variant="ghost"
              aria-label="Stop and discard focus session"
            >
              stop
            </ControlButton>
          </>
        )}

        {isDone && (
          <span
            style={{
              ...SMCP,
              fontSize: fontSizes.caption,
              color: 'var(--ollie-color-ink-faint)',
            }}
          >
            logged
          </span>
        )}

        {/* brown noise toggle — hidden until asset is available */}
        {NOISE_AVAILABLE && !isDone && (
          <button
            type="button"
            onClick={() => setNoiseOn((v) => !v)}
            aria-pressed={noiseOn}
            aria-label={noiseOn ? 'Disable brown noise' : 'Enable brown noise'}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              padding: '6px 8px',
              cursor: 'pointer',
              color: noiseOn ? 'var(--ollie-color-sage)' : 'var(--ollie-color-ink-faint)',
              fontSize: 16,
              lineHeight: 1,
              transition: 'color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
            }}
          >
            {/* audio waveform bars */}
            <NoiseGlyph active={noiseOn} />
          </button>
        )}
      </div>

      <NotifyPrimeLine label="allow ollie to ping you when a session ends?" />
    </Stack>
  );
}

// ─── sub-components ───────────────────────────────────────────────────────────

function PresetChip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{
        appearance: 'none',
        background: 'transparent',
        border: `1px solid ${active ? 'var(--ollie-color-sage)' : 'var(--ollie-color-hairline)'}`,
        padding: '4px 12px',
        fontFamily: fonts.sans,
        fontSize: fontSizes.caption,
        color: active ? 'var(--ollie-color-sage)' : 'var(--ollie-color-ink-soft)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && !active ? 0.45 : 1,
        transition: 'border-color 120ms, color 120ms',
        letterSpacing: letterSpacings.body,
      }}
    >
      {label}
    </button>
  );
}

type ControlVariant = 'start' | 'ink' | 'ghost';

function ControlButton({
  children,
  onClick,
  variant,
  'aria-label': ariaLabel,
}: {
  children: string;
  onClick: () => void;
  variant: ControlVariant;
  'aria-label': string;
}): JSX.Element {
  const borderColor =
    variant === 'start' ? 'var(--ollie-color-sage)' : variant === 'ink' ? 'var(--ollie-color-ink-soft)' : 'var(--ollie-color-hairline)';
  const textColor =
    variant === 'start' ? 'var(--ollie-color-sage)' : variant === 'ink' ? 'var(--ollie-color-ink)' : 'var(--ollie-color-ink-faint)';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        appearance: 'none',
        background: 'transparent',
        border: `1px solid ${borderColor}`,
        padding: '8px 20px',
        fontFamily: fonts.sans,
        fontSize: fontSizes.small,
        fontVariantCaps: 'all-small-caps',
        letterSpacing: letterSpacings.caps,
        color: textColor,
        cursor: 'pointer',
        minHeight: 44,
        transition: 'opacity 120ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
    >
      {children}
    </button>
  );
}

/** Quiet audio-waveform glyph for the brown noise toggle. */
function NoiseGlyph({ active }: { active: boolean }): JSX.Element {
  return (
    <svg
      width={16}
      height={14}
      viewBox="0 0 16 14"
      aria-hidden
      fill="none"
      style={{ display: 'block' }}
    >
      <rect x="0" y="4" width="2" height="6" rx="1" fill="currentColor" opacity={active ? 1 : 0.5} />
      <rect x="3.5" y="1" width="2" height="12" rx="1" fill="currentColor" opacity={active ? 1 : 0.5} />
      <rect x="7" y="3" width="2" height="8" rx="1" fill="currentColor" opacity={active ? 1 : 0.5} />
      <rect x="10.5" y="0" width="2" height="14" rx="1" fill="currentColor" opacity={active ? 1 : 0.5} />
      <rect x="14" y="4" width="2" height="6" rx="1" fill="currentColor" opacity={active ? 1 : 0.5} />
    </svg>
  );
}
