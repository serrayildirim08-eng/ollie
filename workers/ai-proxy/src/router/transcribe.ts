/**
 * POST /transcribe — speech-to-text for the brain-dump mic.
 *
 * The native app records a short audio clip in the webview (MediaRecorder) and
 * POSTs the raw bytes here with the recording's Content-Type. We forward it to
 * Groq's OpenAI-compatible Whisper endpoint (whisper-large-v3-turbo — fast +
 * cheap, auto-detects EN/ES/TR) and return `{ text }`. The transcript then
 * pre-fills the dump input for the user to edit + send.
 *
 * Auth: T0_JWT_ENFORCED-gated, same as the other write endpoints.
 */

import { json, upstreamError } from '@ollie/worker-http';
import { verifyClerkJwt } from '../clerk-verify';

export interface TranscribeEnv {
  GROQ_API_KEY: string;
  T0_JWT_ENFORCED?: string;
  CLERK_ISSUER?: string;
}

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_WHISPER_MODEL = 'whisper-large-v3-turbo';
// Groq's hard upload cap is 25 MB; a 30-second clip is well under, so this is
// just a guard against a runaway/garbage body.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Map the inbound recording mime to a filename extension Groq accepts. */
function extFor(contentType: string): string {
  if (contentType.includes('mp4') || contentType.includes('m4a')) return 'mp4';
  if (contentType.includes('ogg')) return 'ogg';
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'mp3';
  return 'webm';
}

export async function handleTranscribe(req: Request, env: TranscribeEnv): Promise<Response> {
  // ── Auth — fail CLOSED unless T0_JWT_ENFORCED === '0' (dev). ──────────────
  if (env.T0_JWT_ENFORCED !== '0') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return json({ error: 'unauthorized' }, 401);
    }
    const verified = await verifyClerkJwt(auth.slice('Bearer '.length), env);
    if (!verified) {
      return json({ error: 'invalid_jwt' }, 401);
    }
  }

  const contentType = req.headers.get('content-type') ?? 'audio/webm';
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) {
    return json({ error: 'empty_audio' }, 400);
  }
  if (buf.byteLength > MAX_AUDIO_BYTES) {
    return json({ error: 'audio_too_large' }, 413);
  }

  // Groq's transcription API is multipart/form-data (OpenAI-compatible).
  const form = new FormData();
  form.append('file', new Blob([buf], { type: contentType }), `audio.${extFor(contentType)}`);
  form.append('model', GROQ_WHISPER_MODEL);
  form.append('response_format', 'json');
  // No `language` hint — Whisper auto-detects so EN/ES/TR all transcribe.

  let res: Response;
  try {
    res = await fetch(GROQ_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
    });
  } catch (err) {
    // Log the upstream detail server-side only (audit M7); the client gets a
    // generic code + request id, never the raw Groq error text.
    return upstreamError('transcribe_unreachable', 502, err, { endpoint: 'transcribe' });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // 429 (rate/quota) is recoverable — keep the soft status so the client retries.
    return upstreamError('transcribe_failed', res.status === 429 ? 429 : 502, detail, {
      endpoint: 'transcribe',
      upstream_status: res.status,
    });
  }

  const data = (await res.json().catch(() => ({}))) as { text?: string };
  return json({ text: (data.text ?? '').trim() });
}
