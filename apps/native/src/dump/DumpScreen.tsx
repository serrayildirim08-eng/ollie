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
import type { DispatchEntry } from '../modules';
import type { CrisisSignal, RouterOutput } from '../router/schema';
import { NeedsConfirmCard } from './NeedsConfirmCard';
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

/** One pending confirmation card — keyed by fragment index in the last dispatch. */
interface PendingConfirm {
  /** Stable id: dumpId + fragment index in that dispatch. */
  id: string;
  fragmentPreview: string;
  routeLabel: string;
  /** Called when user clicks undo — best-effort remove on the module handler. */
  onUndo: () => void;
}

function buildRouteLabel(entry: DispatchEntry): string {
  const { module, payload } = entry.fragment;
  // Every ActionPayload variant carries an `action` string discriminant.
  // We narrow via `in` first; the index access is safe because the union
  // guarantees `action` is always a string when the key exists.
  const action =
    'action' in payload && typeof payload.action === 'string' ? payload.action : '';
  return action ? `${module} · ${action}` : module;
}

export function DumpScreen(): JSX.Element {
  const { getToken } = useAuth();
  const [ackKey, setAckKey] = useState<number | null>(null);
  const [crisis, setCrisis] = useState<CrisisSignal | null>(null);
  const [pendingConfirms, setPendingConfirms] = useState<PendingConfirm[]>([]);

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

  const dismissConfirm = useCallback((id: string) => {
    setPendingConfirms((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const onResult = useCallback(async (output: RouterOutput) => {
    // Dispatch is silent: the result entries update module-local state but
    // we do not render them. The user goes to the module to see the change.
    const dispatched = await dispatchRouterOutput(output);
    if (dispatched.crisisSkipped) return;

    // Surface a confirm card for each uncertain fragment. Both the fragment-
    // level flag (set by the router before dispatch) and the handler result
    // flag are checked — whichever layer sets needsConfirm wins.
    const cards: PendingConfirm[] = dispatched.entries
      .filter(
        (e) => e.fragment.needsConfirm === true || e.result.needsConfirm === true,
      )
      .map((e, i) => {
        const id = `${output.dumpId}-${i}`;
        const realUndo = e.result.undo;
        return {
          id,
          fragmentPreview: e.fragment.text.slice(0, 60),
          routeLabel: buildRouteLabel(e),
          // Run the handler's real undo closure first (removes the written
          // row), then dismiss the card. Handlers that did not persist
          // (dump_only, validation reject) omit `undo` — we just dismiss.
          onUndo: async () => {
            if (realUndo) {
              try {
                await realUndo();
              } catch (err) {
                console.error('[dump] undo failed', err);
              }
            }
            dismissConfirm(id);
          },
        };
      });

    if (cards.length > 0) {
      setPendingConfirms((prev) => [...prev, ...cards]);
    }

    _ackTick += 1;
    setAckKey(_ackTick);
  }, [dismissConfirm]);

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

      {!crisis && pendingConfirms.length > 0 && (
        <Stack gap={10}>
          {pendingConfirms.map((card) => (
            <NeedsConfirmCard
              key={card.id}
              fragmentPreview={card.fragmentPreview}
              routeLabel={card.routeLabel}
              onKeep={() => dismissConfirm(card.id)}
              onUndo={card.onUndo}
            />
          ))}
        </Stack>
      )}
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
        Something in what you wrote sounded heavy. If it's urgent, a crisis
        line in your country can help right now.
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
