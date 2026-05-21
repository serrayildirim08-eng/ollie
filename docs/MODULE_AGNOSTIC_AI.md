# Module-Agnostic AI Routing Guidelines

**Status:** Approved 2026-05-21 by Serra. Directive for backend-senior + juniors building grocery AI routing (T1/T2/T3) and any future per-module AI work.

## Why

We are building the AI semantic routing pipeline for **grocery** first as the prototype seed. After grocery proves out (end-to-end working in browser dogfood), we will port the same pattern to other modules: **work, body, dump, money, admin, pets, habits, health, finance, sleep, cycle, goals**.

To make that port cheap, **build the helpers module-agnostic from day 1**. Don't hardcode `grocery` into shared infrastructure.

## What this means concretely

### ✅ Module-agnostic (build it this way)

- **DB tables**: `routing_cache` with a `module` column (text indexed) — not `grocery_routing_cache`
- **Worker endpoint**: `/route/{module}` (route param) — not `/grocery-route` hardcoded
- **Cache lookup helper**: `embedAndCacheLookup(text, module, opts)` — not grocery-named
- **LLM prompt builder**: takes a `ModuleConfig` (intent verbs, item schema, expansion rules) — not a grocery-hardcoded prompt
- **PII scrub**: stays cross-module (already module-agnostic, good)
- **Event emit**: `dispatch:routed` event with `{module, ...}` payload — not `grocery:routed`. Frontend popup component picks the variant based on `module`
- **Junior-friendly seam**: each module has its own `<module>.config.ts` with `{ canonicalItems, intentVerbs, categories, shelfLifeMap, examples }` — pluggable

### ❌ Grocery-specific (keep in module-local files)

- `packages/logic/src/grocery/ALIAS_TABLE` — module-specific data, stays where it is
- Recipe expansion logic — grocery's specific generative case. Other modules will have analogous but different needs (work has "matter expansion", body has "symptom cluster", etc.)
- Shelf-life concept — grocery-only
- Pantry vs shopping target — grocery-only

## Carry-forward for next modules

When porting to `<module>`:
1. Build `<module>.config.ts` with the 5 fields above
2. Seed `routing_cache` lookup with `module='<module>'` filter (zero new infra)
3. Add `/route/<module>` registration (zero new worker code if endpoint takes route param)
4. Frontend popup gets new variant via `module` discriminator

## Don't

- Don't refactor helpers AFTER grocery ships. Refactor risk + 2-3 day cost.
- Don't generalize too early either — only obvious shared infrastructure. Module-specific stuff stays module-local.
- Don't add a `module` column to a table just for future-proofing if grocery doesn't need it (DB schema is the harder thing to change later, so DO put `module` there).

## Owner

backend-senior decides the exact shape of helpers + reviews before juniors merge. This doc is the directive; implementation tradeoffs are senior judgment.
