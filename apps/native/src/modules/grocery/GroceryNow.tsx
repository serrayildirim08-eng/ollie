/**
 * GroceryNow · the "Now" landing surface (clean-slate redesign, 2026-05-31).
 *
 * Self-contained styling: this surface intentionally uses the *redesign*
 * palette + type (warm paper, muted sage #7C8C6F, DM Serif Display headline,
 * sans body, hairline bands) rather than the app's current deep-sage theme
 * tokens — it's the first implemented piece of the approved new direction, so
 * it owns its look. Mockup parity is the goal; see design/clean-slate-2026-05-31.
 *
 * Presentational only — data + handlers come from GroceryBox.
 */

import { useMemo } from 'react';
import type { PantryItem } from './types';
import { ageOf } from './aging';
import { lookupDays } from './shelfLifeCache';

// Redesign palette · bound to the app theme CSS vars so the surface follows
// light/dark (was a literal warm palette; unified 2026-06-16).
const C = {
  ink: 'var(--ollie-color-ink)',
  soft: 'var(--ollie-color-ink-soft)',
  faint: 'var(--ollie-color-ink-faint)',
  hair: 'var(--ollie-color-hairline)',
  sage: 'var(--ollie-color-sage)',
};
const SERIF = '"DM Serif Display", Georgia, "Times New Roman", serif';
const SMCP: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.13em',
  fontSize: 11,
  color: C.faint,
};

export function GroceryNow({
  pantryItems,
  predictedOut,
  shopNames,
  onGoCook,
  onStillGood,
  onGone,
  shelfTick,
}: {
  pantryItems: PantryItem[];
  predictedOut: PantryItem[];
  shopNames: Set<string>;
  onGoCook: () => void;
  onStillGood: (id: string) => void;
  onGone: (id: string) => void;
  shelfTick: number;
}): JSX.Element {
  // "Likely needed" = anything the kitchen is telling us about: items the user
  // (or AI) flagged running low + cadence-predicted run-outs. Both minus what's
  // already on the shopping list, deduped by name. Earlier this only read
  // predicted-out, so a pantry full of "running low" flags showed nothing here.
  const needSoon = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const consider = (name: string) => {
      const key = name.toLowerCase();
      if (shopNames.has(key) || seen.has(key)) return;
      seen.add(key);
      out.push(name);
    };
    pantryItems.filter((it) => it.lowFlag).forEach((it) => consider(it.name));
    predictedOut.forEach((p) => consider(p.name));
    return out.slice(0, 6);
  }, [pantryItems, predictedOut, shopNames]);

  const aging = useMemo(() => {
    void shelfTick;
    const now = Date.now();
    return (
      pantryItems
        .filter((it) => ageOf(it.addedAt, lookupDays(it.name), now) === 'still_here_prompt')
        .sort((a, b) => a.addedAt - b.addedAt)[0] ?? null
    );
  }, [pantryItems, shelfTick]);

  // Gentle peek of what's on hand — the most recently added items. Used when
  // there are no urgent signals (no low / predicted / aging) so Now still has
  // substance instead of an empty "nothing needs you".
  const inKitchen = useMemo(
    () =>
      [...pantryItems]
        .sort((a, b) => b.addedAt - a.addedAt)
        .slice(0, 6)
        .map((it) => it.name),
    [pantryItems],
  );

  const hasUrgent = needSoon.length > 0 || !!aging;
  const emptyKitchen = pantryItems.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* heading */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ ...SMCP, marginBottom: 14 }}>grocery</div>
        <h1
          style={{
            margin: 0,
            fontFamily: SERIF,
            fontWeight: 400,
            fontSize: 32,
            lineHeight: 1.07,
            letterSpacing: '-0.01em',
            color: C.ink,
            maxWidth: 460,
          }}
        >
          {emptyKitchen
            ? 'Your kitchen is empty. Dump what you bought.'
            : hasUrgent
              ? 'A few things worth a glance.'
              : 'Nothing urgent — here’s what’s on hand.'}
        </h1>
      </div>

      {!hasUrgent && inKitchen.length > 0 && (
        <Band label="in your kitchen">
          <div style={{ fontSize: 19, lineHeight: 1.45, color: C.ink }}>
            {inKitchen.join('  ·  ')}
          </div>
        </Band>
      )}

      {needSoon.length > 0 && (
        <Band label="likely needed soon">
          <div style={{ fontSize: 19, lineHeight: 1.45, color: C.ink }}>
            {needSoon.join('  ·  ')}
          </div>
        </Band>
      )}

      {aging && (
        <Band label="getting old">
          <div style={{ fontSize: 19, lineHeight: 1.45, color: C.soft }}>
            the {aging.name} has been here a while.
            <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
              <Link color={C.sage} onClick={() => onStillGood(aging.id)}>
                still good
              </Link>
              <Link color={C.faint} onClick={() => onGone(aging.id)}>
                it’s gone
              </Link>
            </div>
          </div>
        </Band>
      )}

      <Band label="tonight">
        <button
          type="button"
          onClick={onGoCook}
          style={{
            appearance: 'none',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            width: '100%',
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 14,
          }}
        >
          <span
            style={{
              fontFamily: SERIF,
              fontWeight: 400,
              fontSize: 22,
              lineHeight: 1.2,
              color: C.ink,
              textAlign: 'left',
            }}
          >
            dinners you can make from what you have
          </span>
          <span style={{ color: C.sage, fontSize: 20, flexShrink: 0 }}>→</span>
        </button>
      </Band>
    </div>
  );
}

function Band({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ padding: '22px 0', borderTop: `1px solid ${C.hair}` }}>
      <div style={{ ...SMCP, marginBottom: 12 }}>{label}</div>
      {children}
    </div>
  );
}

function Link({
  color,
  onClick,
  children,
}: {
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: 'none',
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        color,
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}
