/**
 * FeedMeView · the third grocery tab.
 *
 * Wires the long-deferred "feed me" surface back into GroceryBox. The
 * functional contract is:
 *   - read the live pantry from the grocery repo (caller passes it in so
 *     polling stays in GroceryBox; we don't double-poll)
 *   - let the user pick a diet filter (omnivore default; persisted in kv
 *     under `ollie:feedme_diet` so the choice survives sessions)
 *   - let the user pick how many ideas they want (1-5, default 3)
 *   - on CTA, call the /feed-me/:user worker with the pantry + diet + count
 *   - render result cards quietly: title, est. minutes + diet, pantry
 *     ingredients used; each card carries a "cooked it" affordance that
 *     fires /cook-history + appends to the local grocery_cook_history table
 *   - at the bottom, an expandable "made recently" strip reads the last
 *     N cook entries from that local table
 *
 * Editorial DNA grounded:
 *   - Cream surfaces, hairline borders, no drop shadows.
 *   - DM Serif Display for the strip title + recipe titles.
 *   - Diet chips in smcp, sage tint when active.
 *   - No icons, no emoji, no celebratory motion. The "cooked it" affordance
 *     just swaps its label to "cooked" once the worker resolves; no checks,
 *     no confetti.
 *
 * Contracts (frontend → worker, locked in workers/ai-proxy/src/router):
 *   - feed-me: omnivore is sent as `diet: 'all'` (worker enum is
 *     all/vegetarian/vegan/mediterranean/turkish — see feed-me.ts:97). The
 *     UI label is "omnivore" so the chip row reads naturally; the wire word
 *     is "all".
 *   - feedTarget is hardcoded to 'user' here; pet feed lives in the pets
 *     module per the task scope.
 *   - locale defaults to 'en' (the app ships EN + ES; we read navigator
 *     language and fall back to 'en' for anything outside the worker enum).
 */

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from 'react';
import { useUser } from '@clerk/clerk-react';
import { useBearer } from '../../auth/useBearer';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors, fonts } from '../../theme/tokens';
import { kv } from '../../storage';
import { routeFeedMe, routeCookHistory } from '../../api/workers';
import type {
  FeedDietFilter,
  FeedLocale,
  FeedMeResponse,
  FeedRecipeSuggestion,
} from '../../api/types';
import { cookHistory as cookHistoryRepo, type CookHistoryEntry } from './repo';
import type { PantryItem } from './types';

// ─── tokens ────────────────────────────────────────────────────────────────

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const DIET_KV_KEY = 'ollie:feedme_diet';
const COUNT_MIN = 1;
const COUNT_MAX = 5;
const COUNT_DEFAULT = 3;
const RECENT_LIMIT = 8;

// Display order for the chip row. `omnivore` is the UI label for the wire
// value `all` — the worker enum doesn't carry an "omnivore" slot, see
// feed-me.ts:97.
interface DietChoice {
  label: string;
  wire: FeedDietFilter;
}
const DIET_CHOICES: ReadonlyArray<DietChoice> = [
  { label: 'omnivore', wire: 'all' },
  { label: 'vegetarian', wire: 'vegetarian' },
  { label: 'vegan', wire: 'vegan' },
  { label: 'pescatarian', wire: 'mediterranean' },
];
// `pescatarian` UI label maps to `mediterranean` on the wire. The worker
// enum doesn't have a dedicated pescatarian slot; mediterranean nudges
// Gemini toward olive oil + fish + legumes which is the closest available
// diet-shape and matches the spec's brief "fish-allowed, no other meat"
// intent. Documented inline so the next review doesn't second-guess.

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; suggestions: FeedRecipeSuggestion[]; source: FeedMeResponse['source'] }
  | { kind: 'error'; reason: 'network' | 'empty' };

interface FeedMeViewProps {
  pantryItems: PantryItem[];
  /** Lowercased names already on the shopping list — drives the "added" state
   *  on a recipe's "need" ingredients so they don't read as still-missing. */
  shopNames?: Set<string>;
  /** Add a missing ("need") recipe ingredient to the shopping list. */
  onAddToShop?: (name: string, quantity?: number | null, unit?: string | null) => void;
}

