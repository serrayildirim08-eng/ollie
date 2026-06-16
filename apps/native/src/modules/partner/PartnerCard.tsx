/**
 * PartnerCard · the Level-2 ambient presence on Home (decision 4).
 *
 * A single quiet line — "Serra · tender day · low energy" — no actions, no
 * push, no numbers (decision 3, "ambient knowing"). Renders nothing until
 * paired. Crisis (decision 7/8) and go-dark (decision 9/14) change only the
 * text, never the loudness.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { partnerRepo } from './repo';
import { cardLine } from './interpret';
import type { InterpretedState, PartnerPairing } from './types';

const SMCP: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.13em',
};

export function PartnerCard(): JSX.Element | null {
  const { getToken } = useAuth();
  const getBearer = useCallback(async () => (await getToken()) ?? '', [getToken]);
  const [pairing, setPairing] = useState<PartnerPairing | null>(null);
  const [state, setState] = useState<InterpretedState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const local = await partnerRepo.load();
      if (cancelled) return;
      setPairing(local.pairing);
      if (local.pairing) {
        const theirs = await partnerRepo.getPartnerInterpreted(local, getBearer);
        if (!cancelled) setState(theirs);
      } else {
        setState(null);
      }
    };
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [getBearer]);

  if (!pairing || !state) return null;

  return (
    <Stack
      gap={8}
      style={{
        padding: '18px 20px',
        background: 'var(--ollie-color-paper)',
        border: '1px solid var(--ollie-color-hairline-soft)',
        borderRadius: 4,
      }}
    >
      <Row justify="space-between" align="baseline">
        <Text scale="caption" color="var(--ollie-color-ink-faint)" style={SMCP}>
          {state.crisis ? 'your person' : 'with you'}
        </Text>
      </Row>
      <Text scale="heading" color={state.crisis ? 'var(--ollie-color-sage-deep)' : 'var(--ollie-color-ink)'}>
        {cardLine(pairing.partnerName, state)}
      </Text>
    </Stack>
  );
}
