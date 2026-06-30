/**
 * Module-registry drift guard (S2 · fix 2 + fix 3).
 *
 * After consolidation the worker has ONE source of truth for module names:
 * src/router/dump-schema.ts → `MODULES` (the `Module` type is derived from it,
 * `typeof MODULES[number]`). dump-classify.ts imports MODULES for both the
 * Layer-1 prompt enum and its `coerceModule` runtime guard, so those two can no
 * longer drift from the type — there is no second TS array to keep in sync.
 *
 * The ONE registry that still can't be derived at compile time is the
 * `routing_cache.module` SQL CHECK constraint. This test reads the latest
 * routing_cache CHECK migration and asserts it lists every value in MODULES, so
 * adding a module to dump-schema without updating the migration fails here
 * (that exact drift is what silently broke `medication` cache writes — fix 3).
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { MODULES } from '../src/router/dump-schema';
import { coerceModule } from '../src/router/dump-classify';

describe('module registry — single source of truth', () => {
  it('MODULES is non-empty and has no duplicates', () => {
    expect(MODULES.length).toBeGreaterThan(0);
    expect(new Set(MODULES).size).toBe(MODULES.length);
  });

  it('coerceModule round-trips every MODULES value and falls back for unknowns', () => {
    for (const m of MODULES) {
      expect(coerceModule(m)).toBe(m);
    }
    expect(coerceModule('not_a_real_module')).toBe('dump_only');
    expect(coerceModule(undefined)).toBe('dump_only');
    expect(coerceModule(42)).toBe('dump_only');
  });
});

describe('routing_cache CHECK constraint — no drift from MODULES (fix 3)', () => {
  // The migration that recreates the module CHECK with the full registry.
  const migrationUrl = new URL(
    '../../../supabase/migrations/20260701000002_routing_cache_medication.sql',
    import.meta.url,
  );

  /** Pull the quoted module names out of the `check (module in ( ... ))` block,
   *  ignoring SQL `-- ...` line comments. */
  function parseCheckModules(sql: string): Set<string> {
    const block = sql.match(/check\s*\(\s*module\s+in\s*\(([\s\S]*?)\)\s*\)/i);
    expect(block, 'migration must contain a `check (module in (...))` block').toBeTruthy();
    const body = block![1]
      .split('\n')
      .map((line) => line.replace(/--.*$/, '')) // strip line comments
      .join('\n');
    const tokens = body.match(/'([a-z_]+)'/g) ?? [];
    return new Set(tokens.map((t) => t.slice(1, -1)));
  }

  it('the CHECK lists every module in the MODULES registry', () => {
    const sql = readFileSync(migrationUrl, 'utf8');
    const allowed = parseCheckModules(sql);
    const missing = MODULES.filter((m) => !allowed.has(m));
    expect(missing, `routing_cache CHECK is missing routable module(s): ${missing.join(', ')}`).toEqual(
      [],
    );
  });
});
