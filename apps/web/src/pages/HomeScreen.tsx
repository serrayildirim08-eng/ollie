import React, { useEffect, useRef, useState } from 'react';
import { BurhanTree } from '../components/BurhanTree';
import { BrainDumpInput } from '../components/BrainDumpInput';

// Sky video URLs — keyed by condition
const SKY_VIDEOS = {
  clearDay:   'https://assets.mixkit.co/videos/26108/26108-720.mp4',
  clearNight: 'https://assets.mixkit.co/videos/1610/1610-720.mp4',
  sunset:     'https://assets.mixkit.co/videos/4119/4119-720.mp4',
  sunrise:    'https://assets.mixkit.co/videos/51102/51102-720.mp4',
  overcast:   'https://assets.mixkit.co/videos/9680/9680-720.mp4',
} as const;

function getSkyVideo(hour: number): string {
  if (hour >= 5 && hour < 7) return SKY_VIDEOS.sunrise;
  if (hour >= 18 && hour < 20) return SKY_VIDEOS.sunset;
  if (hour >= 7 && hour < 18) return SKY_VIDEOS.clearDay;
  return SKY_VIDEOS.clearNight;
}

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
function TimeTracker() {
  const [active, setActive] = useState(false);
  const [sec, setSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (active) {
      timerRef.current = setInterval(() => setSec((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
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
  onNavigate: (to: 'dashboard' | 'garden') => void;
  onBrainDump: (text: string) => void;
}

export function HomeScreen({ onNavigate, onBrainDump }: HomeScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hour = new Date().getHours();
  const skyUrl = getSkyVideo(hour);

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
      {/* Sky video — full viewport */}
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        src={skyUrl}
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
        style={{ position: 'absolute', bottom: 40, left: 10, zIndex: 10 }}
        role="button"
        tabIndex={0}
        aria-label="go to garden"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onNavigate('garden'); }}
      >
        <BurhanTree
          height={220}
          tone="home"
          waterLevel={60}
          droop={15}
          onClick={() => onNavigate('garden')}
        />
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
