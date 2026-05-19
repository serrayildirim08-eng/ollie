/**
 * grocery-v2 · AddScreen — add to grocery (grocery-add.html)
 *
 * The natural-language entry, the v2 way: one quiet underlined line the
 * user just talks to ("2 bags of basmati rice", "got milk", "drop the
 * bread"). As they type, ollie reads the line back live — the detected
 * intent, the item, the quantity — the trust surface. When the word is
 * unknown a calm sage teach-me block offers canonical staples to pin it to.
 *
 * Real data: the live parse is `addParseVM` over `@ollie/logic/grocery`'s
 * `parseGroceryItem`. The commit writes through `useGroceryActions.addParsed`
 * — the SAME `grocery.items` / `grocery.pantry` store the live module uses.
 * `teach` records the override in `grocery.aliasOverrides`.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Screen, AmberButton, IconCheck, v2 } from '../../money-v2/v2';
import { useGrocerySlices } from '../useGrocerySlices';
import { useGroceryActions } from '../useGroceryActions';
import { addParseVM } from '../selectors';

export interface AddScreenProps {
  now: number;
  onBack: () => void;
}

/** the canonical staples the teach-me block offers (grocery-add.html) */
const STAPLES = [
  'rice', 'pasta', 'flour', 'bread', 'oats', 'lentils',
] as const;

export function AddScreen({ now, onBack }: AddScreenProps) {
  const slices = useGrocerySlices();
  const actions = useGroceryActions(now);

  const [raw, setRaw] = useState('');
  const [taughtTo, setTaughtTo] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parse = useMemo(
    () => addParseVM(raw, slices.aliasOverrides),
    [raw, slices.aliasOverrides],
  );

  const showTeach = parse.unknown && raw.trim().length > 0 && !saved;
  const canSave = raw.trim().length > 0 && !saved;

  const commit = () => {
    if (!canSave) return;
    // if the word was just taught, record the override before committing
    if (taughtTo && parse.unknown) {
      actions.teach(raw.trim(), taughtTo);
    }
    const intent = actions.addParsed(raw.trim());
    if (intent) {
      setSaved(true);
      window.setTimeout(() => onBack(), 900);
    }
  };

  return (
    <Screenless onBack={onBack}>
      {/* the lead */}
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
        }}
      >
        <b style={{ fontWeight: 500 }}>say it the way you&rsquo;d say it</b>
      </div>

      {/* the natural-language field — one quiet underlined line */}
      <div
        style={{
          marginTop: 28,
          borderBottom: `1.5px solid ${v2.ink}`,
          paddingBottom: 11,
          display: 'flex',
          alignItems: 'baseline',
        }}
      >
        <input
          type="text"
          value={raw}
          autoFocus
          onChange={(e) => {
            setRaw(e.target.value);
            setTaughtTo(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          placeholder="2 bags of basmati rice"
          aria-label="what to add"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 21,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            fontFamily: v2.sans,
            minWidth: 0,
            padding: 0,
          }}
        />
      </div>

      {/* the parse — ollie reads the line back */}
      {raw.trim().length > 0 && (
        <div
          style={{
            marginTop: 24,
            border: `1px solid ${v2.line}`,
            borderRadius: 18,
            background: v2.card,
            padding: 17,
            boxShadow: '0 6px 16px rgba(42,38,34,.04)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              marginBottom: 13,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: v2.sage,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 11,
                color: v2.mute,
                fontWeight: 700,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
              }}
            >
              here&rsquo;s what ollie read
            </span>
          </div>
          <ParseRow
            label="doing"
            value={parse.intentLabel}
            tone="intent"
            first
          />
          <ParseRow label="item" value={parse.item || '—'} />
          {parse.qty && <ParseRow label="quantity" value={parse.qty} />}
        </div>
      )}

      {/* teach me — the word wasn't in the alias table */}
      {showTeach && (
        <div style={{ marginTop: 22 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: v2.sage,
                flexShrink: 0,
                marginTop: 5,
              }}
            />
            <span
              style={{
                fontSize: 13,
                color: v2.ink,
                fontWeight: 500,
                lineHeight: 1.5,
                letterSpacing: '-0.01em',
              }}
            >
              <b style={{ fontWeight: 600 }}>{parse.item}</b> is new to ollie
              &mdash; point it at a staple so the shelf life and category come
              along.
            </span>
          </div>
          <div
            style={{
              marginTop: 14,
              fontSize: 11,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            teach me &mdash; this is a kind of
          </div>
          <div
            style={{
              marginTop: 11,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            {STAPLES.map((s) => {
              const on = s === taughtTo;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTaughtTo(on ? null : s)}
                  style={{
                    boxSizing: 'border-box',
                    border: `1px solid ${on ? v2.accent : v2.line}`,
                    background: on ? v2.accent : v2.card,
                    borderRadius: 14,
                    padding: '8px 13px',
                    fontSize: 13,
                    fontWeight: on ? 600 : 500,
                    color: on ? '#fff' : v2.ink,
                    letterSpacing: '-0.01em',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* save — full-width amber, the one commit */}
      <AmberButton
        icon={<IconCheck size={22} weight={2.4} />}
        onClick={commit}
        style={{
          marginTop: 34,
          height: 52,
          borderRadius: 26,
          opacity: canSave ? 1 : 0.4,
          cursor: canSave ? 'pointer' : 'default',
        }}
      >
        add it
      </AmberButton>
      {saved && (
        <div
          style={{
            marginTop: 16,
            textAlign: 'center',
            fontSize: 13,
            color: v2.sage,
            fontWeight: 600,
            letterSpacing: '0.01em',
          }}
        >
          on the list.
        </div>
      )}

      {/* a quiet examples line */}
      <div
        style={{
          marginTop: 30,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: v2.line,
            flexShrink: 0,
            marginTop: 5,
          }}
        />
        <span
          style={{
            fontSize: 12,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.6,
          }}
        >
          ollie also reads{' '}
          <i style={{ fontStyle: 'italic', color: v2.ink }}>got milk</i>{' '}
          (straight to pantry),{' '}
          <i style={{ fontStyle: 'italic', color: v2.ink }}>out of coffee</i>,{' '}
          <i style={{ fontStyle: 'italic', color: v2.ink }}>drop the bread</i>{' '}
          &mdash; the verb tells it what to do.
        </span>
      </div>
    </Screenless>
  );
}

// ─── the parse row ───────────────────────────────────────────────────────────

interface ParseRowProps {
  label: string;
  value: string;
  tone?: 'intent';
  first?: boolean;
}

function ParseRow({ label, value, tone, first }: ParseRowProps) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        padding: first ? '0 0 8px 0' : '8px 0',
        borderTop: first ? 'none' : `1px solid ${v2.line}`,
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          width: 74,
          flexShrink: 0,
          letterSpacing: '0.01em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 15,
          color: tone === 'intent' ? v2.umber : v2.ink,
          fontWeight: 600,
          letterSpacing: '-0.01em',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── the add-screen shell ────────────────────────────────────────────────────

/**
 * The add screen mounts in the same warm-paper `Screen` shell as every v2
 * leaf, with the centred `add to grocery` who-label (grocery-add.html).
 */
function Screenless({
  onBack,
  children,
}: {
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <Screen label="add to grocery" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
      {children}
    </Screen>
  );
}
