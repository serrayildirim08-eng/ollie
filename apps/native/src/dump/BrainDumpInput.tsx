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
 * Auth: takes a bearer-token getter via prop. In dev that reads
 * `VITE_DEV_DUMP_BEARER`; once Clerk lands in T0 phase 3 the AuthProvider
 * will surface a Clerk session JWT instead.
 */

import { useCallback, useState } from 'react';
import { Textarea, Button, Text } from '../ui';
import { Stack, Row } from '../layout';
import { routeDump } from '../api';
import type { RouterOutput, CrisisSignal } from '../router/schema';
import styles from './BrainDumpInput.module.css';

export interface BrainDumpInputProps {
  /**
   * Returns a bearer token used to authenticate against /route/dump.
   * The component awaits this before every submit, so the parent can
   * refresh the token transparently.
   */
  getBearer: () => string | Promise<string>;

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

export function BrainDumpInput({
  getBearer,
  onResult,
  onCrisis,
  placeholder = DEFAULT_PLACEHOLDER,
  initialValue = '',
  clearOnSuccess = true,
}: BrainDumpInputProps): JSX.Element {
  const [text, setText] = useState(initialValue);
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setState({ kind: 'loading' });

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

    const res = await routeDump({ text: trimmed }, { bearer });
    if (!res.ok) {
      // Translate ApiError to a one-line human message.
      const code = res.error.code;
      const message =
        code === 'unauthorized' ? 'sign in to dump' :
        code === 'rate_limited' ? 'too fast — try again in a moment' :
        code === 'timeout' ? 'took too long — try again' :
        code === 'network' ? 'no connection' :
        code === 'http' ? `server error (${res.error.status ?? '?'})` :
        'something went wrong';
      setState({ kind: 'error', message });
      return;
    }

    setState({ kind: 'idle' });
    if (clearOnSuccess) setText('');

    // Crisis short-circuit BEFORE module result — parent decides whether to
    // pause downstream side-effects, but in v1 both callbacks fire so a
    // simple parent can route the journal and the crisis screen at once.
    if (res.data.crisis && onCrisis) {
      onCrisis(res.data.crisis, res.data);
    }
    if (onResult) onResult(res.data);
  }, [text, getBearer, onResult, onCrisis, clearOnSuccess]);

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
  const disabled = isLoading || text.trim().length === 0;

  return (
    <Stack gap="md" className={styles.container}>
      <Textarea
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
        <Text scale="caption">
          {isLoading ? 'thinking…' : 'cmd + enter to send'}
        </Text>
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
    </Stack>
  );
}
