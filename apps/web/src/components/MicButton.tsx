/**
 * MicButton · Sprint 4 · E2
 *
 * Floating mic. Tap to start recording, tap again to stop.
 * Brand voice: subtle waveform, brief transcript preview, no shout.
 */

import React, { useEffect, useRef, useState } from 'react';
import { startVoiceCapture, voiceCaptureSupported } from '../lib/voice-capture';
import { SIRI_CAPTURE_EVENT } from '../lib/capacitor-deeplink';

export interface MicButtonProps {
  onTranscript: (text: string) => void;
  /** Source label for telemetry. */
  source?: 'mic-button' | 'hotkey' | 'siri';
  style?: React.CSSProperties;
}

export function MicButton({ onTranscript, source = 'mic-button', style }: MicButtonProps) {
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<{ stop: () => void } | null>(null);
  const supported = voiceCaptureSupported();

  useEffect(() => () => sessionRef.current?.stop(), []);

  // E3 · Electron hotkey bridge (cmd+ctrl+space → start). No-op on web/iOS.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (typeof window !== 'undefined' ? (window as any) : null);
    const off = g?.ollie?.hotkey?.onHotkey?.(() => { if (!recording) void start(); });
    return () => { if (typeof off === 'function') off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  // Web hotkey · cmd+option+space (Mac) / ctrl+alt+space (Win/Linux).
  // Works in any browser when the page has focus — equivalent to the
  // "hey ollie" Electron globalShortcut for browser users. Combo
  // choice avoids Mac collisions:
  //   - cmd+space  → Spotlight
  //   - cmd+shift+space → input-source switcher (TR/EN)
  //   - cmd+ctrl+space → Character Viewer
  //   - cmd+option+space → free
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.code !== 'Space') return;
      if (!e.altKey) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      // Don't fire while user is typing in an input/textarea
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      e.preventDefault();
      if (recording) stop(); else void start();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  // iOS Siri intent → custom window event. When "Hey Siri, Ollie
  // capture" fires, the AppDelegate opens ollie://capture, the
  // capacitor-deeplink handler dispatches SIRI_CAPTURE_EVENT, and
  // this listener triggers start() the same as the floating mic.
  useEffect(() => {
    function onSiri(): void { if (!recording) void start(); }
    window.addEventListener(SIRI_CAPTURE_EVENT, onSiri as EventListener);
    return () => window.removeEventListener(SIRI_CAPTURE_EVENT, onSiri as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  async function start() {
    if (!supported || recording) return;
    setInterim(''); setError(null); setRecording(true);
    const session = await startVoiceCapture({
      source,
      onInterim: (t) => setInterim(t),
      onFinal: (text) => {
        setRecording(false);
        setInterim('');
        sessionRef.current = null;
        onTranscript(text);
      },
      onError: (reason) => {
        setRecording(false);
        setInterim('');
        sessionRef.current = null;
        setError(reason);
        setTimeout(() => setError(null), 3000);
      },
    });
    sessionRef.current = session;
  }

  function stop() {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setRecording(false);
  }

  if (!supported) return null;

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        // Sit clear above the bottom-fixed BrainDumpInput bar AND the
        // iPhone home indicator. ~78px is the brain-dump bar height;
        // env() adds the home-indicator inset on top.
        bottom: 'calc(78px + env(safe-area-inset-bottom, 0px))',
        zIndex: 41,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 6,
        ...style,
      }}
    >
      {interim && (
        <div style={transcriptStyle}>{interim.slice(0, 80)}</div>
      )}
      {error && <div style={errorStyle}>{error}</div>}
      <button
        type="button"
        aria-label={recording ? 'stop recording' : 'start voice capture'}
        aria-pressed={recording}
        onClick={recording ? stop : start}
        style={{
          ...buttonStyle,
          background: recording ? 'rgba(124, 158, 135, 0.95)' : 'rgba(255,255,255,0.6)',
          color: recording ? '#F5F4F0' : '#111111',
          animation: recording ? 'mic-pulse 1.4s ease-in-out infinite' : undefined,
        }}
      >
        {recording ? <StopIcon /> : <MicIcon />}
      </button>
      <style>{`
        @keyframes mic-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(124, 158, 135, 0.35); }
          50%      { box-shadow: 0 0 0 12px rgba(124, 158, 135, 0); }
        }
      `}</style>
    </div>
  );
}

// Editorial SVG glyphs — replaces the emoji button (NL3).
// Hairline strokes match the design system's quiet feel.
function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="12" y1="18" x2="12" y2="21" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

const buttonStyle: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 28,
  border: '1px solid rgba(0,0,0,0.12)',
  cursor: 'pointer',
  backdropFilter: 'blur(16px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const transcriptStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.92)',
  border: '1px solid rgba(0,0,0,0.08)',
  borderRadius: 14,
  padding: '8px 12px',
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 13,
  color: '#111111',
  maxWidth: 280,
  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
};

const errorStyle: React.CSSProperties = {
  ...transcriptStyle,
  color: '#8A4B2C',
  fontFamily: "'DM Mono', monospace",
  fontSize: 11,
  letterSpacing: '0.06em',
};
