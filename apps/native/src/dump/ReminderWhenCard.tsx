/**
 * ReminderWhenCard — the "when?" prompt for a time-less manual reminder.
 *
 * Rendered below the dump input when the user dumps "remind me to X" WITHOUT a
 * time. The to-do already exists (durable record); this card just asks WHEN to
 * fire the notification. Picking a quick-time schedules it; dismissing falls
 * back to 7pm today (handled by the caller via reminderCascade.fallbackFireAt).
 *
 * Same visual idiom as NeedsConfirmCard: hairline border on paper, SMCP kicker,
 * text-only actions — so the dump flow stays calm and uninterrupted.
 */

import { useRef, useState, type CSSProperties } from 'react';
import { Stack, Row } from '../layout';
import { Text } from '../ui';
import { colors } from '../theme/tokens';
import { WHEN_PRESETS } from '../notify/reminderCascade';

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

export interface ReminderWhenCardProps {
  /** The reminder text, e.g. "call mom" — shown so the user knows which one. */
  reminderText: string;
  /** User picked a quick time — `hhmm` is a 24h-local "HH:MM". */
  onPick: (hhmm: string) => void;
  /** User dismissed without choosing → caller schedules the 7pm fallback. */
  onDismiss: () => void;
}

export function ReminderWhenCard({
  reminderText,
  onPick,
  onDismiss,
}: ReminderWhenCardProps): JSX.Element {
  // In-flight guard (mirrors NeedsConfirmCard audit #53): the parent dismisses
  // the card synchronously, but a fast double-tap could fire twice before the
  // re-render commits. The ref blocks the synchronous second tap; the state
  // flag visually disables the buttons.
  const actedRef = useRef(false);
  const [acted, setActed] = useState(false);
  const guard = (fn: () => void) => () => {
    if (actedRef.current) return;
    actedRef.current = true;
    setActed(true);
    fn();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '14px 18px',
        borderRadius: 10,
        background: colors.paper,
        border: `1px solid ${colors.hairline}`,
      }}
    >
      <Stack gap={10}>
        {/* kicker */}
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          remind me to · when?
        </Text>

        {/* the reminder text */}
        <Text scale="body" color={colors.ink} style={{ fontStyle: 'italic' }}>
          &ldquo;{reminderText}&rdquo;
        </Text>

        {/* quick-pick times */}
        <Row gap={20} align="center" style={{ marginTop: 2, flexWrap: 'wrap' }}>
          {WHEN_PRESETS.map((preset) => (
            <button
              key={preset.hhmm}
              type="button"
              aria-label={`Remind ${preset.label}`}
              onClick={guard(() => onPick(preset.hhmm))}
              disabled={acted}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: acted ? 'default' : 'pointer',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '0.04em',
                color: colors.sage,
              }}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Not now"
            onClick={guard(onDismiss)}
            disabled={acted}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: acted ? 'default' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: '0.04em',
              color: colors.inkFaint,
            }}
          >
            not now
          </button>
        </Row>
      </Stack>
    </div>
  );
}
