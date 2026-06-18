/**
 * BrainDumpInput · the universal app entry point.
 *
 * One textarea, one submit. POSTs to /route/dump and bubbles the resulting
 * RouterOutput back via `onResult`. Crisis short-circuits via `onCrisis`
 * (router schema guarantees crisis fragments take precedence over module
 * routing).
 *
 * Submission triggers:
 *   - explicit Submit button
 *   - Cmd/Ctrl + Enter while focused in the textarea
 *
 * Photo intake — added 2026-05-29:
 *   - drag-and-drop image onto the container (dashed sage border feedback)
 *   - cmd/ctrl + V with an image in clipboard (text paste falls through native)
 *   - explicit picker via a small camera icon button next to the send row
 *   When an image is staged, submit can fire with image-only (no typed text).
 *   The compressed payload is shipped in the existing /route/dump body under
 *   the `image` field; see api/types.ts for the contract.
 *
 * Auth: takes a bearer-token getter via prop. In dev that reads
 * `VITE_DEV_DUMP_BEARER`; once Clerk lands in T0 phase 3 the AuthProvider
 * will surface a Clerk session JWT instead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Textarea, Button, Text } from '../ui';
import { Stack, Row } from '../layout';
import { routeDump } from '../api';
import { detectCrisis } from '@ollie/logic/crisis';
import type { RouteDumpRequest } from '../api';
import { kv } from '../storage';
import { colors } from '../theme/tokens';
import type { RouterOutput, CrisisSignal } from '../router/schema';
import { usePhotoIntake, PhotoIntakeBar } from './PhotoIntake';
import { MicButton } from './MicButton';
import { NotifyPrimeLine } from '../notify/NotifyPrimeLine';
import { DUMP_INPUT_ID } from '../navigation/useDeepLinks';
import styles from './BrainDumpInput.module.css';

/**
 * Disk key for the in-progress brain dump. The user's unsent thought is
 * persisted here (debounced as they type, and again right before each
 * submit) so it survives an app close, a crash, or an offline/server
 * submit failure — and is restored into the textarea on next open.
 * Cleared only on a successful route. ADHD-safety: never lose a thought.
 */
const PENDING_DUMP_KEY = 'pending_dump';

export interface BrainDumpInputProps {
  /**
   * Returns a bearer token used to authenticate against /route/dump.
   * The component awaits this before every submit, so the parent can
   * refresh the token transparently.
   */
  getBearer: () => string | Promise<string>;

  /**
   * Fired SYNCHRONOUSLY the moment a non-empty dump is submitted, before the
   * cloud route call. Lets the parent flash an instant "okay!" ack so perceived
   * latency is ~0. The route + dispatch then run in the background. Callers must
   * retract the optimistic ack post-route for crisis / goal-intent dumps (only
   * discoverable from the RouterOutput) — see onResult / onCrisis.
   */
  onSubmitted?: () => void;

  /** Fired on a successful classification. */
  onResult?: (output: RouterOutput) => void;

  /**
   * Fired BEFORE onResult when the router flags a crisis. Receivers should
   * surface the crisis screen and stop downstream module routing until the
   * user dismisses it.
   */
  onCrisis?: (crisis: CrisisSignal, output: RouterOutput) => void;

  /** Override placeholder copy. Default: "What's in your head?" */
  placeholder?: string;

  /** Pre-fill (e.g. from voice transcript). */
  initialValue?: string;

  /**
   * Whether to clear the textarea after a successful submission.
   * Default: true.
   */
  clearOnSuccess?: boolean;
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string };

const DEFAULT_PLACEHOLDER = "What's in your head?";

/** Stable per-attempt id for /route/dump. Crash-resistant fallback for the
 *  rare runtime without crypto.randomUUID. */
