/**
 * partner-v2 · PartnerApp — the preview module root
 *
 * Mounted behind the dev-only `/preview/partner` route. It owns a small
 * in-module navigation stack (the v2 pattern: a leaf page pushes onto a
 * stack; back is the swipe-handle / a real back button). The whole thing is
 * real, runnable, clickable React over an HONEST LOCAL STUB — there is no
 * partner-linking backend, so `usePartnerStore` seeds + persists the data
 * locally. See selectors.ts / usePartnerStore.ts for the stub note.
 *
 * The 4 screens, from the approved mockups:
 *   - `myPartner` — my-partner.html  (the floor: the quiet partner view)
 *   - `invite`    — partner-invite.html  (the first-run / no-link state)
 *   - `ask`       — partner-ask.html  (the 4-category ask flow)
 *   - `sharing`   — partner-sharing.html  (the granular opt-in control)
 *
 * The floor is picked at mount: a linked partner → `myPartner`, no partner
 * → `invite`. `onExit` returns to whatever opened the preview; `now` is
 * injected so screens stay deterministic. Mirrors habits-v2/HabitsApp.tsx.
 */
import { useCallback, useMemo, useState } from 'react';
import { usePartnerStore } from './usePartnerStore';
import { MyPartnerScreen } from './screens/MyPartnerScreen';
import { PartnerInviteScreen } from './screens/PartnerInviteScreen';
import { PartnerAskScreen } from './screens/PartnerAskScreen';
import { PartnerSharingScreen } from './screens/PartnerSharingScreen';

/** every reachable v2 partner screen */
export type PartnerRoute = 'myPartner' | 'invite' | 'ask' | 'sharing';

export interface PartnerAppProps {
  /** injected for deterministic tests; defaults to Date.now() */
  now?: number;
  /** leave the preview module entirely */
  onExit?: () => void;
  /** the route to open on first mount (the preview index can deep-link) */
  initialRoute?: PartnerRoute;
  /** opening the crisis surface — the Safe dot */
  onSafe?: () => void;
}

export function PartnerApp({
  now,
  onExit,
  initialRoute,
  onSafe,
}: PartnerAppProps) {
  const clock = now ?? Date.now();
  const { state, actions } = usePartnerStore(clock);

  // the floor — a linked partner shows the my-partner face; an unlinked one
  // drops straight into the invite flow. `initialRoute` overrides for tests
  // + the preview index deep-link.
  const floor: PartnerRoute = useMemo(
    () => (state.linkedPartner ? 'myPartner' : 'invite'),
    [state.linkedPartner],
  );

  const [stack, setStack] = useState<PartnerRoute[]>(() => {
    const start = initialRoute ?? floor;
    return start === floor ? [floor] : [floor, start];
  });
  const current = stack[stack.length - 1];

  const push = useCallback((to: PartnerRoute) => {
    setStack((s) => [...s, to]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => {
      if (s.length <= 1) {
        onExit?.();
        return s;
      }
      return s.slice(0, -1);
    });
  }, [onExit]);

  const safe = useCallback(() => {
    if (onSafe) onSafe();
  }, [onSafe]);

  switch (current) {
    case 'invite':
      return (
        <PartnerInviteScreen
          state={state}
          onRegenerate={actions.regenerateCode}
          onBack={stack.length > 1 ? pop : onExit}
          onSafe={safe}
        />
      );
    case 'ask':
      return (
        <PartnerAskScreen
          state={state}
          onSend={actions.sendAsk}
          onBack={pop}
          onSafe={safe}
        />
      );
    case 'sharing':
      return (
        <PartnerSharingScreen
          state={state}
          onSetSharing={actions.setSharing}
          onBack={pop}
          onSafe={safe}
        />
      );
    case 'myPartner':
    default:
      return (
        <MyPartnerScreen
          state={state}
          now={clock}
          navigate={push}
          onSafe={safe}
        />
      );
  }
}
