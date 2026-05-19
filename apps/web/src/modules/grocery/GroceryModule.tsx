/**
 * GroceryModule — warm cream (#F5F0E8) background, no sky video.
 * Three modes: pantry (default), shopping, recipes.
 *
 * Data: useStoreSlice('grocery', 'items', []) + ('grocery', 'pantry', [])
 * Logic: @ollie/logic/grocery — parseGroceryItem, detectDuplicate,
 *        learnKnownStore, inferRecipe, detectPatterns (useMemo only, never in render)
 */

import React, { useMemo, useState } from 'react';
import {
  parseGroceryItem,
  detectDuplicate,
  inferRecipe,
  detectPatterns,
  ALIAS_TABLE,
} from '@ollie/logic/grocery';
import type {
  GroceryPattern,
} from '@ollie/logic/grocery';
import { useStoreSlice } from '../../store';

// ─── local types ──────────────────────────────────────────────────────────────

// Extended types — logic package types are minimal; these add app-level fields.
interface StoredPantryItem {
  id?: string;
  name?: string;
  normalizedName?: string;
  category?: string;
  boughtTs?: number;
  shelfLifeDays?: number;
  checked?: boolean;
  ts?: number;
  text?: string;
  qty?: number;
}

interface StoredShoppingItem extends StoredPantryItem {
  addedTs?: number;
}

type Mode = 'pantry' | 'shopping' | 'recipes';

const DIET_FILTERS = ['all', 'vegetarian', 'vegan', 'mediterranean', 'turkish'] as const;
type DietFilter = (typeof DIET_FILTERS)[number];

const TEACH_CANONICALS = [
  'milk', 'yogurt', 'bread', 'egg', 'olive oil', 'tomato', 'onion',
  'rice', 'pasta', 'chicken', 'salt', 'cheese',
] as const;

// ─── shared style helpers ─────────────────────────────────────────────────────

const INK = '#14130F';
const INK_SOFT = '#4B4740';
const INK_MUTED = '#7C7770';
const BG = '#F5F0E8';
const RULE = 'rgba(20,19,15,0.10)';
const SAGE = '#4F6E5B';

const mono = (size: number): React.CSSProperties => ({
  fontFamily: "'DM Mono', monospace",
  fontSize: size,
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
});

const sectionLabel: React.CSSProperties = {
  ...mono(9),
  color: INK_MUTED,
  margin: '0 0 10px 0',
  fontWeight: 500,
};

// ─── sub-components ───────────────────────────────────────────────────────────

