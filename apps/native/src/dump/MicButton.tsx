/**
 * MicButton · brain-dump voice intake.
 *
 * Tap to start recording → a full-screen sage wash with a breathing circle
 * shows you're being heard; tap anywhere to stop. The clip is POSTed to the
 * ai-proxy /transcribe endpoint (Groq Whisper) and the recognised text is
 * handed back via `onTranscript` to pre-fill the dump textarea. Nothing is
 * stored — the blob is sent once and dropped.
 *
 * Hide-not-lie: if the webview can't record (no MediaRecorder / getUserMedia),
 * the button renders nothing rather than showing a dead control. On failure we
 * surface the real reason inline (e.g. "mic blocked") so it's diagnosable
 * without opening devtools.
 */

import { useCallback, useRef, useState } from 'react';
import { colors } from '../theme/tokens';
import { routeTranscribe } from '../api';
import styles from './MicButton.module.css';

type Status = 'idle' | 'recording' | 'transcribing' | 'error';

// 30s safety cap — a dump is a sentence or two, not a monologue, and Groq bills
// per second. Auto-stops the recorder if the user forgets to.
const MAX_RECORD_MS = 30_000;
// Silence-based auto-stop (so the user never has to tap "stop"):
const SILENCE_LEVEL = 10; // 0..255 avg frequency magnitude below this = quiet
const SILENCE_HANG_MS = 1400; // stop this long after speech tails into silence
const NO_SPEECH_TIMEOUT_MS = 6000; // give up if they never start talking

export function MicButton({
  getBearer,
  onTranscript,
  disabled,
}: {
  getBearer: () => string | Promise<string>;
  onTranscript: (text: string) => void;
  disabled?: boolean;
}): JSX.Element | null {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopTracks = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const fail = useCallback((msg: string) => {
    // Surface the real reason — both to the user (inline, ~4s) and the console.
    console.error('[MicButton]', msg);
    setErrorMsg(msg);
    setStatus('error');
    window.setTimeout(() => setStatus('idle'), 4000);
  }, []);

  const start = useCallback(async () => {
    if (disabled || status === 'recording' || status === 'transcribing') return;
    setErrorMsg('');
    if (!navigator.mediaDevices?.getUserMedia) {
      fail('this app build can’t reach the microphone');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as Error)?.name ?? 'Error';
      const msg =
        name === 'NotAllowedError'
          ? 'mic blocked — allow microphone access in System Settings'
          : name === 'NotFoundError'
            ? 'no microphone found'
            : `mic error: ${name}`;
      fail(msg);
      return;
    }
    streamRef.current = stream;
    try {
      const mime = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stopTracks();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size === 0) {
          setStatus('idle');
          return;
        }
        setStatus('transcribing');
        let bearer = '';
        try {
          bearer = await getBearer();
        } catch {
          /* fall through to the empty-bearer guard */
        }
        if (!bearer) {
          fail('not signed in');
          return;
        }
        const result = await routeTranscribe(blob, { bearer });
        if (result.ok && result.data.text.trim().length > 0) {
          onTranscript(result.data.text.trim());
          setStatus('idle');
        } else if (result.ok) {
          fail('heard nothing — try again');
        } else {
          fail(`transcribe failed (${result.error.code})`);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setStatus('recording');
      window.setTimeout(() => {
        if (rec.state === 'recording') rec.stop();
      }, MAX_RECORD_MS);

      // ── Auto-stop on silence ── watch the input level; once the user has
      // spoken and then goes quiet for SILENCE_HANG_MS, stop on their behalf.
      try {
        const Ctx =
          window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          audioCtxRef.current = ctx;
          const sourceNode = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          sourceNode.connect(analyser);
          const bins = new Uint8Array(analyser.frequencyBinCount);
          const startedAt = Date.now();
          let lastLoudAt = startedAt;
          let spoke = false;
          const tick = () => {
            if (rec.state !== 'recording') return;
            analyser.getByteFrequencyData(bins);
            let sum = 0;
            for (let i = 0; i < bins.length; i++) sum += bins[i];
            const avg = sum / bins.length;
            const now = Date.now();
            if (avg > SILENCE_LEVEL) {
              spoke = true;
              lastLoudAt = now;
            }
            if (spoke && now - lastLoudAt > SILENCE_HANG_MS) {
              rec.stop();
              return;
            }
            if (!spoke && now - startedAt > NO_SPEECH_TIMEOUT_MS) {
              rec.stop();
              return;
            }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch {
        // No Web Audio → fall back to manual tap / the 30s cap. Non-fatal.
      }
    } catch (err) {
      stopTracks();
      fail(`recorder error: ${(err as Error)?.message ?? 'unknown'}`);
    }
  }, [disabled, status, getBearer, onTranscript, stopTracks, fail]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') rec.stop();
  }, []);

  // Hooks above are unconditional; the capability gate is a stable per-env
  // value, so this early return never changes hook order across renders.
  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';
  if (!supported) return null;

  const recording = status === 'recording';
  const busy = status === 'transcribing';

  return (
    <>
      {recording && (
        <div
          className={styles.overlay}
          role="button"
          aria-label="Stop recording"
          onClick={stop}
        >
          <div className={styles.circle} />
          <span className={styles.label}>listening… just pause when you’re done</span>
        </div>
      )}

      <button
        type="button"
        aria-label={recording ? 'Stop recording' : 'Record a voice note'}
        title={busy ? 'transcribing…' : 'speak your dump'}
        onClick={() => (recording ? stop() : void start())}
        disabled={disabled || busy}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: disabled || busy ? 'default' : 'pointer',
          color: recording ? colors.sage : status === 'error' ? colors.inkSoft : colors.inkFaint,
        }}
        onMouseEnter={(e) => {
          if (!disabled && !busy && !recording) e.currentTarget.style.color = colors.ink;
        }}
        onMouseLeave={(e) => {
          if (!recording) e.currentTarget.style.color = colors.inkFaint;
        }}
      >
        <MicGlyph recording={recording} />
        {busy && (
          <span style={{ fontSize: 11, color: colors.inkFaint }}>transcribing…</span>
        )}
      </button>

      {status === 'error' && errorMsg && (
        <span style={{ fontSize: 11, color: colors.inkSoft }}>{errorMsg}</span>
      )}
    </>
  );
}

function MicGlyph({ recording }: { recording: boolean }): JSX.Element {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill={recording ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="21" />
    </svg>
  );
}
