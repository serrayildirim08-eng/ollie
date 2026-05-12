/**
 * apps/web · voice capture (Sprint 4 · E2)
 *
 * Push-to-talk speech-to-text. All on-device — no cloud transcription.
 *
 * Platform map:
 *   - Web (Chrome/Safari) → window.SpeechRecognition / webkitSpeechRecognition
 *   - Mac (Electron)      → window.ollie.voice.startDictation() (preload bridge)
 *   - iOS (Capacitor)     → @capacitor-community/speech-recognition (dynamic)
 *
 * Returns a single-shot session: start → onTranscript → stop.
 * 30-second max, truncates gracefully on cap.
 */

import * as events from '@ollie/events';

const MAX_DURATION_MS = 30_000;

export interface VoiceCaptureCallbacks {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (reason: string) => void;
  /** Optional source label for telemetry: mic-button | hotkey | siri */
  source?: 'mic-button' | 'hotkey' | 'siri';
}

export interface VoiceCaptureSession {
  stop: () => void;
  /** True while actively recording. */
  active: () => boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// platform detection
// ──────────────────────────────────────────────────────────────────────────

interface OllieWindow {
  ollie?: {
    voice?: {
      startDictation?: (cb: (transcript: string, final: boolean) => void) => Promise<void> | void;
      stopDictation?: () => Promise<void> | void;
    };
  };
  Capacitor?: { isNativePlatform?: () => boolean };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SpeechRecognition?: new () => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webkitSpeechRecognition?: new () => any;
}

function getWindow(): (Window & OllieWindow) | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as Window & OllieWindow;
}

function platform(): 'capacitor' | 'electron' | 'web' | 'none' {
  const w = getWindow();
  if (!w) return 'none';
  if (w.Capacitor?.isNativePlatform?.()) return 'capacitor';
  if (w.ollie?.voice?.startDictation) return 'electron';
  if (w.SpeechRecognition || w.webkitSpeechRecognition) return 'web';
  return 'none';
}

export function voiceCaptureSupported(): boolean {
  return platform() !== 'none';
}

// ──────────────────────────────────────────────────────────────────────────
// public API
// ──────────────────────────────────────────────────────────────────────────

export async function startVoiceCapture(cb: VoiceCaptureCallbacks): Promise<VoiceCaptureSession> {
  const p = platform();
  try {
    events.emit('voice:capture_started', { source: cb.source ?? 'mic-button', ts: Date.now() });
  } catch { /* registry warn ok */ }

  if (p === 'web') return startWeb(cb);
  if (p === 'electron') return startElectron(cb);
  if (p === 'capacitor') return startCapacitor(cb);

  cb.onError?.('voice capture not supported in this environment');
  return { stop: () => undefined, active: () => false };
}

// ──────────────────────────────────────────────────────────────────────────
// Web Speech API
// ──────────────────────────────────────────────────────────────────────────