// ShelfFillBar: SVG fill-level indicator for pantry items
function ShelfFillBar({ pct, warning }: { readonly pct: number; readonly warning: boolean }) {
  const w = 48;
  const h = 8;
  const fill = Math.max(0, Math.min(1, pct));
  return (
    <svg width={w} height={h} aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <rect x={0} y={0} width={w} height={h} rx={4} fill={warning ? 'rgba(180,100,30,0.12)' : RULE} />
      <rect
        x={0}
        y={0}
        width={Math.round(fill * w)}
        height={h}
        rx={4}
        fill={warning ? '#C97B3A' : SAGE}
        opacity={0.75}
      />
    </svg>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function GroceryModule() {
  // ── Store slices ─────────────────────────────────────────────────────────
  const [items, setItems] = useStoreSlice<StoredShoppingItem[]>('grocery', 'items', []);
  const [pantry, setPantry] = useStoreSlice<StoredPantryItem[]>('grocery', 'pantry', []);
  const [patterns] = useStoreSlice<GroceryPattern[]>('grocery', 'patterns', []);
  const [aliasOverrides, setAliasOverrides] = useStoreSlice<Record<string, string>>(
    'grocery', 'aliasOverrides', {},
  );

  // ── Local UI state ───────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('pantry');
  const [newItem, setNewItem] = useState('');
  const [teachItem, setTeachItem] = useState<string | null>(null);
  const [recipeSearch, setRecipeSearch] = useState('');
  const [dietFilter, setDietFilter] = useState<DietFilter>('all');
  const [stockedExpanded, setStockedExpanded] = useState(false);

  const now = Date.now();

  // ── Derived / memoised ───────────────────────────────────────────────────

  // Logic calls — cast our extended types to logic's minimal types
  const logicPantry = useMemo(
    () => (pantry ?? []) as import('@ollie/logic/grocery').PantryItem[],
    [pantry],
  );
  const logicItems = useMemo(
    () => (items ?? []) as import('@ollie/logic/grocery').ShoppingItem[],
    [items],
  );

  const suggestion = useMemo(
    () => inferRecipe({ pantry: logicPantry, now }, {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logicPantry],
  );

  const recipeSuggestion = useMemo(() => {
    if (!recipeSearch.trim()) return null;
    return inferRecipe({ pantry: logicPantry, now }, { dishHint: recipeSearch.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logicPantry, recipeSearch]);

  const duplicate = useMemo(
    () => {
      if (!pantry || pantry.length < 2) return null;
      return detectDuplicate({ pantry: logicPantry, items: logicItems, now }, {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logicPantry, logicItems],
  );

  const computedPatterns = useMemo(
    () => detectPatterns({ pantry: logicPantry, items: logicItems, now }, {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logicPantry, logicItems],
  );

  const noticed = useMemo(
    () => (Array.isArray(patterns) && patterns.length > 0 ? patterns : computedPatterns),
    [patterns, computedPatterns],
  );

  // Pantry shelf segmentation
  const DAY_MS = 86_400_000;

  const critical = useMemo(
    () =>
      (pantry ?? []).filter((p) => {
        if (typeof p.boughtTs !== 'number') return false;
        const shelf = typeof p.shelfLifeDays === 'number'
          ? p.shelfLifeDays
          : (ALIAS_TABLE[(p.normalizedName ?? p.name ?? '').toLowerCase()]?.shelfLifeDays ?? 14);
        const expiresAt = p.boughtTs + shelf * DAY_MS;
        return expiresAt - now <= 2 * DAY_MS && now < expiresAt;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pantry],
  );

  const watching = useMemo(
    () =>
      (pantry ?? []).filter((p) => {
        if (typeof p.boughtTs !== 'number') return false;
        const shelf = typeof p.shelfLifeDays === 'number'
          ? p.shelfLifeDays
          : (ALIAS_TABLE[(p.normalizedName ?? p.name ?? '').toLowerCase()]?.shelfLifeDays ?? 14);
        const expiresAt = p.boughtTs + shelf * DAY_MS;
        const daysLeft = (expiresAt - now) / DAY_MS;
        return daysLeft > 2 && daysLeft <= 7;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pantry],
  );

  const stocked = useMemo(
    () =>
      (pantry ?? []).filter((p) => {
        if (typeof p.boughtTs !== 'number') return true;
        const shelf = typeof p.shelfLifeDays === 'number'
          ? p.shelfLifeDays
          : (ALIAS_TABLE[(p.normalizedName ?? p.name ?? '').toLowerCase()]?.shelfLifeDays ?? 14);
        const expiresAt = p.boughtTs + shelf * DAY_MS;
        return (expiresAt - now) / DAY_MS > 7;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pantry],
  );

  const openItems = useMemo(
    () => (items ?? []).filter((i) => !i.checked),
    [items],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  function onAdd() {
    const raw = newItem.trim();
    if (!raw) return;

    let parsed = null;
    try { parsed = parseGroceryItem(raw); } catch (_) { /* noop */ }

    const overrideKey = raw.toLowerCase();
    const overrideCanon = aliasOverrides?.[overrideKey];

    if (!parsed || parsed.intent === 'UNKNOWN') {
      setTeachItem(raw);
      setNewItem('');
      return;
    }

    if (parsed.intent === 'BOUGHT') {
      const name = overrideCanon ?? parsed.name;
      const alias = ALIAS_TABLE[name];
      setPantry([...(pantry ?? []), {
        id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        normalizedName: name,
        category: parsed.category,
        boughtTs: Date.now(),
        qty: parsed.qty,
        shelfLifeDays: alias?.shelfLifeDays ?? 14,
      }]);
    } else if (parsed.intent === 'REMOVE') {
      const target = (overrideCanon ?? parsed.normalizedName ?? parsed.name ?? '').toLowerCase();
      setItems((items ?? []).filter(
        (i) => ((i.normalizedName ?? i.name ?? '').toLowerCase() !== target) || !!i.checked,
      ));
    } else {
      const name = overrideCanon ?? parsed.name;
      setItems([...(items ?? []), {
        id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        normalizedName: parsed.normalizedName ?? (overrideCanon ?? null),
        category: parsed.category ?? 'other',
        addedTs: Date.now(),
        ts: Date.now(),
        checked: false,
      }]);
    }
    setNewItem('');
  }

  function checkOff(id: string) {
    const it = (items ?? []).find((i) => i.id === id);
    if (!it) return;
    const name = it.normalizedName ?? it.name ?? 'item';
    const alias = ALIAS_TABLE[name];
    const next = (items ?? []).filter((i) => i.id !== id);
    setItems(next);
    setPantry([...(pantry ?? []), {
      id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      normalizedName: name,
      category: it.category ?? 'other',
      boughtTs: Date.now(),
      qty: it.qty,
      shelfLifeDays: alias?.shelfLifeDays ?? 14,
    }]);
  }

  function removeItem(id: string) {
    setItems((items ?? []).filter((i) => i.id !== id));
  }

  function sweepAll() {
    const open = (items ?? []).filter((i) => !i.checked);
    if (!open.length) return;
    const newPantry: StoredPantryItem[] = open.map((it) => {
      const name = it.normalizedName ?? it.name ?? 'item';
      const alias = ALIAS_TABLE[name];
      return {
        id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        normalizedName: name,
        category: it.category ?? 'other',
        boughtTs: Date.now(),
        qty: it.qty,
        shelfLifeDays: alias?.shelfLifeDays ?? 14,
      };
    });
    setItems((items ?? []).filter((i) => !!i.checked));
    setPantry([...(pantry ?? []), ...newPantry]);
  }

  function teachConfirm(canon: string) {
    if (!teachItem) return;
    const next = { ...(aliasOverrides ?? {}), [teachItem.toLowerCase()]: canon };
    setAliasOverrides(next);
    setNewItem(teachItem);
    setTeachItem(null);
  }

  function addMissingIngredients(missing: string[]) {
    const additions: StoredShoppingItem[] = missing.map((m) => ({
      id: `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: m,
      normalizedName: m,
      category: 'other',
      addedTs: Date.now(),
      ts: Date.now(),
      checked: false,
    }));
    setItems([...(items ?? []), ...additions]);
  }

  function fmtDaysLeft(p: StoredPantryItem): string {
    if (typeof p.boughtTs !== 'number') return '';
    const shelf = typeof p.shelfLifeDays === 'number'
      ? p.shelfLifeDays
      : (ALIAS_TABLE[(p.normalizedName ?? p.name ?? '').toLowerCase()]?.shelfLifeDays ?? 14);
    const d = Math.round((p.boughtTs + shelf * DAY_MS - now) / DAY_MS);
    if (d <= 0) return 'today';
    if (d === 1) return '1 day';
    return `${d} days`;
  }

  function fillPct(p: StoredPantryItem): number {
    if (typeof p.boughtTs !== 'number') return 1;
    const shelf = typeof p.shelfLifeDays === 'number'
      ? p.shelfLifeDays
      : (ALIAS_TABLE[(p.normalizedName ?? p.name ?? '').toLowerCase()]?.shelfLifeDays ?? 14);
    return (p.boughtTs + shelf * DAY_MS - now) / (shelf * DAY_MS);
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const modeBtn = (id: Mode, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setMode(id)}
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: mode === id ? `2px solid ${INK}` : '2px solid transparent',
        padding: '8px 4px',
        fontFamily: "'DM Mono', monospace",
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: mode === id ? INK : INK_MUTED,
        cursor: 'pointer',
        transition: 'color 150ms, border-color 150ms',
      }}
    >
      {label}
    </button>
  );

  const pantryItemRow = (p: StoredPantryItem, warning: boolean, idx: number) => {
    const pct = fillPct(p);
    return (
      <div
        key={p.id ?? `pi-${idx}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 0',
          borderBottom: `1px solid ${RULE}`,
        }}
      >
        <ShelfFillBar pct={pct} warning={warning} />
        <div style={{ flex: 1, fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: INK }}>
          {p.name ?? p.text ?? 'item'}
        </div>
        <div style={{ ...mono(9), color: warning ? '#C97B3A' : INK_MUTED }}>
          {fmtDaysLeft(p)}
        </div>
      </div>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        background: BG,
        color: INK,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: '48px 32px 120px',
          boxSizing: 'border-box',
        }}
      >
        {/* Mode tabs */}
        <nav
          aria-label="grocery view"
          style={{ display: 'flex', gap: 24, marginBottom: 36, borderBottom: `1px solid ${RULE}` }}
        >
          {modeBtn('pantry', 'pantry')}
          {modeBtn('shopping', 'shopping')}
          {modeBtn('recipes', 'recipes')}
        </nav>

        {/* ═══ PANTRY MODE ═══ */}
        {mode === 'pantry' && (
          <section aria-label="pantry">

            {/* CRITICAL shelf */}
            {critical.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <p style={{ ...sectionLabel, color: '#C97B3A' }}>
                  critical — use soon
                </p>
                <div
                  style={{
                    background: 'rgba(201,123,58,0.06)',
                    border: `1px solid rgba(201,123,58,0.22)`,
                    borderRadius: 12,
                    padding: '4px 16px',
                  }}
                >
                  {critical.map((p, i) => pantryItemRow(p, true, i))}
                </div>
              </div>
            )}

            {/* WATCHING shelf */}
            {watching.length > 0 && (
              <div style={{ marginBottom: 32 }}>
                <p style={sectionLabel}>watching — expires in 7 days</p>
                <div
                  style={{
                    background: 'rgba(255,255,255,0.55)',
                    border: `1px solid ${RULE}`,
                    borderRadius: 12,
                    padding: '4px 16px',
                  }}
                >
                  {watching.map((p, i) => pantryItemRow(p, false, i))}
                </div>
              </div>
            )}

            {/* STOCKED shelf — collapsed by default */}
            <div style={{ marginBottom: 32 }}>
              <button
                type="button"
                onClick={() => setStockedExpanded((v) => !v)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  marginBottom: stockedExpanded ? 12 : 0,
                }}
                aria-expanded={stockedExpanded}
              >
                <p style={{ ...sectionLabel, margin: 0 }}>
                  stocked — {stocked.length} item{stocked.length !== 1 ? 's' : ''}
                </p>
                <span style={{ ...mono(9), color: INK_MUTED }}>
                  {stockedExpanded ? '▲' : '▼'}
                </span>
              </button>

              {stockedExpanded && stocked.length > 0 && (
                <div
                  style={{
                    background: 'rgba(255,255,255,0.55)',
                    border: `1px solid ${RULE}`,
                    borderRadius: 12,
                    padding: '4px 16px',
                    marginTop: 12,
                  }}
                >
                  {stocked.map((p, i) => pantryItemRow(p, false, i))}
                </div>
              )}

              {stocked.length === 0 && !critical.length && !watching.length && (
                <p
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 14,
                    color: INK_MUTED,
                    marginTop: 8,
                  }}
                >
                  pantry empty. add what you bought, or dump groceries to add items.
                </p>
              )}
            </div>

            {/* Feed me — recipe suggestion */}
            {suggestion && suggestion.found && (
              <div
                style={{
                  background: 'rgba(79,110,91,0.06)',
                  border: '1px solid rgba(79,110,91,0.18)',
                  borderRadius: 12,
                  padding: '20px 22px',
                  marginBottom: 28,
                }}
              >
                <p style={{ ...sectionLabel, margin: '0 0 8px 0' }}>feed me</p>
                <p
                  style={{
                    fontFamily: "'DM Serif Display', serif",
                    fontSize: 22,
                    color: INK,
                    margin: '0 0 6px 0',
                    fontWeight: 400,
                  }}
                >
                  {suggestion.dish}?
                </p>
                <p
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 13,
                    color: INK_SOFT,
                    lineHeight: 1.5,
                    margin: 0,
                  }}
                >
                  {suggestion.copy}
                </p>
                {suggestion.missing && suggestion.missing.length > 0 && suggestion.missing.length <= 4 && (
                  <button
                    type="button"
                    onClick={() => addMissingIngredients(suggestion!.missing!)}
                    style={{
                      marginTop: 12,
                      background: 'transparent',
                      border: `1px solid ${RULE}`,
                      borderRadius: 12,
                      padding: '8px 14px',
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 10,
                      letterSpacing: '0.1em',
                      color: INK_MUTED,
                      cursor: 'pointer',
                    }}
                  >
                    + add {suggestion.missing.length} missing
                  </button>
                )}
              </div>
            )}

            {/* Noticed patterns */}
            {noticed.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <p style={sectionLabel}>noticed</p>
                {noticed.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 13,
                      color: INK_SOFT,
                      padding: '10px 0',
                      borderTop: `1px solid ${RULE}`,
                      lineHeight: 1.5,
                    }}
                  >
                    {'copy' in p ? p.copy : null}
                  </div>
                ))}
              </div>
            )}

            {duplicate && (
              <div
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13,
                  color: INK_SOFT,
                  padding: '10px 0',
                  borderTop: `1px solid ${RULE}`,
                  lineHeight: 1.5,
                }}
              >
                {duplicate.copy}
              </div>
            )}
          </section>
        )}

        {/* ═══ SHOPPING MODE ═══ */}
        {mode === 'shopping' && (
          <section aria-label="shopping list">
            {/* Add input */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
              <input
                type="text"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); }}
                placeholder="+ add eggs, milk, bread"
                aria-label="add grocery item"
                style={{
                  flex: 1,
                  background: 'rgba(255,255,255,0.8)',
                  border: `1px solid ${RULE}`,
                  borderRadius: 14,
                  padding: '14px 18px',
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 15,
                  color: INK,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={onAdd}
                style={{
                  background: 'transparent',
                  border: `1px solid ${RULE}`,
                  borderRadius: 14,
                  padding: '0 20px',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  color: INK_MUTED,
                  cursor: 'pointer',
                  minHeight: 52,
                }}
              >
                add
              </button>
            </div>

            {/* Teach-me prompt */}
            {teachItem && (
              <div
                style={{
                  background: 'rgba(255,255,255,0.7)',
                  border: `1px solid ${RULE}`,
                  borderRadius: 12,
                  padding: '14px 18px',
                  marginBottom: 20,
                }}
              >
                <p style={{ ...sectionLabel, margin: '0 0 6px 0' }}>teach me this item</p>
                <p
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 14,
                    color: INK,
                    margin: '0 0 10px 0',
                  }}
                >
                  what is &ldquo;{teachItem}&rdquo;?
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {TEACH_CANONICALS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => teachConfirm(c)}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${RULE}`,
                        borderRadius: 12,
                        padding: '6px 12px',
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        color: INK,
                        cursor: 'pointer',
                      }}
                    >
                      {c}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setTeachItem(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: '6px 12px',
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 10,
                      letterSpacing: '0.1em',
                      color: INK_MUTED,
                      cursor: 'pointer',
                    }}
                  >
                    skip
                  </button>
                </div>
              </div>
            )}

            {/* List */}
            {openItems.length === 0 ? (
              <p
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 14,
                  color: INK_MUTED,
                  padding: '12px 0',
                }}
              >
                list is empty. start typing above.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px 0' }}>
                {openItems.map((it) => {
                  const display = it.name ?? it.text ?? 'item';
                  const key = it.id ?? `li-${it.ts ?? display}`;
                  return (
                    <li
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        minHeight: 52,
                        padding: '4px 8px',
                        borderBottom: `1px solid ${RULE}`,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => it.id && checkOff(it.id)}
                        aria-label={`check off ${display}`}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          border: `1.5px solid ${RULE}`,
                          background: 'transparent',
                          flexShrink: 0,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: 17,
                          color: INK,
                        }}
                      >
                        {display}
                      </span>
                      <button
                        type="button"
                        onClick={() => it.id && removeItem(it.id)}
                        aria-label={`remove ${display}`}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: INK_MUTED,
                          cursor: 'pointer',
                          fontSize: 14,
                          opacity: 0.4,
                          padding: '4px 8px',
                          minHeight: 44,
                        }}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Sweep all */}
            {openItems.length > 1 && (
              <button
                type="button"
                onClick={sweepAll}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'rgba(79,110,91,0.08)',
                  border: '1px solid rgba(79,110,91,0.25)',
                  borderRadius: 14,
                  padding: '14px 18px',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 12,
                  letterSpacing: '0.1em',
                  color: SAGE,
                  cursor: 'pointer',
                  marginBottom: 20,
                }}
              >
                got everything
              </button>
            )}

            {/* Recently bought */}
            {(pantry ?? []).length > 0 && (
              <div style={{ marginTop: 24 }}>
                <p style={sectionLabel}>recently bought</p>
                {(pantry ?? []).slice(-6).reverse().map((p, idx) => (
                  <div
                    key={p.id ?? `recent-${idx}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '6px 8px',
                      opacity: 0.6,
                    }}
                  >
                    <span style={{ fontSize: 11, color: SAGE }}>✓</span>
                    <span
                      style={{
                        flex: 1,
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 14,
                        color: INK,
                      }}
                    >
                      {p.name ?? p.text ?? 'item'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ═══ RECIPES MODE ═══ */}
        {mode === 'recipes' && (
          <section aria-label="recipes">
            {/* Search */}
            <input
              type="search"
              value={recipeSearch}
              onChange={(e) => setRecipeSearch(e.target.value)}
              placeholder="search recipe — mercimek çorbası, pasta, shakshuka..."
              aria-label="recipe search"
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.8)',
                border: `1px solid ${RULE}`,
                borderRadius: 14,
                padding: '14px 18px',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 15,
                color: INK,
                outline: 'none',
                marginBottom: 20,
                boxSizing: 'border-box',
              }}
            />

            {/* Diet filter pills */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
              {DIET_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setDietFilter(f)}
                  style={{
                    background: dietFilter === f ? INK : 'transparent',
                    border: `1px solid ${dietFilter === f ? INK : RULE}`,
                    borderRadius: 20,
                    padding: '6px 14px',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'lowercase',
                    color: dietFilter === f ? BG : INK_MUTED,
                    cursor: 'pointer',
                    transition: 'background 150ms, color 150ms',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Recipe result */}
            {recipeSearch.trim() ? (
              recipeSuggestion && recipeSuggestion.found ? (
                <div
                  style={{
                    background: 'rgba(255,255,255,0.65)',
                    border: `1px solid ${RULE}`,
                    borderRadius: 16,
                    padding: '24px 28px',
                    marginBottom: 20,
                  }}
                >
                  <p
                    style={{
                      fontFamily: "'DM Serif Display', serif",
                      fontSize: 24,
                      fontWeight: 400,
                      color: INK,
                      margin: '0 0 6px 0',
                    }}
                  >
                    {recipeSuggestion.dish}
                  </p>
                  {recipeSuggestion.cuisine && (
                    <p style={{ ...mono(9), color: INK_MUTED, margin: '0 0 14px 0' }}>
                      {recipeSuggestion.cuisine}
                    </p>
                  )}
                  <p
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 13,
                      color: INK_SOFT,
                      lineHeight: 1.5,
                      margin: '0 0 16px 0',
                    }}
                  >
                    {recipeSuggestion.copy}
                  </p>

                  {/* Ingredient split */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {(recipeSuggestion.have?.length ?? 0) > 0 && (
                      <div>
                        <p style={{ ...sectionLabel, margin: '0 0 8px 0' }}>have</p>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {recipeSuggestion.have!.map((ing) => (
                            <li
                              key={ing}
                              style={{
                                fontFamily: "'DM Sans', sans-serif",
                                fontSize: 13,
                                color: INK_SOFT,
                                padding: '3px 0',
                              }}
                            >
                              {ing}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(recipeSuggestion.missing?.length ?? 0) > 0 && (
                      <div>
                        <p style={{ ...sectionLabel, margin: '0 0 8px 0' }}>need</p>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {recipeSuggestion.missing!.map((ing) => (
                            <li
                              key={ing}
                              style={{
                                fontFamily: "'DM Sans', sans-serif",
                                fontSize: 13,
                                color: INK_MUTED,
                                padding: '3px 0',
                              }}
                            >
                              {ing}
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() => addMissingIngredients(recipeSuggestion!.missing!)}
                          style={{
                            marginTop: 10,
                            background: 'transparent',
                            border: `1px solid ${RULE}`,
                            borderRadius: 10,
                            padding: '7px 12px',
                            fontFamily: "'DM Mono', monospace",
                            fontSize: 10,
                            letterSpacing: '0.1em',
                            color: INK_MUTED,
                            cursor: 'pointer',
                          }}
                        >
                          + add to list
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <p
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 14,
                    color: INK_MUTED,
                    padding: '12px 0',
                  }}
                >
                  no recipe found for &ldquo;{recipeSearch}&rdquo;.
                </p>
              )
            ) : (
              /* Default: pantry-based suggestion */
              suggestion && suggestion.found ? (
                <div
                  style={{
                    background: 'rgba(255,255,255,0.65)',
                    border: `1px solid ${RULE}`,
                    borderRadius: 16,
                    padding: '24px 28px',
                  }}
                >
                  <p style={{ ...sectionLabel, margin: '0 0 8px 0' }}>based on your pantry</p>
                  <p
                    style={{
                      fontFamily: "'DM Serif Display', serif",
                      fontSize: 24,
                      fontWeight: 400,
                      color: INK,
                      margin: '0 0 6px 0',
                    }}
                  >
                    {suggestion.dish}?
                  </p>
                  {suggestion.cuisine && (
                    <p style={{ ...mono(9), color: INK_MUTED, margin: '0 0 14px 0' }}>
                      {suggestion.cuisine}
                    </p>
                  )}
                  <p
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 13,
                      color: INK_SOFT,
                      lineHeight: 1.5,
                      margin: 0,
                    }}
                  >
                    {suggestion.copy}
                  </p>
                  {(suggestion.missing?.length ?? 0) > 0 && (suggestion.missing?.length ?? 0) <= 4 && (
                    <button
                      type="button"
                      onClick={() => addMissingIngredients(suggestion!.missing!)}
                      style={{
                        marginTop: 12,
                        background: 'transparent',
                        border: `1px solid ${RULE}`,
                        borderRadius: 10,
                        padding: '8px 14px',
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 10,
                        letterSpacing: '0.1em',
                        color: INK_MUTED,
                        cursor: 'pointer',
                      }}
                    >
                      + add {suggestion.missing!.length} missing
                    </button>
                  )}
                </div>
              ) : (
                <p
                  style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 14,
                    color: INK_MUTED,
                  }}
                >
                  add items to your pantry to get recipe suggestions.
                </p>
              )
            )}
          </section>
        )}
      </div>
    </div>
  );
}
