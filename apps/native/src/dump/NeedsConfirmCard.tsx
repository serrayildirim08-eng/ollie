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

import type { CSSProperties } from 'react';
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
}

export function NeedsConfirmCard({
  fragmentPreview,
  routeLabel,
  onKeep,
  onUndo,
}: NeedsConfirmCardProps): JSX.Element {
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
            onClick={onKeep}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
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
            onClick={onUndo}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
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