function startWeb(cb: VoiceCaptureCallbacks): VoiceCaptureSession {
  const w = getWindow()!;
  const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition)!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rec: any = new Ctor();
  // Force English recognition. Voice capture runs in English regardless
  // of OS / browser locale — the dissection router has English + Turkish
  // keywords so it'll still route Turkish-sounding words that the
  // recognizer's English model happens to pick up (e.g. brand names).
  // If multi-locale support is needed later, read from
  // shared.settings.recognizer_locale.
  rec.lang = 'en-US';
  rec.interimResults = true;
  // continuous=true: the recognizer keeps listening across natural
  // pauses instead of cutting off after the first silence. We end
  // explicitly via stop() or the 30s cap below.
  rec.continuous = true;

  let stopped = false;
  let finalBuf = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec.onresult = (e: any) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalBuf += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) cb.onInterim?.(interim);
  };
  rec.onend = () => {
    if (stopped) return;
    stopped = true;
    const text = finalBuf.trim();
    if (text) {
      cb.onFinal(text);
      try { events.emit('voice:capture_transcribed', { text, source: cb.source ?? 'mic-button', ts: Date.now() }); }
      catch { /* registry warn ok */ }
    } else {
      cb.onError?.('no speech detected');
      try { events.emit('voice:capture_cancelled', { reason: 'no-speech', ts: Date.now() }); }
      catch { /* registry warn ok */ }
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec.onerror = (e: any) => {
    cb.onError?.(String(e?.error ?? 'speech-error'));
    try { events.emit('voice:capture_cancelled', { reason: String(e?.error ?? 'error'), ts: Date.now() }); }
    catch { /* registry warn ok */ }
  };

  try { rec.start(); }
  catch (err) {
    cb.onError?.(String((err as Error).message ?? 'failed to start'));
    return { stop: () => undefined, active: () => false };
  }

  const cap = setTimeout(() => { try { rec.stop(); } catch { /* noop */ } }, MAX_DURATION_MS);

  return {
    stop: () => { clearTimeout(cap); try { rec.stop(); } catch { /* noop */ } },
    active: () => !stopped,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Electron bridge
// ──────────────────────────────────────────────────────────────────────────

function startElectron(cb: VoiceCaptureCallbacks): VoiceCaptureSession {
  const w = getWindow()!;
  const voice = w.ollie?.voice;
  if (!voice?.startDictation) {
    cb.onError?.('electron voice bridge missing');
    return { stop: () => undefined, active: () => false };
  }
  let stopped = false;
  let finalBuf = '';
  void voice.startDictation((transcript, final) => {
    if (stopped) return;
    if (final) {
      finalBuf += transcript;
      stopped = true;
      const text = finalBuf.trim();
      if (text) {
        cb.onFinal(text);
        try { events.emit('voice:capture_transcribed', { text, source: cb.source ?? 'mic-button', ts: Date.now() }); }
        catch { /* registry warn ok */ }
      } else {
        cb.onError?.('no speech detected');
      }
    } else {
      cb.onInterim?.(transcript);
    }
  });
  const cap = setTimeout(() => {
    if (!stopped) { stopped = true; void voice.stopDictation?.(); }
  }, MAX_DURATION_MS);
  return {
    stop: () => { clearTimeout(cap); stopped = true; void voice.stopDictation?.(); },
    active: () => !stopped,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Capacitor (iOS) — dynamic plugin load
// ──────────────────────────────────────────────────────────────────────────

function startCapacitor(cb: VoiceCaptureCallbacks): VoiceCaptureSession {
  let stopped = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;
  (async () => {
    try {
      const mod = await dynImport('@capacitor-community/speech-recognition');
      const SR = mod?.SpeechRecognition;
      if (!SR) { cb.onError?.('SpeechRecognition plugin not installed'); return; }
      const perm = await SR.requestPermissions();
      if (perm?.speechRecognition !== 'granted' && perm?.permission !== 'granted') {
        cb.onError?.('mic permission denied');
        return;
      }
      await SR.start({ language: 'en-US', maxResults: 1, partialResults: true, popup: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      SR.addListener('partialResults', (data: any) => {
        const text = (data?.matches?.[0] ?? '') as string;
        if (text && !stopped) cb.onInterim?.(text);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      SR.addListener('listeningState', async (data: any) => {
        if (data?.status === 'stopped' && !stopped) {
          stopped = true;
          // No "final" surface here; iOS plugin coalesces partials.
        }
      });
      setTimeout(() => { if (!stopped) { stopped = true; void SR.stop(); } }, MAX_DURATION_MS);
    } catch (err) {
      cb.onError?.(String((err as Error).message ?? 'capacitor voice failed'));
    }
  })();
  return {
    stop: () => {
      stopped = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void dynImport('@capacitor-community/speech-recognition').then((m: any) => m?.SpeechRecognition?.stop?.()).catch(() => undefined);
    },
    active: () => !stopped,
  };
}