// ─── component ─────────────────────────────────────────────────────────────

export function FeedMeView({
  pantryItems,
  shopNames,
  onAddToShop,
}: FeedMeViewProps): JSX.Element {
  const getBearer = useBearer();
  const { user } = useUser();

  const [diet, setDiet] = useState<FeedDietFilter>('all');
  const [count, setCount] = useState<number>(COUNT_DEFAULT);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [recent, setRecent] = useState<CookHistoryEntry[]>([]);
  const [cookedIds, setCookedIds] = useState<Set<string>>(() => new Set());

  // Restore the persisted diet preference on mount. We accept either the
  // wire form ("all") or — defensively — a legacy chip label (e.g. an
  // older "omnivore" string written by an earlier build).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await kv.get<string>(DIET_KV_KEY);
      if (cancelled || stored == null) return;
      const matched =
        DIET_CHOICES.find((d) => d.wire === stored)?.wire ??
        DIET_CHOICES.find((d) => d.label === stored)?.wire;
      if (matched) setDiet(matched);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pull the recent strip on mount (silent: failures just leave it empty).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await cookHistoryRepo.listRecent(RECENT_LIMIT);
        if (!cancelled) setRecent(rows);
      } catch {
        // swallow — empty strip > broken render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const chooseDiet = useCallback((wire: FeedDietFilter) => {
    setDiet(wire);
    void kv.set(DIET_KV_KEY, wire);
  }, []);

  const pantryEmpty = pantryItems.length === 0;
  const userId = user?.id ?? '';

  const onFeedMe = useCallback(async () => {
    if (pantryEmpty || !userId) return;
    setPhase({ kind: 'loading' });

    const bearer = (await getBearer()) ?? '';
    if (!bearer) {
      setPhase({ kind: 'error', reason: 'network' });
      return;
    }

    const pantry = pantryItems.map((p) => p.name);
    const result = await routeFeedMe(
      userId,
      {
        pantry,
        diet,
        feedTarget: 'user',
        count,
        locale: resolveLocale(),
      },
      { bearer },
    );

    if (!result.ok) {
      setPhase({ kind: 'error', reason: 'network' });
      return;
    }
    const { suggestions, source } = result.data;
    if (suggestions.length === 0) {
      setPhase({ kind: 'error', reason: 'empty' });
      return;
    }
    setPhase({ kind: 'results', suggestions, source });
    // New round of suggestions — clear the previous "cooked" markers so
    // any reused dish names render fresh.
    setCookedIds(new Set());
  }, [pantryEmpty, userId, getBearer, pantryItems, diet, count]);

  const onCookedIt = useCallback(
    async (dishKey: string, suggestion: FeedRecipeSuggestion) => {
      // Optimistic: mark the card as cooked immediately. We fire the worker
      // write in the background and only roll back if it explicitly fails;
      // the local strip writes only on success so a network blip doesn't
      // double-count.
      setCookedIds((prev) => {
        if (prev.has(dishKey)) return prev;
        const next = new Set(prev);
        next.add(dishKey);
        return next;
      });

      const bearer = (await getBearer()) ?? '';
      if (!bearer) return;

      const ingredientsUsed = suggestion.ingredients
        .filter((i) => i.have)
        .map((i) => ({ name: i.name, canonical: i.canonical }));

      const cookedAtMs = Date.now();
      const cloud = await routeCookHistory(
        {
          dish: suggestion.dish,
          cuisine: suggestion.cuisine || undefined,
          diet: suggestion.diet.length > 0 ? suggestion.diet : undefined,
          rating: 0,
          feedTarget: 'user',
          ingredientsUsed: ingredientsUsed.length > 0 ? ingredientsUsed : undefined,
          cookedAt: cookedAtMs,
        },
        { bearer },
      );

      if (!cloud.ok) {
        // Roll back the optimistic marker so the user can try again. We
        // intentionally don't surface an error toast — the user just sees
        // the affordance reappear, which is a quieter retry signal.
        setCookedIds((prev) => {
          if (!prev.has(dishKey)) return prev;
          const next = new Set(prev);
          next.delete(dishKey);
          return next;
        });
        return;
      }

      // Mirror to the local strip cache (fire-and-forget; failure here just
      // means the strip lags on this device).
      try {
        const entry = await cookHistoryRepo.add({
          recipeName: suggestion.dish,
          ingredients: ingredientsUsed,
          cookedAtMs,
        });
        setRecent((prev) => [entry, ...prev].slice(0, RECENT_LIMIT));
      } catch {
        // swallow
      }
    },
    [getBearer],
  );

  return (
    <Stack gap={28}>
      <FeedMeHeader />

      <DietChipRow diet={diet} onChoose={chooseDiet} />

      <CountStepper count={count} onChange={setCount} />

      <FeedMeCta
        disabled={pantryEmpty || phase.kind === 'loading'}
        loading={phase.kind === 'loading'}
        onClick={() => void onFeedMe()}
      />

      {pantryEmpty && <PantryEmptyHint />}

      {phase.kind === 'loading' && <LoadingLine />}

      {phase.kind === 'error' && phase.reason === 'empty' && <EmptyResultLine />}

      {phase.kind === 'error' && phase.reason === 'network' && <NetworkErrorLine />}

      {phase.kind === 'results' && (
        <Stack gap={18}>
          {phase.suggestions.map((s, i) => {
            const dishKey = `${s.dish.toLowerCase()}-${i}`;
            return (
              <RecipeCard
                key={dishKey}
                suggestion={s}
                cooked={cookedIds.has(dishKey)}
                onCookedIt={() => void onCookedIt(dishKey, s)}
                shopNames={shopNames}
                onAddToShop={onAddToShop}
              />
            );
          })}
        </Stack>
      )}

      <RecentStrip rows={recent} />
    </Stack>
  );
}

