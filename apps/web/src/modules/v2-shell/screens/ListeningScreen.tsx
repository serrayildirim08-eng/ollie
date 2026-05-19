/**
 * v2-shell · ListeningScreen — live voice capture (listening.html)
 *
 * DIRECTION.md: "Listening is the voice-capture screen." It is shown as a
 * full-screen overlay while a speech session is running — a dark canvas,
 * one breathing sage ring, a live waveform, a glyph-X to dismiss. Zero
 * words (SCREENS.md group 1).
 *
 * It is wired to the REAL voice capture: `startVoiceCapture` from
 * `lib/voice-capture.ts` (the speech-plugin fix is already in place). On
 * the final transcript the screen calls `onCaptured(text)` — the shell
 * routes it through the same brain-dump pipeline as a typed throw and
 * slides to Caught. The X (or an error, or an empty result) calls
 * `onCancel` and returns to Throw.
 *
 * The session is started once on mount and stopped on unmount, so the
 * screen's lifetime IS the recording session.
 */
import { useEffect, useRef, useState } from 'react';
import { startVoiceCapture, type VoiceCaptureSession } from '../../../lib/voice-capture';

const box = { boxSizing: 'border-box' as const };

export interface ListeningScreenProps {
  /** a final transcript landed — route it like a typed throw */
  onCaptured: (text: string) => void;
  /** the user dismissed, or capture failed / produced nothing */
  onCancel: () => void;
}

export function ListeningScreen({ onCaptured, onCancel }: ListeningScreenProps) {
  // live interim text — shown to nobody (Listening is wordless) but kept
  // so a session that ends without a `final` can still salvage interim.
  const interimRef = useRef('');
  const [, force] = useState(0);

  // stable refs so the mount-once effect never restarts the session
  const capturedRef = useRef(onCaptured);
  const cancelRef = useRef(onCancel);
  capturedRef.current = onCaptured;
  cancelRef.current = onCancel;

  const sessionRef = useRef<VoiceCaptureSession | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    function settle(text: string) {
      if (settledRef.current) return;
      settledRef.current = true;
      const t = text.trim();
      if (t) capturedRef.current(t);
      else cancelRef.current();
    }

    startVoiceCapture({
      source: 'mic-button',
      onInterim: (t) => {
        interimRef.current = t;
        if (!cancelled) force((n) => n + 1);
      },
      onFinal: (t) => {
        settle(t || interimRef.current);
      },
      onError: () => {
        // a permission denial or unsupported platform — fall back to Throw
        if (!settledRef.current) {
          settledRef.current = true;
          cancelRef.current();
        }
      },
    })
      .then((session) => {
        if (cancelled) {
          session.stop();
          return;
        }
        sessionRef.current = session;
      })
      .catch(() => {
        if (!settledRef.current) {
          settledRef.current = true;
          cancelRef.current();
        }
      });

    return () => {
      cancelled = true;
      sessionRef.current?.stop();
    };
  }, []);

  const dismiss = () => {
    // stopping the session fires `onFinal` with whatever was heard; if it
    // does not, settle on the interim. Either way Listening unmounts.
    sessionRef.current?.stop();
    if (!settledRef.current) {
      settledRef.current = true;
      const t = interimRef.current.trim();
      if (t) capturedRef.current(t);
      else cancelRef.current();
    }
  };

  return (
    <div
      data-testid="v2-listening"
      style={{
        ...box,
        position: 'absolute',
        inset: 0,
        background: '#15130F',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        zIndex: 40,
      }}
    >
      {/* one breathing sage ring — the only thing */}
      <div style={{ ...box, position: 'relative', width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {[0, 0.5, 1].map((delay, i) => (
          <span
            // three concentric rings, fixed
            key={`ring-${delay}`}
            aria-hidden
            style={{
              ...box,
              position: 'absolute',
              width: 120,
              height: 120,
              borderRadius: '50%',
              border: '1.5px solid rgba(91,140,126,.6)',
              opacity: i === 0 ? 1 : i === 1 ? 0.5 : 0.25,
              animation: `v2ShellBreathe 4s ease-in-out infinite ${delay}s`,
            }}
          />
        ))}
        <span
          aria-hidden
          style={{
            ...box,
            width: 96,
            height: 96,
            borderRadius: '50%',
            background: '#5B8C7E',
            boxShadow: '0 0 60px rgba(91,140,126,.55)',
          }}
        />
      </div>

      {/* live waveform — wordless feedback */}
      <div style={{ ...box, marginTop: 80, display: 'flex', gap: 5, alignItems: 'center', height: 40 }} aria-hidden>
        {[14, 30, 20, 38, 24, 16, 32].map((h, i) => (
          <span
            key={`wave-${i}`}
            style={{
              ...box,
              width: 4,
              height: h,
              borderRadius: 2,
              background: 'rgba(250,246,239,.7)',
              animation: `v2ShellWave ${0.8 + (i % 4) * 0.13}s ease-in-out infinite ${(i % 5) * 0.05}s`,
            }}
          />
        ))}
      </div>

      {/* dismiss — a glyph, no word */}
      <button
        type="button"
        aria-label="stop listening"
        onClick={dismiss}
        style={{
          ...box,
          position: 'absolute',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 38px)',
          width: 52,
          height: 52,
          borderRadius: '50%',
          border: '1px solid rgba(250,246,239,.18)',
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="rgba(250,246,239,.55)" strokeWidth={2} strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <style>{`
        @keyframes v2ShellBreathe{0%,100%{transform:scale(.78)}50%{transform:scale(1.32)}}
        @keyframes v2ShellWave{0%,100%{transform:scaleY(.4)}50%{transform:scaleY(1)}}
      `}</style>
    </div>
  );
}
