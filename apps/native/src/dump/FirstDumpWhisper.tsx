/**
 * FirstDumpWhisper — one-time-ever proof line after the FIRST successful dump.
 *
 * The dump UX is deliberately silent (feedback_ollie_dump_ux_silent), which
 * is perfect for regulars but leaves a brand-new user unsure anything
 * happened. This whisper appears ONCE, under the dump box, right after the
 * first route ever succeeds — "→ groceries · see it" — proving where the
 * item went. It fades in (~450ms), lingers 10s, fades out on its own;
 * tapping it opens that module's box. Either path is terminal: the once-flag
 * is persisted the moment the whisper is shown, so it can never re-render
 * (an app quit mid-display counts as shown — better to under-show than
 * repeat, no-shame discipline).
 *
 * Visual idiom copies FirstRunGuide: caption-scale text, sageDeep arrow,
 * SMCP "see it" in sage. No card, no toast, no new surface — a whisper.
 * Honours prefers-reduced-motion: transitions collapse to instant.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { Text } from '../ui';
import { Row } from '../layout';
import { colors } from '../theme/tokens';
import { kv } from '../storage';

/** Once-ever UI flag — same kv mechanism as the dump draft persistence. */
const WHISPER_SHOWN_KEY = 'dump.whisper_shown';

export async function shouldShowFirstDumpWhisper(): Promise<boolean> {
  try {
    return !(await kv.get<boolean>(WHISPER_SHOWN_KEY));
  } catch {
    return false;
  }
}

export async function markFirstDumpWhisperShown(): Promise<void> {
  try {
    await kv.set(WHISPER_SHOWN_KEY, true);
  } catch {
    /* best-effort — worst case the whisper shows once more */
  }
}

/** Friendly lowercase destination names (grammar: FirstRunGuide captions). */
const WHISPER_LABELS: Record<string, string> = {
  grocery: 'groceries',
  medication: 'meds',
  finance: 'money',
  cycle: 'cycle',
  mood: 'mood',
  sleep: 'sleep',
  body: 'body',
  work: 'work',
  admin: 'to-do',
  chores: 'chores',
  goals: 'goals',
  habits: 'habits',
  pets: 'pets',
};

/** Modules with no nameable box — nothing to prove, no whisper. */
export const WHISPER_GENERIC_MODULES = new Set(['dump_only', 'journal', 'crisis', '']);

export function whisperLabel(module: string): string {
  return WHISPER_LABELS[module] ?? module;
}

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const FADE_MS = 450;
const LINGER_MS = 10_000;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface FirstDumpWhisperProps {
  /** Primary routed module id (first routable fragment). */
  module: string;
  /** Count of OTHER distinct routed modules → renders " +N". */
  extraCount?: number;
  /** Called when the whisper is done (auto fade-out finished, or tapped). */
  onDone: () => void;
}

export function FirstDumpWhisper({
  module,
  extraCount = 0,
  onDone,
}: FirstDumpWhisperProps): JSX.Element {
  const navigate = useNavigate();
  const reduced = prefersReducedMotion();
  const [visible, setVisible] = useState(reduced); // reduced: no fade, just on
  const doneRef = useRef(false);

  const finish = (openBox: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (openBox) navigate(`/box/${module}`);
    onDone();
  };

  useEffect(() => {
    // Fade in on the next frame so the initial opacity:0 actually paints.
    const raf = reduced ? 0 : requestAnimationFrame(() => setVisible(true));
    // Auto-dismiss: start the fade-out at 10s, unmount after the fade.
    const hide = setTimeout(() => setVisible(false), LINGER_MS);
    const done = setTimeout(
      () => finish(false),
      LINGER_MS + (reduced ? 0 : FADE_MS),
    );
    return () => {
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(hide);
      clearTimeout(done);
    };
    // Mount-once lifecycle by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = whisperLabel(module) + (extraCount > 0 ? ` +${extraCount}` : '');

  return (
    <button
      type="button"
      role="status"
      aria-live="polite"
      aria-label={`Saved to ${label} — open it`}
      onClick={() => finish(true)}
      style={{
        border: 'none',
        background: 'none',
        padding: 0,
        cursor: 'pointer',
        textAlign: 'left',
        opacity: visible ? 1 : 0,
        transition: reduced ? 'none' : `opacity ${FADE_MS}ms ease`,
      }}
    >
      <Row gap={6} align="center">
        <Text scale="caption" color={colors.sageDeep}>
          →
        </Text>
        <Text scale="caption" color={colors.inkSoft}>
          {label}
        </Text>
        <Text scale="caption" color={colors.sage} style={SMCP_STYLE}>
          see it
        </Text>
      </Row>
    </button>
  );
}
