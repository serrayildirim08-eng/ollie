/**
 * v2-shell · always-on chrome
 *
 * Two pieces of fixed chrome the shell paints over every capture screen:
 *
 *   - <CornerDots> — the Find dot (top-left) and Safe dot (top-right).
 *     DIRECTION.md: "Find and Safe are the only fixed chrome — Find left,
 *     Safe right." Lifted verbatim from throw.html / modules.html `.safe`
 *     + body.html `.find`. iPhone-correct: anchored to the safe-area inset.
 *
 *   - <DeckDots> — the bottom position indicator. Four dots, the active
 *     one a wide ink pill (throw.html `.dots i.on`).
 *
 * Both reuse the money-v2 v2 tokens + icons — the shell ships nothing new.
 */
import { v2, IconSearch, IconShield } from '../money-v2/v2';
import type { DeckScreen } from './types';

const box = { boxSizing: 'border-box' as const };

const cornerDot = {
  ...box,
  position: 'absolute' as const,
  top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
  width: 34,
  height: 34,
  borderRadius: '50%',
  border: `1.5px solid ${v2.line}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  padding: 0,
  cursor: 'pointer',
  zIndex: 20,
  WebkitTapHighlightColor: 'transparent',
};

export interface CornerDotsProps {
  onFind: () => void;
  onSafe: () => void;
  /** dark variant — for the listening (dark canvas) screen */
  dark?: boolean;
}

/** Find (top-left) + Safe (top-right) — fixed on every capture screen. */
export function CornerDots({ onFind, onSafe, dark = false }: CornerDotsProps) {
  const stroke = dark ? 'rgba(250,246,239,.55)' : v2.mute;
  const border = dark ? 'rgba(250,246,239,.18)' : v2.line;
  return (
    <>
      <button
        type="button"
        aria-label="find"
        onClick={onFind}
        style={{
          ...cornerDot,
          borderColor: border,
          left: 'calc(env(safe-area-inset-left, 0px) + 24px)',
        }}
      >
        <IconSearch stroke={stroke} />
      </button>
      <button
        type="button"
        aria-label="safe"
        onClick={onSafe}
        style={{
          ...cornerDot,
          borderColor: border,
          right: 'calc(env(safe-area-inset-right, 0px) + 24px)',
        }}
      >
        <IconShield stroke={stroke} />
      </button>
    </>
  );
}

const DECK_ORDER: DeckScreen[] = ['throw', 'caught', 'noticed', 'modules'];

export interface DeckDotsProps {
  active: DeckScreen;
  /** jump straight to a deck screen — taps are an accessible alt to swipe */
  onJump: (to: DeckScreen) => void;
}

/** the four-dot bottom position indicator for the capture deck. */
export function DeckDots({ active, onJump }: DeckDotsProps) {
  return (
    <div
      role="tablist"
      aria-label="capture"
      style={{
        ...box,
        position: 'absolute',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 30px)',
        left: 0,
        right: 0,
        display: 'flex',
        gap: 9,
        justifyContent: 'center',
        zIndex: 20,
      }}
    >
      {DECK_ORDER.map((d) => {
        const on = d === active;
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={d}
            onClick={() => onJump(d)}
            style={{
              ...box,
              width: on ? 22 : 6,
              height: 6,
              borderRadius: on ? 3 : '50%',
              background: on ? v2.ink : v2.line,
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              transition: 'width .22s ease-out',
              WebkitTapHighlightColor: 'transparent',
            }}
          />
        );
      })}
    </div>
  );
}
