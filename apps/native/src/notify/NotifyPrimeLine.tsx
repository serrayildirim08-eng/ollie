/**
 * NotifyPrimeLine · single editorial line that asks for system-notification
 * permission, then disappears forever.
 *
 * Where it surfaces (parents decide):
 *   - work module (FocusTimer.tsx) — first time the user starts a session
 *   - dump intake (BrainDumpInput.tsx) — first time a dump submits OK
 *
 * Behaviour:
 *   - On mount, reads current permission state.
 *   - Renders nothing if permission is already `'granted'` OR `'denied'`
 *     — the user has answered, never re-prompt.
 *   - Renders nothing if there's no Tauri context (web preview).
 *   - Stores a flag in localStorage after the first prompt so we never
 *     ask twice even if the OS forgets us.
 *   - One line of body copy + two minimal text buttons. No card, no
 *     drop-shadow, no SaaS modal. Editorial restraint.
 *
 * DNA notes (apps/native/src/theme/tokens.ts):
 *   - cream surface, ink text, sage accent for the affirmative
 *   - hairline rule above, generous vertical breath
 *   - copy: lowercase, factual, no exclamation, no "We". House voice.
 */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Stack, Row } from '../layout';
import { Text } from '../ui';
import {
  checkNotificationPermission,
  requestNotificationPermission,
} from './systemNotify';

const ASKED_KEY = 'ollie:notify_prompt_asked';

type Phase = 'checking' | 'prompt' | 'done';

interface NotifyPrimeLineProps {
  /**
   * Headline copy. Default reads as a factual editorial line. Parents
   * may override to anchor to the surrounding surface (e.g. work timer
   * vs brain dump).
   */
  label?: string;
}

export function NotifyPrimeLine({
  label = 'allow ollie to send quiet reminders?',
}: NotifyPrimeLineProps): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('checking');

  // Decide on mount whether we should render at all.
  useEffect(() => {
    let alive = true;
    void (async () => {
      // Belt: if we've ever asked, never ask again.
      try {
        if (
          typeof window !== 'undefined' &&
          window.localStorage?.getItem(ASKED_KEY) === '1'
        ) {
          if (alive) setPhase('done');
          return;
        }
      } catch {
        /* private mode / sandboxed — proceed to plugin check */
      }

      const state = await checkNotificationPermission();
      if (!alive) return;
      // 'granted' and 'denied' both mean we don't ask. Only 'default'
      // (untouched in a real Tauri context) gets the editorial line.
      setPhase(state === 'default' ? 'prompt' : 'done');
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (phase !== 'prompt') return null;

  const onAllow = async (): Promise<void> => {
    markAsked();
    await requestNotificationPermission();
    setPhase('done');
  };

  const onDismiss = (): void => {
    markAsked();
    setPhase('done');
  };

  const buttonStyle: CSSProperties = {
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
    fontVariantCaps: 'all-small-caps',
    letterSpacing: '0.08em',
  };

  return (
    <Stack
      gap={12}
      style={{
        paddingTop: 16,
        paddingBottom: 16,
        borderTop: '1px solid var(--ollie-color-hairline)',
      }}
      data-testid="notify-prime-line"
    >
      <Text scale="body" color="var(--ollie-color-ink)">
        {label}
      </Text>
      <Row gap={20}>
        <button
          type="button"
          onClick={() => {
            void onAllow();
          }}
          style={{ ...buttonStyle, color: 'var(--ollie-color-sage-deep)' }}
          data-testid="notify-prime-allow"
        >
          allow
        </button>
        <button
          type="button"
          onClick={onDismiss}
          style={{ ...buttonStyle, color: 'var(--ollie-color-ink-soft)' }}
          data-testid="notify-prime-dismiss"
        >
          not now
        </button>
      </Row>
    </Stack>
  );
}

function markAsked(): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage?.setItem(ASKED_KEY, '1');
    }
  } catch {
    /* private mode — accept that we may re-prompt next session */
  }
}