function newDumpId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function BrainDumpInput({
  getBearer,
  onSubmitted,
  onResult,
  onCrisis,
  placeholder = DEFAULT_PLACEHOLDER,
  initialValue = '',
  clearOnSuccess = true,
}: BrainDumpInputProps): JSX.Element {
  const [text, setText] = useState(initialValue);
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });
  // Gates the autosave effect until the on-mount restore has run, so we
  // never delete a saved draft before we've had a chance to load it.
  const [restored, setRestored] = useState(false);

  // Stable dumpId for the CURRENT attempt. Minted lazily on the first submit
  // and REUSED for every retry of the same words, so a request that timed out
  // client-side but actually succeeded server-side does not double-route or
  // double-write its fragments — the worker dedupes on this id (idempotency).
  // Reset to null only after a confirmed success so the NEXT dump gets a fresh
  // id; a failed/timed-out submit keeps it, which is exactly the retry case.
  const dumpIdRef = useRef<string | null>(null);

  const photo = usePhotoIntake();

  // Restore a persisted draft on mount (unless the textarea already has
  // content, e.g. an initialValue from a voice transcript).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const draft = await kv.get<{ text: string }>(PENDING_DUMP_KEY);
      if (cancelled) return;
      if (draft?.text) setText((prev) => (prev.trim().length === 0 ? draft.text : prev));
      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced autosave: persist the draft as the user types, clear the
  // saved copy when they empty the box. Runs only after restore.
  useEffect(() => {
    if (!restored) return;
    const trimmed = text.trim();
    const timer = setTimeout(() => {
      if (trimmed.length === 0) void kv.delete(PENDING_DUMP_KEY);
      else void kv.set(PENDING_DUMP_KEY, { text: trimmed, ts: Date.now() });
    }, 400);
    return () => clearTimeout(timer);
  }, [text, restored]);

  const submit = useCallback(async (overrideText?: string) => {
    // `overrideText` lets a caller (e.g. the voice mic, which auto-submits the
    // transcript) submit a known string without waiting for the `text` state
    // update to flush. Falls back to the live textarea value otherwise.
    const trimmed = (overrideText ?? text).trim();
    const hasText = trimmed.length > 0;
    const hasImage = photo.image !== null;
    // No-op when both sides are empty. Spec: "If text is empty AND image is
    // empty, do nothing." We DON'T flip to error state — quietly bail.
    if (!hasText && !hasImage) return;
    setState({ kind: 'loading' });

    // Instant ack: fire the moment we know the dump is non-empty, BEFORE the
    // cloud round-trip + dispatch, so perceived latency is ~0. The parent shows
    // "okay!" now and retracts it later if the route reveals a goal-intent dump
    // (only knowable from res.data → harmless flash-then-modal). A bearer failure
    // below would ack-then-show-an-error; acceptable per the fire-and-forget
    // dump UX (the words are saved to disk regardless).
    //
    // EXCEPT crisis: "crisis must never ack", not even an optimistic flash we
    // retract post-route. The server verdict isn't known until res.data, so we
    // pre-screen locally with the same offline EN/ES/TR matchers the crisis
    // surface uses (detectCrisis is pure, no I/O). If it trips, withhold the
    // instant ack entirely and let the post-route crisis path own the screen;
    // image-only dumps (no text) can't be screened so they ack as normal.
    const localCrisis = hasText && detectCrisis(trimmed).match;
    if (onSubmitted && !localCrisis) onSubmitted();

    let bearer: string;
    try {
      bearer = await getBearer();
    } catch (err) {
      setState({ kind: 'error', message: (err as Error).message || 'auth failed' });
      return;
    }
    if (!bearer) {
      setState({ kind: 'error', message: 'sign in to dump' });
      return;
    }

    // Persist text durably BEFORE the network call so it survives a crash,
    // app close, or failed/offline submit. The image is not disk-persisted
    // (large + cheap to re-attach) — it lives in component state only.
    if (hasText) {
      await kv.set(PENDING_DUMP_KEY, { text: trimmed, ts: Date.now() });
    }

    // Mint the attempt id once, then reuse it across retries. A retry of the
    // same words sends the SAME dumpId, so the worker can recognise a request
    // it already completed (e.g. one that timed out client-side after the
    // worker had already routed it) and return the stored result instead of
    // routing + writing every fragment a second time.
    if (dumpIdRef.current === null) dumpIdRef.current = newDumpId();

    const body: RouteDumpRequest = { dumpId: dumpIdRef.current };
    if (hasText) body.text = trimmed;
    if (photo.image) body.image = photo.image;

    // Measurement sayacı: full round-trip the user actually feels (network +
    // worker + AI), as opposed to the worker-only latency logged in groq.ts.
    const routeStartedAt = Date.now();
    const res = await routeDump(body, { bearer });
    if (res.ok) {
      console.log(
        JSON.stringify({
          metric: 'dump_roundtrip',
          roundtrip_ms: Date.now() - routeStartedAt,
          had_text: hasText,
          had_image: hasImage,
        }),
      );
    }
    if (!res.ok) {
      // Translate ApiError to a one-line human message. The draft stays in
      // the box AND on disk; the image stays in state so the user can retry.
      const code = res.error.code;
      // Backend reports vision-side failure with http 502 and an opaque body —
      // we surface a dedicated copy when we can detect it via body text.
      const isVisionFail =
        hasImage &&
        code === 'http' &&
        typeof res.error.body === 'string' &&
        res.error.body.includes('vision_failed');
      const message =
        isVisionFail ? "Couldn't read the photo. Try again or type it out." :
        code === 'unauthorized' ? 'sign in to dump' :
        code === 'rate_limited' ? 'going too fast — your words are saved, try again in a few seconds' :
        code === 'timeout' ? 'took too long — your words are saved, try again' :
        code === 'network' ? 'no connection — your words are saved, try again' :
        code === 'http' ? `server hiccup (${res.error.status ?? '?'}) — your words are saved` :
        'something went wrong — your words are saved';
      setState({ kind: 'error', message });
      return;
    }

    // Success — the dump routed, so the saved draft is no longer needed.
    // Retire this attempt's dumpId so the NEXT dump mints a fresh one (a new
    // thought must not collapse into the just-completed one's idempotency key).
    dumpIdRef.current = null;
    void kv.delete(PENDING_DUMP_KEY);
    setState({ kind: 'idle' });
    if (clearOnSuccess) {
      setText('');
      photo.clear();
    }

    // Crisis short-circuit BEFORE module result — parent decides whether to
    // pause downstream side-effects, but in v1 both callbacks fire so a
    // simple parent can route the journal and the crisis screen at once.
    if (res.data.crisis && onCrisis) {
      onCrisis(res.data.crisis, res.data);
    }
    if (onResult) onResult(res.data);
  }, [text, photo, getBearer, onSubmitted, onResult, onCrisis, clearOnSuccess]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd+Enter (macOS) / Ctrl+Enter (other) submits.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void submit();
      }
    },
    [submit],
  );

  const isLoading = state.kind === 'loading';
  const error = state.kind === 'error' ? state.message : undefined;
  // Submit is gated on EITHER side being populated. Photo-only dumps are
  // first-class — receipts, pill bottles, handwritten notes ride the same
  // flow as typed dumps.
  const disabled =
    isLoading || (text.trim().length === 0 && photo.image === null);

  // Drag/paste handlers attach to a host wrapper around the Stack — Stack
  // is a token-only flex primitive and doesn't forward DOM events. The
  // wrapper also carries the dashed sage border (drag-over feedback).
  return (
    <div
      className={styles.container}
      style={{
        // 1px dashed sage on drag-over; transparent border by default so the
        // layout doesn't jitter when the border appears.
        border: photo.isDragOver
          ? `1px dashed ${colors.sage}`
          : '1px dashed transparent',
        borderRadius: 6,
        padding: 4,
        transition: 'border-color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
      }}
      onDragOver={photo.onDragOver}
      onDragEnter={photo.onDragOver}
      onDragLeave={photo.onDragLeave}
      onDrop={photo.onDrop}
      onPaste={photo.onPaste}
    >
      <Stack gap="md">
        <Textarea
          id={DUMP_INPUT_ID}
          value={text}
          onChange={setText}
          placeholder={placeholder}
          disabled={isLoading}
          error={error}
          onKeyDown={onKeyDown}
          label="Brain dump"
          labelHidden
          minRows={3}
        />
        <Row align="center" justify="space-between">
          <Row align="center" gap={16}>
            <PhotoIntakeBar intake={photo} disabled={isLoading} />
            <MicButton
              getBearer={getBearer}
              disabled={isLoading}
              onTranscript={(t) => {
                // Voice auto-sends: fold the transcript into any typed text and
                // submit straight to the modules — no extra tap.
                const combined = text.trim().length > 0 ? `${text.trim()} ${t}` : t;
                setText(combined);
                void submit(combined);
              }}
            />
            <Text scale="caption">
              {isLoading
                ? photo.image
                  ? 'reading photo…'
                  : 'thinking…'
                : 'cmd + enter to send'}
            </Text>
          </Row>
          <Button
            variant="primary"
            size="md"
            loading={isLoading}
            disabled={disabled}
            onClick={() => void submit()}
          >
            send
          </Button>
        </Row>
        <NotifyPrimeLine />
      </Stack>
    </div>
  );
}