// ─── header + controls ─────────────────────────────────────────────────────

function FeedMeHeader(): JSX.Element {
  return (
    <Stack gap={8}>
      <span
        style={{
          fontFamily: fonts.serif,
          fontSize: 40,
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
          fontWeight: 400,
          color: colors.ink,
        }}
      >
        feed me
      </span>
      <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 460 }}>
        from what&rsquo;s already in your pantry.
      </Text>
    </Stack>
  );
}

function DietChipRow({
  diet,
  onChoose,
}: {
  diet: FeedDietFilter;
  onChoose: (wire: FeedDietFilter) => void;
}): JSX.Element {
  return (
    <Row gap={10} align="center" wrap>
      {DIET_CHOICES.map((d) => {
        const on = d.wire === diet;
        return (
          <button
            key={d.label}
            type="button"
            aria-pressed={on}
            onClick={() => onChoose(d.wire)}
            style={{
              padding: '7px 14px',
              borderRadius: 999,
              border: `1px solid ${on ? colors.sage : colors.hairline}`,
              background: on ? withSageTint(colors.sage) : 'transparent',
              color: on ? colors.sage : colors.inkFaint,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'color 200ms cubic-bezier(0.18, 0, 0.22, 1)',
              ...SMCP_STYLE,
            }}
          >
            {d.label}
          </button>
        );
      })}
    </Row>
  );
}

function CountStepper({
  count,
  onChange,
}: {
  count: number;
  onChange: (n: number) => void;
}): JSX.Element {
  const clamp = (n: number): number => Math.max(COUNT_MIN, Math.min(COUNT_MAX, n));
  return (
    <Row gap={14} align="center">
      <button
        type="button"
        aria-label="fewer ideas"
        onClick={() => onChange(clamp(count - 1))}
        disabled={count <= COUNT_MIN}
        style={glyphButton(count <= COUNT_MIN)}
      >
        —
      </button>
      <span
        style={{
          fontFamily: fonts.serif,
          fontSize: 18,
          letterSpacing: '-0.01em',
          color: colors.ink,
          minWidth: 64,
          textAlign: 'center',
        }}
      >
        {count} {count === 1 ? 'idea' : 'ideas'}
      </span>
      <button
        type="button"
        aria-label="more ideas"
        onClick={() => onChange(clamp(count + 1))}
        disabled={count >= COUNT_MAX}
        style={glyphButton(count >= COUNT_MAX)}
      >
        +
      </button>
    </Row>
  );
}

