/**
 * FirstRunGuide — the guided empty state for a brand-new user.
 *
 * The app has no onboarding flow (report §A); a first-time user lands on a
 * blank dump box with no idea what to do. This is the lightest possible fix:
 * one line of what Ollie is + three tappable example chips that fill the dump
 * box, so the first move is obvious. It shows ONLY until the first dump, then
 * the box's silent default takes over (DumpScreen hides it).
 *
 * Deliberately NOT a multi-screen tour, questionnaire, or template picker —
 * ADHD-first means the first 60 seconds is one tap, not setup.
 *
 * Visual idiom: quiet sage SMCP kicker + cream chips, same grammar as the
 * module hints. No card around the whole thing — a whisper under the box.
 */

import type { CSSProperties } from 'react';
import { Stack, Row } from '../layout';
import { Text } from '../ui';
import { colors, shadows } from '../theme/tokens';

/** Example dumps — one per common life area (groceries, meds, money). */
const EXAMPLES = ['out of milk', 'took vitamin d', 'cancel netflix friday'];

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

export function FirstRunGuide({ onPick }: { onPick: (text: string) => void }): JSX.Element {
  return (
    <Stack gap={14} style={{ marginTop: 4 }}>
      <Text scale="body" color={colors.inkSoft} style={{ lineHeight: 1.45 }}>
        dump anything. ollie sorts it.
      </Text>

      <Stack gap={8}>
        <Text scale="caption" color={colors.sage} style={SMCP_STYLE}>
          try one
        </Text>
        <Row gap={8} align="center" style={{ flexWrap: 'wrap' }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => onPick(ex)}
              style={{
                border: 'none',
                background: colors.cream,
                boxShadow: shadows.raisedSm,
                borderRadius: 999,
                padding: '8px 14px',
                cursor: 'pointer',
                color: colors.ink,
                fontFamily: 'var(--ollie-font-sans)',
                fontSize: 13,
                letterSpacing: '-0.01em',
              }}
            >
              {ex}
            </button>
          ))}
        </Row>
      </Stack>

      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
        no streaks. no pressure.
      </Text>
    </Stack>
  );
}
