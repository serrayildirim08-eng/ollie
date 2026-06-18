/**
 * NeedsConfirmCard — inline confirmation card for uncertain AI routing.
 *
 * Rendered below the dump input when a fragment lands in the 0.60–0.79
 * confidence tier (needsConfirm: true). The card shows what the AI
 * decided and lets the user keep or undo the routing — no modal, no
 * interruption to the dump flow.
 *
 * Visual idiom: hairline border on paper surface, SMCP kicker, two
 * text-only action buttons. Same grammar as GroceryBox's inline rows.
 */

import { useRef, useState, type CSSProperties } from 'react';
import { Stack, Row } from '../layout';
import { Text } from '../ui';
import { colors } from '../theme/tokens';

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

export interface NeedsConfirmCardProps {
  /** First 60 chars of the original fragment text (trimmed by caller). */
  fragmentPreview: string;
  /** e.g. "body · log_symptom" */
  routeLabel: string;
  /** Dismiss the card — the write already happened, this is a no-op on data. */
  onKeep: () => void;
  /** Remove the just-written entry and dismiss the card. */
  onUndo: () => void;
  /**
   * True when the source fragment came from the vision pipeline (photo intake).
   * Renders a quiet "from photo" badge in the top-right of the card.
   */
  fromPhoto?: boolean;
}

export function NeedsConfirmCard({
  fragmentPreview,
  routeLabel,
  onKeep,
  onUndo,
  fromPhoto = false,
}: NeedsConfirmCardProps): JSX.Element {
  // In-flight guard (audit #53): the parent dismisses the card synchronously,
  // but until that re-render commits a fast double-tap can fire keep/undo
  // twice (applying / removing the fragment twice). The ref blocks the
  // synchronous second tap; the state flag visually disables the buttons.
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
        position: 'relative',
      }}
    >
      {fromPhoto && (
        <span
          aria-label="From your photo"
          style={{
            position: 'absolute',
            top: 10,
            right: 12,
            fontFamily: 'inherit',
            fontSize: 10,
            color: colors.sage,
            letterSpacing: '0.10em',
            fontVariantCaps: 'all-small-caps',
          }}
        >
          photo
        </span>
      )}
      <Stack gap={10}>
        {/* kicker */}
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          not sure · confirm?
        </Text>

        {/* fragment preview */}
        <Text scale="body" color={colors.ink} style={{ fontStyle: 'italic' }}>
          &ldquo;{fragmentPreview}&rdquo;
        </Text>

        {/* route label */}
        <Text scale="caption" color={colors.inkSoft} style={SMCP_STYLE}>
          {routeLabel}
        </Text>

        {/* actions */}
        <Row gap={24} align="center" style={{ marginTop: 4 }}>
          <button
            type="button"
            aria-label="Keep this routing"
            onClick={guard(onKeep)}
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
            keep
          </button>
          <button
            type="button"
            aria-label="Undo this routing"
            onClick={guard(onUndo)}
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
            undo
          </button>
        </Row>
      </Stack>
    </div>
  );
}