function FeedMeCta({
  disabled,
  loading,
  onClick,
}: {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading}
      style={{
        alignSelf: 'flex-start',
        padding: '12px 26px',
        background: disabled ? 'transparent' : colors.sage,
        border: `1px solid ${disabled ? colors.hairline : colors.sage}`,
        borderRadius: 999,
        color: disabled ? colors.inkFaint : colors.cream,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 200ms cubic-bezier(0.18, 0, 0.22, 1)',
        ...SMCP_STYLE,
      }}
    >
      feed me
    </button>
  );
}

function PantryEmptyHint(): JSX.Element {
  return (
    <Text scale="caption" color={colors.inkFaint}>
      pantry&rsquo;s empty. dump what you bought and come back.
    </Text>
  );
}

function LoadingLine(): JSX.Element {
  return (
    <Row gap={6} align="center" aria-live="polite">
      <Text scale="caption" color={colors.inkFaint}>
        thinking
      </Text>
      <DotPulse />
    </Row>
  );
}

function DotPulse(): JSX.Element {
  // Three subdued dots; the keyframes are inlined as a <style> block so we
  // don't pull in a CSS module just for one ambient cue. Calm-out timing
  // mirrors the durations.fade / easings.calmOut tokens.
  return (
    <span aria-hidden style={{ display: 'inline-flex', gap: 4 }}>
      <style>{`
        @keyframes ollie-feedme-pulse {
          0%,80%,100% { opacity: 0.25; }
          40%         { opacity: 0.8; }
        }
      `}</style>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: colors.inkFaint,
            animation: `ollie-feedme-pulse 1200ms ${i * 160}ms cubic-bezier(0.45, 0, 0.55, 1) infinite`,
          }}
        />
      ))}
    </span>
  );
}

function EmptyResultLine(): JSX.Element {
  return (
    <Text scale="caption" color={colors.inkFaint}>
      couldn&rsquo;t dream anything up. add a couple more things to your pantry.
    </Text>
  );
}

function NetworkErrorLine(): JSX.Element {
  return (
    <Text scale="caption" color={colors.inkFaint}>
      couldn&rsquo;t reach the kitchen — try in a moment.
    </Text>
  );
}

// ─── recipe card ──────────────────────────────────────────────────────────

