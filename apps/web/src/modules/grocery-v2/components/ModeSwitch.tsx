/**
 * grocery-v2 · <ModeSwitch> — the 3-mode near-zero-chrome switch
 *
 * The shop · pantry · feed-me switch from every grocery mockup. NOT
 * buttons-in-a-bar: three calm text segments, the active one underlined
 * amber. Mirrors admin-tasks' filter grammar exactly (`.modes` / `.mode`
 * in grocery.html). A real <button> per segment, `aria-pressed`.
 */
import { v2 } from '../../money-v2/v2';

export type GroceryMode = 'shop' | 'pantry' | 'feed';

const LABELS: Record<GroceryMode, string> = {
  shop: 'shop',
  pantry: 'pantry',
  feed: 'feed me',
};

export interface ModeSwitchProps {
  mode: GroceryMode;
  onChange: (mode: GroceryMode) => void;
}

export function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        marginTop: 24,
        display: 'flex',
        gap: 22,
        paddingBottom: 2,
      }}
    >
      {(Object.keys(LABELS) as GroceryMode[]).map((m) => {
        const on = m === mode;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(m)}
            style={{
              boxSizing: 'border-box',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${on ? v2.accent : 'transparent'}`,
              padding: '0 0 7px 0',
              fontSize: 14,
              fontWeight: on ? 600 : 500,
              letterSpacing: '-0.01em',
              color: on ? v2.ink : v2.mute,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {LABELS[m]}
          </button>
        );
      })}
    </div>
  );
}
