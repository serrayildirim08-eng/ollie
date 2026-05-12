import React, { useEffect, useRef, useState } from 'react';
import { Burhan3D } from '../components/Burhan3D';
import { BrainDumpInput } from '../components/BrainDumpInput';
import { getSkyVideoSrc } from '../lib/skyVideo';
import { store } from '../store';

// Sky orb — glowing circle varying by time of day
function SkyOrb({ hour }: { hour: number }) {
  const isNight = hour < 6 || hour >= 21;
  const isDawnDusk = (hour >= 5 && hour < 7) || (hour >= 18 && hour < 21);

  const size = isNight ? 110 : isDawnDusk ? 120 : 130;

  const gradient = isNight
    ? 'radial-gradient(circle, rgba(255,250,230,0.95) 0%, rgba(230,220,190,0.7) 40%, transparent 70%)'
    : isDawnDusk
    ? 'radial-gradient(circle, rgba(255,190,80,0.95) 0%, rgba(220,100,40,0.6) 40%, transparent 70%)'
    : 'radial-gradient(circle, rgba(255,230,100,0.98) 0%, rgba(255,200,50,0.7) 40%, transparent 70%)';

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 32,
        right: 32,
        width: size * 2.5,
        height: size * 2.5,
        zIndex: 5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: gradient,
        }}
      />
    </div>
  );
}

// Time-tracker pill (right side, above brain dump)
// Credibility audit NH3: previously the timer counted seconds and threw
// them away. Now appends to `work.focus_log` on stop so the dashboard's
// "tracked today" stat and the work module's totals reflect it.
function TimeTracker() {
  const [active, setActive] = useState(false);
  const [sec, setSec] = useState(0);
  const startTsRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (active) {
      startTsRef.current = Date.now();
      timerRef.current = setInterval(() => setSec((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      // Append to work.focus_log on stop using the canonical shape
      // WorkModule reads: { at, duration_min }. Audit-fix #2.
      // Skip zero-duration accidental clicks.
      if (startTsRef.current && sec > 0) {
        try {
          const duration_min = Math.round((Date.now() - startTsRef.current) / 60_000);
          if (duration_min >= 1) {
            const log = store.get<Array<{ at: number; duration_min: number; source?: string }>>('work', 'focus_log', []) ?? [];
            store.set('work', 'focus_log', [...log, { at: startTsRef.current, duration_min, source: 'home-timer' }]);
          }
        } catch { /* non-fatal */ }
        startTsRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const pillStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.18)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 999,
    padding: '7px 14px',
    fontFamily: "'DM Mono', monospace",
    fontSize: 10,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: '0.16em',
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    lineHeight: 1,
  };

  return (
    <div style={{ position: 'absolute', bottom: 96, right: 32, zIndex: 10 }}>
      {!active ? (
        <button
          type="button"
          onClick={() => { setActive(true); setSec(0); }}
          style={pillStyle}
          aria-label="start time tracker"
        >
          ▶ track time
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setActive(false)}
          style={pillStyle}
          aria-label="stop time tracker"
        >
          ■ {fmt(sec)}
        </button>
      )}
    </div>
  );
}

export interface HomeScreenProps {
  onNavigate: (to: 'dashboard' | 'garden' | 'settings') => void;
  onBrainDump: (text: string) => void;
}

export function HomeScreen({ onNavigate, onBrainDump }: HomeScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hour = new Date().getHours();
  const sky = getSkyVideoSrc(hour);

  useEffect(() => {
    if (videoRef.current) {
      try {
        videoRef.current.playbackRate = 0.25;
      } catch (_) {
        // Chrome minimum is 0.0625; 0.25 is safe but guard anyway
      }
    }
  }, []);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        background: '#1a2030', // fallback while video loads
      }}
    >
      {/* Sky video — full viewport · local-first, CDN fallback on error */}
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        src={sky.local}
        onError={(e) => {
          const el = e.currentTarget;
          if (el.src.endsWith(sky.local)) el.src = sky.cdn;
        }}
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '-5%',
          left: '-5%',
          width: '110%',
          height: '110%',
          objectFit: 'cover',
          zIndex: 0,
        }}
      />

      {/* Dark gradient overlay — bottom 45% */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          height: '45%',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.55))',
          zIndex: 1,
        }}
      />

      {/* Location / weather — top left (hardcoded placeholder) */}
      <div style={{ position: 'absolute', top: 52, left: 32, zIndex: 10 }}>
        <div
          style={{
            background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRadius: 20,
            padding: '8px 16px',
            border: '1px solid rgba(255,255,255,0.18)',
          }}
        >
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.7)',
              textShadow: '0 1px 8px rgba(0,0,0,0.5)',
            }}
          >
            ISTANBUL · 14° · CLEAR
          </span>
        </div>
      </div>

      {/* Sky orb — top right */}
      <SkyOrb hour={hour} />

      {/* Settings entry — top-right corner, quiet kicker glyph (F4) */}
      <button
        type="button"
        onClick={() => onNavigate('settings')}
        aria-label="open settings"
        style={{
          position: 'absolute',
          top: 52,
          right: 32,
          zIndex: 12,
          background: 'rgba(255,255,255,0.12)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 20,
          padding: '8px 16px',
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.7)',
          cursor: 'pointer',
        }}
      >
        settings
      </button>

      {/* "what's up?" headline — center */}
      <div
        style={{
          position: 'absolute',
          top: '18%',
          left: 0,
          right: 0,
          zIndex: 10,
          textAlign: 'center',
          animation: 'fadeUp 600ms ease-out both',
        }}
      >
        <span
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 48,
            color: '#F5F4F0',
            textShadow: '0 2px 24px rgba(0,0,0,0.6), 0 1px 6px rgba(0,0,0,0.4)',
            lineHeight: 1.02,
            fontWeight: 400,
          }}
        >
          what&apos;s{' '}
        </span>
        <span
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 48,
            color: '#7C9E87',
            textShadow: '0 2px 24px rgba(0,0,0,0.6), 0 1px 6px rgba(0,0,0,0.4)',
            lineHeight: 1.02,
            fontStyle: 'italic',
            fontWeight: 400,
          }}
        >
          up?
        </span>
      </div>

      {/* Time tracker pill */}
      <TimeTracker />

      {/* Burhan — bottom left */}
      <div
        style={{ position: 'absolute', bottom: 40, left: 10, zIndex: 10, cursor: 'pointer' }}
        role="button"
        tabIndex={0}
        aria-label="go to garden"
        onClick={() => onNavigate('garden')}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate('garden'); }}
      >
        <Burhan3D height={220} width={220} />
      </div>

      {/* Dashboard hint — bottom right */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: 8,
          right: 28,
          zIndex: 16,
          fontFamily: "'DM Mono', monospace",
          fontSize: 9,
          color: 'rgba(255,255,255,0.3)',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          pointerEvents: 'none',
        }}
      >
        DASHBOARD
      </div>

      {/* Brain dump input — bottom fixed, dashboard grid button */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          padding: '16px 24px 28px',
          zIndex: 15,
          boxSizing: 'border-box',
          display: 'flex',
          gap: 10,
          alignItems: 'center',
        }}
      >
        {/* BrainDumpInput wraps itself in position:fixed — use a local inline
            input here so it sits within the relative home container */}
        <BrainDumpInputInline onSubmit={onBrainDump} />
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          aria-label="open dashboard"
          style={{
            flexShrink: 0,
            width: 46,
            height: 46,
            background: 'rgba(255,255,255,0.18)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.22)',
            borderRadius: 14,
            color: 'rgba(255,255,255,0.75)',
            fontSize: 18,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'DM Mono', monospace",
          }}
        >
          ⊞
        </button>
      </div>
    </div>
  );
}

