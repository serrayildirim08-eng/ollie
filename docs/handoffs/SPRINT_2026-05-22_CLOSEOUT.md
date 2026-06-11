# Sprint Closeout — 2026-05-22 Grocery AI Marathon

When remove-command agent reports done, run through this checklist in order.

## 1. Verify remove-command agent landed clean

```bash
cd ~/ollie
git status --short
pnpm typecheck
pnpm test workers/ai-proxy packages/orchestrator apps/web
```

Expected:
- Modified files: `workers/ai-proxy/src/modules/grocery.config.ts`,
  `packages/orchestrator/src/braindump-dispatch.ts`,
  `apps/web/src/hooks/applyRoute.ts`,
  `apps/web/src/lib/grocery-undo-stack.ts` (new),
  `apps/web/src/components/SortedToast.tsx` (variant modes added),
  test files
- typecheck green
- All tests green (final count ~1080+ across packages)

If typecheck fails on `contextBlock` unused var in grocery.config.ts, the
agent is still mid-flight — wait for completion notification.

## 2. Stage + commit the remove agent's work

```bash
git add -A
git commit -m "feat(grocery): list-mutation commands — remove / scratch / except / undo"
```

(Adjust message to match agent's final report. Discard pnpm-workspace.yaml
if it has the `onnxruntime-node: set this to true or false` junk again —
`git checkout pnpm-workspace.yaml` then re-stage.)

## 3. Final worker deploy

```bash
cd ~/ollie/workers/ai-proxy
wrangler deploy
```

This ships:
- `/feed-me/:user` endpoint (already live from earlier deploy)
- `/cook-history` endpoint (NEW — added between feed-me and remove agents)
- `/route/grocery` schema extension with `action` field + list context
- Updated grocery.config.ts prompt with mutation commands + few-shot

Verify version ID in output, note it for the memory write.

## 4. Restart Vite dev server

Vite HMR can be flaky with workspace-package changes (orchestrator,
events). Full restart safer:

```bash
# In whichever terminal is running pnpm electron:dev or pnpm dev
# Press Ctrl+C, then:
pnpm electron:dev    # or pnpm -F @ollie/web dev for Chrome web mode
```

## 5. End-to-end smoke test in Electron (or Chrome)

Test corpus — paste each line into brain dump, confirm slice + intent:

### Add (baseline, should already work)
- [ ] `need milk` → SHOP
- [ ] `got coffee` → PANTRY
- [ ] `out of dish soap` → SHOP (depletion)
- [ ] `i need tp` → SHOP, canonical=toilet paper
- [ ] `eggs, milk, bread` → 3 items in SHOP (comma-separated)
- [ ] `buy 2 lemons` → SHOP, qty=2

### Remove / mutation (NEW from remove agent)
- [ ] `remove pasta from the list` → pasta disappears from SHOP
- [ ] `scratch the bread, got some` → bread leaves SHOP, lands in PANTRY
- [ ] `I finished the milk` → milk leaves PANTRY (if it was there)
- [ ] `throw out the yogurt` → yogurt leaves PANTRY
- [ ] `got everything except eggs` → all SHOP items checked except eggs
- [ ] `undo` → reverses last mutation
- [ ] `pastayı listeden çıkar` (TR) → pasta removed
- [ ] `quita la pasta de la lista` (ES) → pasta removed

### Feed Me v2 (already shipped but needs end-to-end verify)
- [ ] Pantry has 5+ items → feed me shows 3 recipe cards (source='gemini')
- [ ] Toggle to "for tontin" → pet feed shows pig-appropriate meals
- [ ] Tap "I cooked this" → modal opens, 3 options work
- [ ] Tap "× not this" → card removed, refetch happens
- [ ] Change diet=vegan → cards refetch with vegan options
- [ ] Endpoint down (kill worker briefly) → cards fall back to inferRecipe static

### Replenishment badges
- [ ] Add same item 2+ times over multiple days → badge switches from
      italic static to accent observed
- [ ] Tap shop item check-off → purchase logged → badge refreshes

## 6. Rotate exposed API keys

Both pasted in chat earlier — security debt:

```bash
# Voyage: voyageai.com → API Keys → Create new key → Copy
printf '%s' 'NEW_VOYAGE_KEY' | wrangler secret put VOYAGE_API_KEY

# Gemini: aistudio.google.com → API key → Create new → Copy
printf '%s' 'NEW_GEMINI_KEY' | wrangler secret put GEMINI_API_KEY

# Clean up the typo cruft:
wrangler secret delete VOYAGE_API_KEYb

# Redeploy to pick up new secrets (or wait, CF secrets are live-rotated)
wrangler deploy
```

Then revoke the old keys in respective dashboards.

## 7. Commit memory + close sprint

Already done in main session:
- `~/.claude/projects/-Users-serrayildirim/memory/project_ollie_grocery_ai_sprint_2026_05_22.md`
- MEMORY.md index updated

If anything in section 5 fails, add finding to that memory's "Known broken"
section and park for next session.

## 8. Optional — push branch + open PR to main

Branch `feat/t0-clerk-jwt-verify` has ~25 commits at this point. Two
options:

a. **Park as feature branch** — keep accumulating, merge later as part
   of split sprint (low effort tonight)
b. **Open a PR right now** — `gh pr create --draft` against main. Will
   be blocked by missing Pages CI but at least surfaces the work.

Either fine. Default: park, sleep.
