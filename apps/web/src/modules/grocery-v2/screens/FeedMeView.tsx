/**
 * grocery-v2 · FeedMeView — the `feed me` mode (grocery-recipes.html)
 *
 * The recipe matcher. ONE inferred recipe at a time from what's actually
 * in the pantry — never a grid of cards. A diet filter + a named-recipe
 * search sit above it. The dish name big and light, a coverage pip-row,
 * the soft turns-soon reframe, the have/missing ingredient split, and one
 * amber action to add the missing ones to the shopping list.
 *
 * Real data: `inferRecipe` from `@ollie/logic/grocery` over the live
 * pantry. The diet filter is a presentation chip wrap (the recipe table
 * has no diet axis yet — reported); 'all' is the live default. Adding the
 * missing ingredients writes real `grocery.items` rows.
 */
import { useMemo, useState } from 'react';
import {
  AmberButton,
  IconSearch,
  IconPlus,
  IconCheck,
  IconChevronRight,
  v2,
} from '../../money-v2/v2';
import { feedMeVM, feedMeSearchVM } from '../selectors';
import type { GrocerySlices, FeedMeVM, RecipeIngredient } from '../selectors';
import type { GroceryActions } from '../useGroceryActions';

export interface FeedMeViewProps {
  now: number;
  slices: GrocerySlices;
  actions: GroceryActions;
}

const DIETS = ['all', 'vegetarian', 'vegan', 'mediterranean', 'turkish'] as const;
type Diet = (typeof DIETS)[number];

export function FeedMeView({ now, slices, actions }: FeedMeViewProps) {
  const [diet, setDiet] = useState<Diet>('all');
  const [search, setSearch] = useState('');
  const [added, setAdded] = useState(false);

  const vm: FeedMeVM = useMemo(() => {
    if (search.trim()) return feedMeSearchVM(slices, now, search);
    return feedMeVM(slices, now);
  }, [slices, now, search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* the named-recipe search — one quiet underlined line */}
      <label
        style={{
          marginTop: 24,
          borderBottom: `1px solid ${v2.line}`,
          paddingBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
        }}
      >
        <IconSearch size={15} weight={2} stroke={v2.mute} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="look up a dish — shakshuka, mercimek çorbası…"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 14,
            color: v2.ink,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            fontFamily: v2.sans,
            minWidth: 0,
          }}
        />
      </label>

      {/* the diet filter — a calm wrap of soft pills */}
      <div
        style={{
          marginTop: 16,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {DIETS.map((d) => {
          const on = d === diet;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => setDiet(d)}
              style={{
                boxSizing: 'border-box',
                border: `1px solid ${on ? v2.accent : v2.line}`,
                background: on ? v2.accent : v2.card,
                borderRadius: 14,
                padding: '7px 13px',
                fontSize: 13,
                fontWeight: on ? 600 : 500,
                color: on ? '#fff' : v2.ink,
                letterSpacing: '-0.01em',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {d}
            </button>
          );
        })}
      </div>

      {vm.found && vm.dish ? (
        <FoundRecipe
          vm={vm}
          added={added}
          onAdd={() => {
            if (added || vm.missingNames.length === 0) return;
            actions.addMissing(vm.missingNames);
            setAdded(true);
          }}
        />
      ) : (
        <EmptyRecipe cold={vm.cold} searched={Boolean(search.trim())} />
      )}
    </div>
  );
}

// ─── the found recipe ────────────────────────────────────────────────────────

interface FoundRecipeProps {
  vm: FeedMeVM;
  added: boolean;
  onAdd: () => void;
}