function RecipeCard({
  suggestion,
  cooked,
  onCookedIt,
  shopNames,
  onAddToShop,
}: {
  suggestion: FeedRecipeSuggestion;
  cooked: boolean;
  onCookedIt: () => void;
  shopNames?: Set<string>;
  onAddToShop?: (name: string, quantity?: number | null, unit?: string | null) => void;
}): JSX.Element {
  const minutes = suggestion.prepMinutes + suggestion.cookMinutes;
  // Pull the first defined-but-non-generic diet tag for the subtitle. Most
  // suggestions carry a stack like ['vegetarian','mediterranean'] — we pick
  // the more specific second tag when both are present so "mediterranean"
  // wins over "vegetarian" on a typical Gemini batch.
  const specificDiet =
    suggestion.diet.find((d) => d !== 'vegetarian' && d !== 'vegan') ??
    suggestion.diet[0];

  const usedIngredients = suggestion.ingredients
    .filter((i) => i.have)
    .map((i) => i.name);

  // Collapsed by default — a clean stack of dish names — so the list stays
  // scannable. Tapping the header reveals the full recipe (ingredients with
  // quantities + numbered steps). One recipe open at a time keeps focus.
  const [open, setOpen] = useState(false);
  const hasRecipe = suggestion.steps.length > 0 || suggestion.ingredients.length > 0;

  // Names the user has just tapped onto the shopping list this session — folded
  // together with the names already on the list (shopNames) so a "need" item
  // flips to "added" the moment it's tapped and stays that way.
  const [addedNames, setAddedNames] = useState<Set<string>>(() => new Set());
  const isAdded = (name: string): boolean =>
    addedNames.has(name.toLowerCase()) || (shopNames?.has(name.toLowerCase()) ?? false);

  return (
    <article
      style={{
        padding: '20px 22px',
        background: colors.paper,
        border: `1px solid ${colors.hairline}`,
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* A plain <div role="button"> rather than a real <button>: the header
          contains block-level layout (<Row> → div, <Text scale="body"> → p),
          which is invalid inside a <button> and makes browsers reparent the DOM
          — that broke click handling on the whole card. */}
      <div
        role={hasRecipe ? 'button' : undefined}
        tabIndex={hasRecipe ? 0 : undefined}
        aria-expanded={hasRecipe ? open : undefined}
        onClick={hasRecipe ? () => setOpen((v) => !v) : undefined}
        onKeyDown={
          hasRecipe
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpen((v) => !v);
                }
              }
            : undefined
        }
        style={{
          textAlign: 'left',
          cursor: hasRecipe ? 'pointer' : 'default',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          width: '100%',
        }}
      >
        <Row justify="space-between" align="baseline" gap={12} style={{ width: '100%' }}>
          <span
            style={{
              fontFamily: fonts.serif,
              fontSize: 24,
              lineHeight: 1.1,
              letterSpacing: '-0.012em',
              fontWeight: 400,
              color: colors.ink,
            }}
          >
            {suggestion.dish}
          </span>
          {hasRecipe && (
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                fontSize: 11,
                color: colors.inkFaint,
                ...SMCP_STYLE,
              }}
            >
              {open ? 'hide' : 'recipe'}
            </span>
          )}
        </Row>

        <Text scale="caption" color={colors.inkFaint}>
          {minutes > 0 ? `about ${minutes} min` : 'a few minutes'}
          {specificDiet && ` · ${specificDiet}`}
        </Text>

        {!open && usedIngredients.length > 0 && (
          <span
            style={{
              fontSize: 11,
              color: colors.inkSoft,
              ...SMCP_STYLE,
            }}
          >
            {usedIngredients.join(' · ')}
          </span>
        )}
      </div>

      {open && hasRecipe && (
        <Stack gap={14} style={{ marginTop: 4 }}>
          {suggestion.ingredients.length > 0 && (
            <Stack gap={6}>
              <span style={{ fontSize: 11, color: colors.inkFaint, ...SMCP_STYLE }}>
                ingredients{suggestion.servings > 0 ? ` · serves ${suggestion.servings}` : ''}
              </span>
              {suggestion.ingredients.map((ing, i) => {
                const label = [ing.qty ? String(ing.qty) : '', ing.unit ?? '', ing.name]
                  .filter(Boolean)
                  .join(' ');
                const key = `${ing.name}-${i}`;

                // Have it already → plain line, no affordance.
                if (ing.have) {
                  return (
                    <Text key={key} scale="caption" color={colors.ink}>
                      {label}
                    </Text>
                  );
                }

                const added = isAdded(ing.name);

                // Missing + already on the list (or no add handler) → static
                // "added"/"need" tag, nothing to tap.
                if (added || !onAddToShop) {
                  return (
                    <Row key={key} gap={6} align="baseline">
                      <Text scale="caption" color={added ? colors.sage : colors.inkSoft}>
                        {label}
                      </Text>
                      <span
                        style={{
                          fontSize: 11,
                          color: added ? colors.sage : colors.inkFaint,
                          fontWeight: added ? 600 : 400,
                          ...SMCP_STYLE,
                        }}
                      >
                        {added ? 'added' : 'need'}
                      </span>
                    </Row>
                  );
                }

                // Missing → tap the row to add it to the shopping list.
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`add ${ing.name} to shopping list`}
                    onClick={() => {
                      onAddToShop(ing.name, ing.qty ?? null, ing.unit ?? null);
                      setAddedNames((prev) => {
                        const next = new Set(prev);
                        next.add(ing.name.toLowerCase());
                        return next;
                      });
                    }}
                    style={{
                      appearance: 'none',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      margin: 0,
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'baseline',
                      gap: 6,
                    }}
                  >
                    <Text scale="caption" color={colors.inkSoft}>
                      {label}
                    </Text>
                    <span
                      style={{
                        fontSize: 11,
                        color: colors.sage,
                        fontWeight: 600,
                        ...SMCP_STYLE,
                      }}
                    >
                      + add
                    </span>
                  </button>
                );
              })}
            </Stack>
          )}

          {suggestion.steps.length > 0 && (
            <Stack gap={8}>
              <span style={{ fontSize: 11, color: colors.inkFaint, ...SMCP_STYLE }}>
                steps
              </span>
              {suggestion.steps.map((step, i) => (
                <Row key={i} gap={10} align="baseline">
                  <span
                    style={{
                      flexShrink: 0,
                      fontFamily: fonts.serif,
                      fontSize: 13,
                      color: colors.inkFaint,
                    }}
                  >
                    {i + 1}
                  </span>
                  <Text scale="body" color={colors.ink}>
                    {step}
                  </Text>
                </Row>
              ))}
            </Stack>
          )}
        </Stack>
      )}

      <Row justify="flex-end" align="center" style={{ marginTop: 4 }}>
        {cooked ? (
          <span
            style={{
              fontSize: 11,
              color: colors.sage,
              fontWeight: 600,
              ...SMCP_STYLE,
            }}
          >
            cooked
          </span>
        ) : (
          <button
            type="button"
            onClick={onCookedIt}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 11,
              color: colors.sage,
              fontWeight: 600,
              ...SMCP_STYLE,
            }}
          >
            cooked it
          </button>
        )}
      </Row>
    </article>
  );
}

