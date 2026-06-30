/**
 * DumpReceipt — the calm post-dump receipt line.
 *
 * Appears under the dump input after a silent route and fades on its own, so
 * the user knows WHERE their dump went without a feed or any noise. Renders
 * module NAMES only (e.g. "Saved to Groceries + Meds.") — never the dumped
 * text, so it's safe at a glance. The copy is built by receiptCopy.ts.
 *
 * Visual idiom: a single sage SMCP line, same quiet grammar as the "worth a
 * glance" kicker. No surface/card, no border — it should feel like a whisper,
 * not a card competing with TodayNoticings.
 */

import type { CSSProperties } from 'react';
import { Text } from '../ui';
import { colors } from '../theme/tokens';
import styles from './DumpScreen.module.css';

const RECEIPT_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

export function DumpReceipt({ text }: { text: string }): JSX.Element {
  return (
    <div className={styles.receipt} role="status" aria-live="polite">
      <Text scale="caption" color={colors.sage} style={RECEIPT_STYLE}>
        {text}
      </Text>
    </div>
  );
}