function FoundRecipe({ vm, added, onAdd }: FoundRecipeProps) {
  return (
    <>
      <div
        style={{
          marginTop: 30,
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        from what&rsquo;s in your pantry right now
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 32,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.03em',
          lineHeight: 1.1,
        }}
      >
        {vm.dish}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        {vm.cuisine}
      </div>

      {/* the coverage pip-row */}
      <div
        style={{
          marginTop: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 6 }} aria-hidden>
          {Array.from({ length: vm.total }).map((_, i) => (
            <span
              key={i}
              style={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                background: i < vm.haveCount ? v2.sage : 'transparent',
                border:
                  i < vm.haveCount ? 'none' : `1.8px solid ${v2.line}`,
                boxSizing: 'border-box',
              }}
            />
          ))}
        </div>
        <span
          style={{
            fontSize: 13,
            color: v2.ink,
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          {vm.coverage}
        </span>
      </div>

      {/* the turns-soon reframe */}
      {vm.soonLine && (
        <div
          style={{
            marginTop: 13,
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
            {vm.soonLine}
            {' '}
            <span style={{ color: v2.umber, fontWeight: 600 }}>
              &mdash; it&rsquo;s the calm reason to cook this one tonight.
            </span>
          </span>
        </div>
      )}

      {/* the ingredient split */}
      {vm.have.length > 0 && (
        <IngredientList label="in your pantry" rows={vm.have} />
      )}
      {vm.missing.length > 0 && (
        <IngredientList label="you'd need" rows={vm.missing} />
      )}

      {/* one amber action — add the missing ones to the list */}
      {vm.missingNames.length > 0 && (
        <AmberButton
          icon={<IconPlus size={18} weight={2.4} />}
          onClick={onAdd}
          style={{ marginTop: 26, height: 50, borderRadius: 25 }}
        >
          {added
            ? 'added to the list'
            : `add the ${vm.missingNames.length} missing to the list`}
        </AmberButton>
      )}
    </>
  );
}

// ─── one ingredient sub-list ─────────────────────────────────────────────────

interface IngredientListProps {
  label: string;
  rows: RecipeIngredient[];
}

function IngredientList({ label, rows }: IngredientListProps) {
  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          fontSize: 11,
          color: v2.mute,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      {rows.map((row, i) => (
        <div
          key={row.name}
          style={{
            boxSizing: 'border-box',
            borderTop: `1px solid ${v2.line}`,
            borderBottom:
              i === rows.length - 1 ? `1px solid ${v2.line}` : 'none',
            padding: '12px 2px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: row.have ? v2.sage : 'transparent',
              border: row.have ? 'none' : `1.8px solid ${v2.line}`,
              boxSizing: 'border-box',
            }}
          >
            {row.have && <IconCheck size={10} weight={3.4} stroke="#fff" />}
          </span>
          <span
            style={{
              flex: 1,
              fontSize: 14,
              color: row.have ? v2.ink : v2.mute,
              fontWeight: 500,
              letterSpacing: '-0.01em',
            }}
          >
            {row.name}
          </span>
          {row.tag && (
            <span
              style={{
                fontSize: 11,
                color: v2.umber,
                fontWeight: 600,
                letterSpacing: '0.02em',
              }}
            >
              {row.tag}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── the empty / not-found state ─────────────────────────────────────────────

interface EmptyRecipeProps {
  cold: boolean;
  searched: boolean;
}

function EmptyRecipe({ cold, searched }: EmptyRecipeProps) {
  return (
    <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
          lineHeight: 1.3,
          maxWidth: 300,
        }}
      >
        {searched
          ? "ollie doesn't know that dish yet"
          : 'nothing to cook from yet'}
      </div>
      <div
        style={{
          marginTop: 11,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            flexShrink: 0,
            marginTop: 2,
            transform: 'rotate(90deg)',
          }}
        >
          <IconChevronRight size={14} weight={2} stroke={v2.mute} />
        </span>
        <span
          style={{
            fontSize: 13,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          {cold
            ? 'feed me reads your pantry — check a few things off the shopping list and a meal will surface here on its own.'
            : "the pantry doesn't cover enough of one dish yet — a few more things and ollie will find one."}
        </span>
      </div>
    </div>
  );
}