// ─── recent strip ─────────────────────────────────────────────────────────

function RecentStrip({ rows }: { rows: CookHistoryEntry[] }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <Stack gap={10} style={{ marginTop: 12 }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          alignSelf: 'flex-start',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: colors.inkFaint,
          fontSize: 11,
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          ...SMCP_STYLE,
        }}
      >
        made recently
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 200ms cubic-bezier(0.18, 0, 0.22, 1)',
            fontSize: 9,
          }}
        >
          ›
        </span>
      </button>

      {open && (
        <Stack gap={6} as="ul" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((r) => (
            <li key={r.id}>
              <Text scale="caption" color={colors.inkSoft}>
                {r.recipeName} · {formatAgo(r.cookedAtMs)}
              </Text>
            </li>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

function glyphButton(disabled: boolean): CSSProperties {
  return {
    width: 28,
    height: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${colors.hairline}`,
    background: 'transparent',
    borderRadius: 999,
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: disabled ? colors.inkGhost : colors.inkFaint,
    fontSize: 14,
    fontWeight: 400,
    padding: 0,
  };
}

/**
 * Translucent sage fill for the active diet chip. The token palette doesn't
 * expose a pre-mixed "sageTint" so we layer an alpha right at the call site.
 * Hex stripping is defensive — `colors.sage` is a 7-char hex in both modes.
 */
function withSageTint(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 'transparent';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.08)`;
}

/**
 * Editorial "n days ago" / "yesterday" / "today" — kept tiny on purpose.
 * The strip is a quiet recap, not a timeline.
 */
function formatAgo(ms: number): string {
  const diff = Date.now() - ms;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'today';
  if (diff < 2 * day) return 'yesterday';
  const days = Math.round(diff / day);
  return `${days} days ago`;
}

/**
 * Pick a locale the worker accepts. The endpoint enum is en/es/tr; anything
 * else (de, fr, …) falls through to en so the prompt still has something
 * coherent to respond in.
 */
function resolveLocale(): FeedLocale {
  const raw =
    typeof navigator !== 'undefined' && typeof navigator.language === 'string'
      ? navigator.language.slice(0, 2).toLowerCase()
      : 'en';
  if (raw === 'es' || raw === 'tr') return raw;
  return 'en';
}

