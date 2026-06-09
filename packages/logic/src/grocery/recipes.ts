/**
 * @ollie/logic · grocery · recipe inference
 *
 * Pure function — no I/O, no wall-clock reads.
 */

import type { GroceryHistory, GroceryOpts, RecipeInferredSignal, PantryItem } from './types';
import { ALIAS_TABLE, RECIPE_TABLE, SORTED_RECIPE_ALIASES } from './data';
import { foldDiacritics } from './parse';

import { DAY_MS } from '../util';

export function inferRecipe(
  history: GroceryHistory | null,
  opts: GroceryOpts = {},
): RecipeInferredSignal | null {
  const now: number = (history && typeof history.now === 'number') ? history.now : (opts.now ?? 0);
  const pantry: PantryItem[] = Array.isArray(history?.pantry) ? history!.pantry : [];
  const dishHint = (opts.dishHint ?? history?.dishHint ?? '').toLowerCase().trim();

  // Named dish lookup
  if (dishHint) {
    const folded = foldDiacritics(dishHint);
    for (let i = 0; i < SORTED_RECIPE_ALIASES.length; i++) {
      const row = SORTED_RECIPE_ALIASES[i];
      const alFolded = foldDiacritics(row[0]);
      if (alFolded === folded || folded.includes(alFolded)) {
        const r = RECIPE_TABLE[row[1]];
        const pNames = new Set(
          pantry.map(p => ((p?.normalizedName ?? p?.name) ?? '').toLowerCase()),
        );
        const have: string[] = [];
        const missing: string[] = [];
        r.ingredients.forEach(ing => {
          if (pNames.has(ing)) have.push(ing);
          else missing.push(ing);
        });
        return {
          pattern: 'grocery-recipe-inferred',
          found: true,
          dish: row[1],
          cuisine: r.cuisine,
          ingredients: r.ingredients.slice(),
          have,
          missing,
          copy: missing.length === 0
            ? `${row[1]} — you have everything.`
            : `${row[1]} — missing ${missing.slice(0, 3).join(', ')}.`,
          source: 'Kasper, Alderson, Hudec 2012, Clin Psychol Rev',
        };
      }
    }
    return { pattern: 'grocery-recipe-inferred', found: false, dish: null };
  }

  if (pantry.length === 0) return null;

  const pNames = new Set(pantry.map(p => ((p?.normalizedName ?? p?.name) ?? '').toLowerCase()));
  const driftSet = new Set(
    pantry
      .filter(p => {
        if (!p || typeof p.boughtTs !== 'number') return false;
        const key = ((p.normalizedName ?? p.name) ?? '').toLowerCase();
        const shelf = typeof p.shelfLifeDays === 'number'
          ? p.shelfLifeDays
          : (ALIAS_TABLE[key]?.shelfLifeDays ?? 14);
        return (p.boughtTs + shelf * DAY_MS) - now <= 3 * DAY_MS;
      })
      .map(p => ((p.normalizedName ?? p.name) ?? '').toLowerCase()),
  );

  let best: {
    canon: string;
    score: number;
    have: number;
    total: number;
    drifters: number;
    recipe: { cuisine: string; ingredients: string[] };
  } | null = null;

  for (const canon of Object.keys(RECIPE_TABLE)) {
    const r = RECIPE_TABLE[canon];
    let have = 0;
    const total = r.ingredients.length;
    let drifters = 0;
    r.ingredients.forEach(ing => {
      if (pNames.has(ing)) have++;
      if (driftSet.has(ing)) drifters++;
    });
    const coverage = have / total;
    if (coverage < 0.5) continue;
    const score = coverage * 100 + drifters * 25;
    if (!best || score > best.score) {
      best = { canon, score, have, total, drifters, recipe: r };
    }
  }

  if (!best) return null;
  const missing = best.recipe.ingredients.filter(ing => !pNames.has(ing));
  const haveList = best.recipe.ingredients.filter(ing => pNames.has(ing));

  return {
    pattern: 'grocery-recipe-inferred',
    found: true,
    dish: best.canon,
    cuisine: best.recipe.cuisine,
    ingredients: best.recipe.ingredients.slice(),
    have: haveList,
    missing,
    drifters_count: best.drifters,
    copy: best.drifters > 0
      ? `${best.canon}? uses ${best.drifters} item${best.drifters === 1 ? '' : 's'} that turn soon.`
      : `${best.canon}? you have ${best.have}/${best.total}.`,
    source: 'Kasper, Alderson, Hudec 2012, Clin Psychol Rev',
  };
}
