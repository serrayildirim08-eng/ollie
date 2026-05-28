/**
 * DumpScreen · home screen / brain-dump landing.
 *
 * The dump UX is fire-and-forget: user dumps, Ollie acknowledges with a
 * brief "okay!" and the module handlers update silently in the background.
 * No journal feed, no list of past dumps, no AI commentary surface — see
 * memory `feedback-ollie-dump-ux-silent`. The actual state changes show up
 * inside the affected modules when the user navigates to them.
 *
 * Crisis is the one exception: when the router flags crisis, the dispatch
 * is short-circuited (no module updates) and a quiet banner surfaces.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Stack } from '../layout';
import { Text } from '../ui';
import { colors } from '../theme/tokens';
import { BrainDumpInput } from './BrainDumpInput';
import { dispatchRouterOutput } from '../modules';
import type { CrisisSignal, RouterOutput } from '../router/schema';
import styles from './DumpScreen.module.css';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

// Matches the total duration of the `ollie-ack` keyframe in DumpScreen.module.css.
// Bumped a hair so the cleanup unmount lands just after the fade-out finishes
// and the user never sees a hard cut.
const ACK_FADE_MS = 2500;
// Force-remount each ack so the CSS animation restarts on every dump even
// when the same Ack node would otherwise persist across submits.
let _ackTick = 0;

export function DumpScreen(): JSX.Element {
  const { getToken } = useAuth();
  const [ackKey, setAckKey] = useState<number | null>(null);
  const [crisis, setCrisis] = useState<CrisisSignal | null>(null);

  // Auto-clear the ack so the DOM cleans up after the fade-out and the
  // screen returns to its quiet default state.
  useEffect(() => {
    if (ackKey === null) return;
    const t = setTimeout(() => setAckKey(null), ACK_FADE_MS);
    return () => clearTimeout(t);
  }, [ackKey]);

  // Fetch a Clerk session JWT for every dump request. The worker verifies
  // via JWKS at CLERK_ISSUER. Token has a short TTL (default ~60s) and
  // Clerk refreshes transparently — calling getToken() each time is the
  // documented happy path.
  const getBearer = useCallback(async () => {
    const t = await getToken();
    return t ?? '';
  }, [getToken]);
  const onResult = useCallback(async (output: RouterOutput) => {
    // Dispatch is silent: the result entries update module-local state but
    // we do not render them. The user goes to the module to see the change.
    const dispatched = await dispatchRouterOutput(output);
    if (dispatched.crisisSkipped) return;
    _ackTick += 1;
    setAckKey(_ackTick);
  }, []);
  const onCrisis = useCallback((signal: CrisisSignal) => {
    setCrisis(signal);
  }, []);

  return (
    <Stack gap={32}>
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          dump
        </Text>
        <Text scale="display">What's in your head?</Text>
      </Stack>

      <BrainDumpInput getBearer={getBearer} onResult={onResult} onCrisis={onCrisis} />

      {crisis && <CrisisBanner crisis={crisis} onDismiss={() => setCrisis(null)} />}

      {!crisis && ackKey !== null && <Ack key={ackKey} />}
    </Stack>
  );
}

// ─── ack ──────────────────────────────────────────────────────────────────
// Full-viewport sage takeover with a giant serif "Okay!". Fades in, holds,
// fades back over ~2.4s. Pointer-events off so the user can keep typing
// straight through the flash — the dump UI behind it is still alive.

function Ack(): JSX.Element {
  return (
    <div className={styles.ack} role="status" aria-live="polite">
      <span className={styles.ackText}>Okay!</span>
    </div>
  );
}

// ─── crisis ───────────────────────────────────────────────────────────────

function CrisisBanner({
  crisis,
  onDismiss,
}: {
  crisis: CrisisSignal;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <Stack
      gap={8}
      style={{
        padding: '16px 20px',
        borderRadius: 12,
        background: 'rgba(196, 64, 64, 0.06)',
        border: '1px solid rgba(196, 64, 64, 0.2)',
      }}
    >
      <Text scale="caption" color="rgb(140, 30, 30)" style={SMCP_STYLE}>
        notice
      </Text>
      <Text scale="body" color="rgb(80, 20, 20)">
        Something in what you wrote sounded heavy. You're not alone — the
        full crisis surface ships in the next sprint. For now: if this is
        urgent, please reach out to a crisis line in your country.
      </Text>
      <Text
        scale="caption"
        color={colors.inkFaint}
        as="button"
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        dismiss · type={crisis.type} · {crisis.language}
      </Text>
    </Stack>
  );
}