// Inline version of BrainDumpInput that sits inside the absolute bar
// (the shared BrainDumpInput is position:fixed which would escape the home container)
interface InlineProps {
  onSubmit: (text: string) => void;
}
function BrainDumpInputInline({ onSubmit }: InlineProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit() {
    const text = value.trim();
    if (!text) return;
    setValue('');
    onSubmit(text);
    inputRef.current?.focus();
  }

  return (
    <div
      role="search"
      aria-label="brain dump"
      style={{
        flex: 1,
        background: 'rgba(255,255,255,0.16)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 14,
        display: 'flex',
        alignItems: 'center',
        padding: '6px 8px 6px 20px',
        gap: 12,
      }}
    >
      <input
        ref={inputRef}
        type="text"
        data-brain-dump="true"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        placeholder="what's on your mind..."
        aria-label="type a note and press enter"
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontFamily: "'DM Mono', monospace",
          fontSize: 13,
          color: 'rgba(255,255,255,0.9)',
          caretColor: 'rgba(255,255,255,0.9)',
        }}
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!value.trim()}
        aria-label="submit"
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 999,
          padding: '6px 14px',
          fontFamily: "'DM Mono', monospace",
          fontSize: 9,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: value.trim() ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.25)',
          cursor: value.trim() ? 'pointer' : 'default',
        }}
      >
        enter
      </button>
    </div>
  );
}
