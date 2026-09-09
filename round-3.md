# Ollie Repo Audit — Round 3/3

_Date: today · Branch: feat/brain @ 2325ee5 · 127 findings · independent round, unaware of the other two._

Findings ordered by importance (severity).

## CRITICAL — 4

### Non-numeric confidence defaults to 0, causing silent misrouting
- **Dimension:** Dump Routing Flow Correctness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts:200, 231`
- **Problem:** When the LLM returns a non-numeric confidence value (e.g., string, null, undefined), the code silently coerces it to 0. This triggers the low-confidence demotion policy (confidence < 0.60) in dump.ts:281 and dump.ts:338, converting correctly-routed fragments to dump_only.archive_only with the original classification buried in originalGuess. This causes data loss: the user loses the correct routing and the fragment is archived instead of being routed to its intended module.
- **Fix:** Either (1) throw an error to propagate the issue so the cascade can try the next provider, or (2) log a warning and default to 0.65 (middle of the needs-confirm range) instead of 0. Option 1 is preferable because it preserves the cascade fallback pattern used elsewhere.
- **Evidence:** `confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,`

### CrisisSignal shape mismatch between worker and native app
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:72-77`
- **Problem:** Native app schema defines CrisisSignal with `type` ('ideation'|'method_seeking'|'distress'|'panic') and `language` (singular string), but the worker returns the actual CrisisSignal from @ollie/crisis-lexicon which has `tier` (SeverityTier 1-4) and `languages` (array). Native UI at DumpScreen.tsx line ~212 accesses crisis.type and crisis.language, which will be undefined when the real signal is received from the worker, causing runtime errors.
- **Fix:** Align the native schema CrisisSignal to match @ollie/crisis-lexicon/src/types.ts exactly, or add a transformation layer in the worker to convert the real CrisisSignal to the native app's expected shape. Update DumpScreen.tsx to access crisis.tier and crisis.languages accordingly.
- **Evidence:** `Native schema: 'type: 'ideation' | 'method_seeking' | 'distress' | 'panic'; language: 'en' | 'es' | 'tr''. Actual from crisis-lexicon: 'tier: SeverityTier; languages: LexiconLanguage[]'. DumpScreen.tsx accesses: 'crisis.type' and 'crisis.la`

### Crisis banner message is hardcoded in English only
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:307-308`
- **Problem:** The CrisisBanner component displays a safety-critical message to users who may be in crisis. This message is hardcoded in English only and never reaches Spanish/Turkish-speaking users. The 'notice' kicker and dismiss affordance are also English-only. This is a critical localization gap for a mental health safety feature.
- **Fix:** Thread AppLang to CrisisBanner; create a triligual message table keyed by language; render using the app language setting. Include translations for 'notice' kicker and all affordances.
- **Evidence:** `Something in what you wrote sounded heavy. If it's urgent, a crisis
        line in your country can help right now.`

### Crisis lexicon marked PENDING_SERRA_APPROVAL — safety blocker for all languages
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/packages/crisis-lexicon/data/lexicon.en.json:4`
- **Problem:** All three lexicons (EN, ES, TR) are marked PENDING_SERRA_APPROVAL. The code comment states 'Lexicons are PENDING_SERRA_APPROVAL — `last_reviewed_by` must be `@serra` before any merge that ships to alpha.' This is a safety-critical blocker for shipping the crisis detection to users in any language.
- **Fix:** Serra must review and approve all three lexicons (lexicon.en.json, lexicon.es.json, lexicon.tr.json) and change last_reviewed_by to @serra before any alpha ship.
- **Evidence:** `"last_reviewed_by": "PENDING_SERRA_APPROVAL"`

## HIGH — 47

### Missing maximum text length validation in /route/dump
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:148-157`
- **Problem:** The /route/dump endpoint accepts a brain-dump text field without validating its maximum length. An attacker can send an arbitrarily large text value (e.g., 10+ MB) which will then be processed through segmentation, embedding, and classification pipelines. This can exhaust worker memory, hit API rate limits, and consume budget on Voyage/Groq/Gemini calls. The image field has MAX_IMAGE_BYTES limit (line 64) but text has none.
- **Fix:** Add a MAX_TEXT_BYTES constant (suggest 1-2 MB to match typical brain-dump size) and validate body.text.length before segmentation. Return 413 Payload Too Large if exceeded, similar to the image size check.
- **Evidence:** `const userText = typeof body.text === 'string' ? body.text.trim() : '';
  const hasImage = body.image !== undefined;

  if (hasImage && !isVisionImage(body.image)) {
    return json({ error: 'bad_image' }, 400);
  }

  if (!userText && !has`

### Multiple retry implementations with exponential backoff
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `/Users/serrayildirim/ollie/packages/api/src/client.ts:222-250`
- **Problem:** There are TWO separate implementations of exponential-backoff retry logic: one in @ollie/api/client.ts (lines 222-250) and another in @ollie/sync/retry.ts (lines 121-133). Both implement the same pattern (base_delay * 2^attempt with a cap) but with slightly different configurations and error handling. This violates the single-source-of-truth principle and makes retry behavior inconsistent across the codebase.
- **Fix:** Extract retry logic to a shared utility package (e.g., @ollie/retry). Both consumers should import and use the same configurable backoff scheduler. The @ollie/sync/retry.ts implementation is more complete (includes maxAttempts cap and exhausted flag), so use that as the base.
- **Evidence:** `'''typescript
// @ollie/api/client.ts:242
const delay = req.retry.baseDelayMs * Math.pow(2, attempt);

// @ollie/sync/retry.ts:128
const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
'''`

### Duplicate mean() implementations across 4 locations
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/stats/index.ts:29-30`
- **Problem:** The mean() function is reimplemented 4 times: (1) @ollie/stats/index.ts:29 (canonical), (2) @ollie/habits/helpers.ts:15, (3) @ollie/body/signals.ts:111, (4) @ollie/cadence/index.ts:216. The stats module is intended as the single source of truth but other modules have independent implementations. While @ollie/body/math.ts correctly delegates to stats for other functions, it does not re-export mean, leading callers in the body module to define their own.
- **Fix:** Delete the mean() implementations from habits/helpers.ts, body/signals.ts, and cadence/index.ts. Each should import from @ollie/logic/stats instead. Update @ollie/body/math.ts to re-export mean from stats to maintain the existing import path for body consumers.
- **Evidence:** `'''typescript
// @ollie/stats/index.ts:29
export function mean(arr: readonly number[]): number {
  return arr.length ? sum(arr) / arr.length : 0;
}
// @ollie/habits/helpers.ts:15
export function mean(xs: number[]): number {
  return xs.redu`

### Multiple UUID/request ID generation implementations
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `/Users/serrayildirim/ollie/packages/worker-http/src/index.ts:66-73`
- **Problem:** Three separate UUID/request ID generators exist: (1) newRequestId() in @ollie/worker-http (line 66), (2) newId() in @ollie/orchestrator/braindump-dispatch.ts (line 312), (3) randomUuid() in @ollie/research-stream/index.ts (line 338). All check for crypto.randomUUID() first and fall back to Math.random() variants. The research-stream implementation includes full UUID v4 spec compliance (bits 6-7, 8), while the others use simpler fallbacks. This inconsistency could lead to non-standard UUIDs in fallback paths.
- **Fix:** Create a shared @ollie/uuid package with two functions: (1) uuid() for standard UUIDs (uses research-stream's v4 spec-compliant implementation), (2) shortId(prefix?) for short request/record IDs. Update worker-http to use shortId('req_'), orchestrator to use uuid(), and research-stream to use uuid().
- **Evidence:** `'''typescript
// @ollie/worker-http:66
export function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through `

### No module boundary enforcement in ESLint or TypeScript
- **Dimension:** File & Module Structure
- **File:** `/Users/serrayildirim/ollie/eslint.config.mjs:1-79`
- **Problem:** The monorepo has no ESLint rules or TypeScript configuration enforcing module boundaries (e.g., preventing apps from importing internal orchestrator files, or lower-level packages from importing higher-level ones). With 642 source files and a clear dependency hierarchy (logic → orchestrator → apps), there is no automated guard against accidental layering violations.
- **Fix:** Implement ESLint rule (via eslint-plugin-import or custom rule) to enforce package boundary constraints. Example: ban imports from @ollie/*/src/* (require going through package.json exports), or bar apps/native from importing internal sub-modules of @ollie/orchestrator that aren't in its public API.
- **Evidence:** `eslint.config.mjs has no rules for import restrictions, no eslint-plugin-import boundary checks, and tsconfig.base.json has no paths aliases to restrict imports. A consumer could theoretically import from @ollie/orchestrator/src/research or`

### Unsafe double-cast to unknown via as unknown as Type bypasses type narrowing
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/stubs.ts:95-108`
- **Problem:** Multiple exported module handlers are cast through `unknown` to satisfy the Record<Module, ModuleHandler<Module>> registry type. This pattern (`handler as unknown as ModuleHandler<Module>`) masks type mismatches between specific handler types and the generic registry constraint. If a handler has the wrong shape, the cast hides it until runtime.
- **Fix:** Use a proper type constraint in the registry definition (e.g., `satisfies Record<Module, ModuleHandler<Module>>`) or refactor handlers to share a common supertype without needing the double-cast.
- **Evidence:** `  grocery: groceryHandler as unknown as ModuleHandler<Module>,
  pets: petsHandler as unknown as ModuleHandler<Module>,
  finance: financeHandler as unknown as ModuleHandler<Module>,`

### Unsafe JSON.parse cast without validation allows any type through
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/archive.ts:134`
- **Problem:** JSON.parse result is cast to `unknown` then filtered, but the unsafeAs pattern bypasses type guards. If the JSON contains unexpected structure (e.g., non-string array items), the filter check at line 135 catches it at runtime, but this design is fragile—any change to the filter logic could allow bad data through.
- **Fix:** Use a Zod/io-ts schema to validate the parsed JSON structure at parse time, returning a typed result with guaranteed correctness.
- **Evidence:** `    const parsed = JSON.parse(r.modules) as unknown;`

### Unsafe cast of store get() result bypasses type narrowing in orchestrator
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/body-correlations.ts:108`
- **Problem:** Store.get<T>() returns T, but here it's cast `as unknown as SnapshotStoreLike` to satisfy takeUserDataSnapshot's type signature. The cast hides any structural mismatch between the actual Store interface and SnapshotStoreLike, deferring type errors to runtime method calls.
- **Fix:** Either make Store implement SnapshotStoreLike directly, or create a proper adapter function that validates the conversion at build time.
- **Evidence:** `  const snapshot = takeUserDataSnapshot(store as unknown as SnapshotStoreLike, now);`

### Promise.all without error handler in critical post-dispatch path
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:95-101`
- **Problem:** Promise.all([runAllSyncs(store), recordMoodFromDump(...)]) is chained to recomputeBrain with a catch on line 106 that only logs. If recomputeBrain throws, the promise chain swallows the error into the catch-all; no recovery path. More critically: the catch on line 97-99 is INSIDE the recordMoodFromDump call, not wrapping Promise.all itself. If runAllSyncs rejects (it claims to resolve-not-reject, but that's not enforced), the entire chain fails silently.
- **Fix:** Wrap each Promise.all element in its own .catch to guarantee both paths handle errors. Alternatively, use Promise.allSettled to prevent one rejection from causing the entire chain to fail. Add explicit error context (e.g., which sync failed) to the console.error so post-mortems are possible.
- **Evidence:** `void Promise.all([
    runAllSyncs(store),
    recordMoodFromDump(store, output.originalDump).catch((err) => {
      console.error('[bridge] recordMoodFromDump failed (non-fatal):', err);
    }),
  ])
    .then(() => recomputeBrain(store))
`

### Batch error detection logic in grocery patterns swallows failures silently
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/grocery/patterns.ts:293-297`
- **Problem:** The detectPatterns batch function wraps each detector in try/catch with only `/* pass */` comments and no logging. If a detector throws (e.g. due to null/undefined history, bad shelf life data), the error is silently dropped. Callers have no way to know a pattern failed to compute — they assume no pattern exists when in fact a detector crashed.
- **Fix:** Add console.warn or a metrics sink call inside each catch block with the detector name and error. Example: `catch (err) { console.warn('[logic/grocery] detectExpirationDrift failed', safeErrSummary(err)); }`. This preserves the fault-tolerant intent (no crashes) while enabling diagnostics.
- **Evidence:** `export function detectPatterns(
  history: GroceryHistory | null,
  opts: GroceryOpts = {},
): GroceryPattern[] {
  const out: GroceryPattern[] = [];
  try { const a = detectExpirationDrift(history, opts); if (a) out.push(a); } catch { /* p`

### Finance patterns detectors have same silent-catch issue
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/finance/patterns.ts:118, 154, 193, 239, 261, 303, 333`
- **Problem:** The seven pattern detectors (F1-F7) each wrap their logic in try/catch with only `/* */` or `/* swallow */` comments. Errors inside (e.g. bad date parsing, array access, regex failures) silently disappear. No caller can tell if a pattern failed or simply didn't match.
- **Fix:** Log each catch with pattern name and error summary. Use safeErrSummary (already imported at line 26) to collapse errors safely: `catch (err) { console.warn('[logic/finance] F1 doom-buying detector failed', safeErrSummary(err)); }`
- **Evidence:** `  } catch { /* swallow */ }
  ...
  } catch { /* */ }
  } catch { /* */ }
  } catch { /* */ }
  } catch { /* */ }
  } catch { /* */ }
  } catch { /* */ }`

### Fire-and-forget cache operations in dump router can lose writes silently
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:266-268, 303-305, 370`
- **Problem:** Cache lookup and upsert operations are wrapped in .catch((err) => console.error(...)) but are spawned via keepAlive(p) fire-and-forget. If the worker runtime rejects the promise before waitUntil completes, the error log may be lost. More critically: cacheLookup errors fall through to 'null' (line 268) which is treated as a cache miss, triggering unnecessary AI calls. cacheUpsert failures (line 370) can leave stale embeddings in Vectorize.
- **Fix:** Add explicit Sentry/error-sink integration to fire-and-forget promises so errors persist even if the worker terminates. Alternatively, implement a local error accumulator that gets returned in the response telemetry (e.g., `cache_errors: 1` in the summary) so the client can alert on degradation.
- **Evidence:** `keepAlive(
  cacheHitBump(env.VECTORIZE_INDEX, cacheRow, userId, embedding).catch((e) =>
    console.error('[route/dump] cache bump failed', e),
  ),
);`

### Empty catch blocks in auth vault crypto operations can hide key derivation failures
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/auth/src/index.ts:167-171, 202-206, 212-216, 220-235`
- **Problem:** Multiple catch blocks in create(), unlock(), lock(), and reset() emit events but have NO fallback if events.emit() throws. Line 169-171: emit fires silently; if the event registry is broken, caller gets `ok: true` when the vault may not actually be secure. Lines 212-216 and 231-235: catch blocks in lock()/reset() ignore all errors from remove() calls. If store.remove throws (e.g., corrupted index), the verifier is never cleared, leaving the old key-material persisted.
- **Fix:** For crypto-critical operations (create, unlock), log event-emit failures at warn level so UX issues are visible. For cleanup operations (lock, reset), log store.remove failures and consider throwing if critical failures occur, rather than silently leaving key material.
- **Evidence:** `inMemoryKey = key;
    try {
      events.emit('vault:unlocked', { ts: nowFn() });
    } catch {
      /* registry warn ok */
    }
    return { ok: true };`

### Race condition in finance sync drain queue cleanup
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:370-374 and 397-400`
- **Problem:** The drainOnce() function reads the queue once at line 335, then performs multiple async operations (upsert, delete). Between the initial readQueue() and the cleanup steps (lines 371 and 397), concurrent mutations from diffAndEnqueue() can modify the store, which triggers debouncedDiff(), which calls diffAndEnqueue() asynchronously. This creates a TOCTOU (Time-Of-Check-Time-Of-Use) race: new items can be enqueued while we're processing old ones, causing the cleanup logic to use stale data (the original `q` variable) to filter the current queue state (the `next` variable). Items could be incorrectly removed from the queue or duplicate entries could persist.
- **Fix:** Capture the exact IDs that were successfully shipped and verify them against the current queue state at cleanup time, rather than using a stale copy of `q`. Consider using an atomic operation or ensuring drainOnce is the sole writer during its execution. Alternatively, use per-id generation timestamps or sequence numbers to distinguish original items from concurrent mutations.
- **Evidence:** `At line 371: 'const next = readQueue();' re-reads after async upsert completes, but then filters using 'q.upserts' captured at line 335, before any concurrent enqueues. Similar issue at line 397-399 for deletes.`

### Unhandled promise rejection in APNs rate-limit token bucket
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts:135-142`
- **Problem:** The checkRate() function implements a token bucket by fetching a counter from KV, checking it, and then updating it with kv.put(). This creates a race condition on high concurrency: two simultaneous requests can both read count=0, both return true, and both increment, resulting in an increment of 1 instead of 2. With 5 req/sec limit and bursty traffic, multiple requests can slip through the gate. This is a check-then-act race with no atomicity guarantee from Cloudflare KV.
- **Fix:** Use Cloudflare KV's atomic put-if-not-exists pattern or implement a distributed locking strategy. Alternatively, accept the rate-limit is approximate and add a server-side backoff retry strategy to handle occasional overage. Document this as a soft rate-limit, not a hard one.
- **Evidence:** `At line 137-141: get() then synchronously read count, check against max, then await kv.put(). Between the get and put, another request can execute the same logic with the stale count value.`

### applyGroceryMutations function is 248 lines with 4-level switch/if nesting
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:400-647`
- **Problem:** The applyGroceryMutations function is very large (248 lines) and deeply nested with a switch statement containing four cases, each with internal if/else blocks and nested try-catch statements. Each case contains nearly identical code for pantry vs shopping mutations. This violates the single responsibility principle and makes maintenance difficult.
- **Fix:** Extract each case into a separate private function (e.g., applyAddMutation, applyRemoveMutation, applyCheckMutation, applyMoveToP antryMutation). Further refactor pantry vs shopping logic into helper functions to eliminate code duplication within each mutation type. Target <100 lines per function.
- **Evidence:** `export function applyGroceryMutations(items: GroceryRoutedItem[], store: Store, ts: number, opts: DispatchOptions = {}): void {
  for (const aiItem of items) {
    switch (act) {
      case 'add': {
        if (aiItem.target === 'pantry') {`

### Inconsistent tsconfig strictness across non-extending packages
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/packages/crisis-lexicon/tsconfig.json:1-15`
- **Problem:** Five packages (crisis-lexicon, worker-http, apns-jwt, apns-push, native) do not extend tsconfig.base.json, resulting in drift from the canonical strict settings. crisis-lexicon is missing forceConsistentCasingInFileNames, noFallthroughCasesInSwitch, and noImplicitReturns. This divergence weakens type safety guarantees and creates inconsistent compile-time behavior across the monorepo.
- **Fix:** Make all packages extend tsconfig.base.json. Add "extends": "../../tsconfig.base.json" to crisis-lexicon, worker-http, apns-jwt, and workers/apns-push; for apps/native consider extending or explicitly re-listing the base settings to maintain consistency with other app-level configs.
- **Evidence:** `crisis-lexicon compilerOptions keys: ["esModuleInterop", "isolatedModules", "lib", "module", "moduleResolution", "noEmit", "resolveJsonModule", "skipLibCheck", "strict", "target"] vs base: ["esModuleInterop", "forceConsistentCasingInFileNam`

### Voyage embedding response indices not bounds-checked
- **Dimension:** Dump Routing Flow Correctness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:456-457`
- **Problem:** The voyageEmbedBatch function accepts any numeric index from Voyage's response without validating it falls within [0, texts.length). If Voyage returns out-of-bounds indices (e.g., index=999 for a 2-fragment dump), the output array becomes sparse with undefined values at intended positions. Later, embeddings[i] returns undefined for those positions, causing cacheLookup to receive undefined and fail silently (caught as miss-through). Fragments then get re-classified by AI but the undefined embedding prevents proper cache writes.
- **Fix:** Add bounds validation: if (typeof row.index !== 'number' || row.index < 0 || row.index >= texts.length) { throw new Error(...) }. Also add a post-loop check to ensure all slots in out are filled (no undefined values).
- **Evidence:** `const slot = typeof row.index === 'number' ? row.index : i;
    out[slot] = row.embedding;`

### Sparse embeddings array not validated after Voyage response
- **Dimension:** Dump Routing Flow Correctness
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:449-459`
- **Problem:** After the forEach loop, the function returns out without verifying all slots are filled. If Voyage sends duplicate indices or skips indices, out will contain undefined values. The caller (line 265) then passes undefined to cacheLookup via embeddings.map, which fails silently and is treated as a cache miss. This causes fragments to be re-classified every request instead of being cached.
- **Fix:** After the forEach loop, add validation: for (let j = 0; j < out.length; j++) { if (out[j] === undefined) { throw new Error(...) } }. This ensures embeddings array is always dense and properly aligned with fragmentsText.
- **Evidence:** `const out: number[][] = new Array(texts.length);
  rows.forEach((row, i) => {
    ...
    out[slot] = row.embedding;
  });
  return out;`

### matchItem substring matching too permissive, allows false positive mutations
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:111-122`
- **Problem:** The matchItem function matches items using bidirectional substring inclusion (a.includes(b) || b.includes(a)). This allows dangerous false positives: 'pasta' matches 'a', 'chocolate' matches 'late', 'rice' matches 'ice'. When AI returns a short/unusual canonical or name, the substring match can mangle the wrong list item. The code comment claims 'intentionally permissive' to handle plural variants (eggs→egg), but it lacks a minimum substring length check. For mutation operations (remove/check/move_to_pantry), a false match causes silent data loss or misrouting.
- **Fix:** Add a minimum substring length requirement (e.g., >= 3 chars or >= 50% of shorter string) before accepting substring matches. Example: const minLen = Math.ceil(Math.min(a.length, b.length) * 0.5); return a.includes(b) || b.includes(a); only if minLen >= 3.
- **Evidence:** `function matchItem(storeItem, aiItem) { ... return a.includes(b) || b.includes(a); }  // No length validation on substrings`

### Orphaned admin:* events emitted with zero consumers
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/admin.ts:196–250 approx (multiple emit sites in admin.ts)`
- **Problem:** The admin orchestrator emits 15 cue events that are never listened to: admin:appointment_completed, admin:cost_of_delay, admin:decision_recall, admin:defer_chain, admin:doc_refs, admin:ef_scaffold, admin:firehose_dump, admin:last_5pct, admin:open_loop_missing, admin:paperwork_split, admin:recurring_pattern, admin:renewal_cue, admin:schedule_drift, admin:stale_ball, admin:two_minute_tasks. These are not captured in the orphan-cue-bridge.ts (which only covers 7 events: pets:care_gap_detected, grocery:duplicate_detected, grocery:auto_added, finance:recurring_candidate_detected, medication:adherence_drift, journal:entries_added, notifications:delivered). These orphan events represent detected system state changes that fall straight to the floor with no consumer to record or act on them.
- **Fix:** Either (1) add the 15 missing admin:* events to BRIDGED_CUE_EVENTS in orphan-cue-bridge.ts with their enum definitions in BridgedCueEvent, or (2) implement real consumers for each event (APNs, store writes, data pipeline). Currently the admin orchestrator's effort to detect these patterns is wasted.
- **Evidence:** `admin:appointment_completed, admin:cost_of_delay, admin:decision_recall, admin:defer_chain, admin:doc_refs, admin:ef_scaffold, admin:firehose_dump, admin:last_5pct, admin:open_loop_missing, admin:paperwork_split, admin:recurring_pattern, ad`

### 42+ additional orphaned cue events across finance/grocery/goals/habits/work/sleep/body/burhan
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src:See BRIDGED_CUE_EVENTS in packages/orchestrator/src/orphan-cue-bridge.ts:38–46 for the incomplete list.`
- **Problem:** Beyond the 15 admin:* orphans, 42+ other cue events are emitted and never listened to: finance (9 events: adhd_tax_candidate_detected, adhd_tax_updated, anomaly_detected, bill_due_predicted, bill_paid_on_time, cycle_spending_pattern_detected, impulse_pause_summary, spending_spike_detected, subscription_cancelled, subscription_detected, subscription_stale); grocery (4: interest_capture_detected, pattern_detected, routed, routing:pending); goals (1: pattern_detected); habits (4: completed, luteal_collapse_detected, morning_check, pattern_detected); work (3: hyperfocus_detected, matters_routed, pattern_detected); sleep (5: debt_accumulated, pacing_breach_detected, pattern_detected, short_sleep_run_detected, wind_down_window); body (4: doctor_visit_completed, hydration_drop_detected, pattern_detected, posture_nudge, supplement_due, weekly_review); pets (2: guilt_copy_generated, health_flag_raised); burhan (2: add_leaf, element_added); cycle (3: luteal_phase_entered, period_logged, pill_missed). Some are partially wired (e.g., pattern:detected and sleep:debt_accumulated have one consumer each), but most fall through with no tracker, bridge, or APNs hook.
- **Fix:** Extend orphan-cue-bridge.ts to capture all remaining cues under a unified telemetry tap, OR implement per-event consumers. The bridge pattern (emit → telemetry ring buffer) scales well and costs nothing per emitter. This is load-bearing for audit compliance — currently the codebase makes false claims about event consumption in registry.ts comments.
- **Evidence:** `Union of all emitted events (80 total) minus listened events (34 total) = 46 orphaned. Audit context in packages/orchestrator/src/orphan-cue-bridge.ts lines 2–22 documents this exact gap.`

### RoutingSummary includes undocumented pass2Triggered field
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:307-309`
- **Problem:** Worker returns RoutingSummary with `pass2Triggered: number` field, but the native app schema at apps/native/src/router/schema.ts lines 99-104 does not include this field. Worker test at workers/ai-proxy/tests/dump.test.ts line 112 also omits it from the type assertion, indicating it's an extra field not expected by the client. This causes the response shape to diverge from the contract.
- **Fix:** Either remove `pass2Triggered` from the worker's RoutingSummary before responding, or add it to the native schema if the client needs visibility into segmentation pass-2 triggers. Ensure both the native schema and worker test are updated to match.
- **Evidence:** `Worker dump.ts: 'summary: { moduleCount, cacheHitRate: ..., aiCalls, durationMs, pass2Triggered }'. Native schema RoutingSummary: 'moduleCount, cacheHitRate, aiCalls, durationMs' (no pass2Triggered). Test mock: 'summary: { moduleCount, cach`

### Fragment.payload type mismatch: discriminated union vs generic object
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:46`
- **Problem:** Worker schema defines Fragment.payload as `Record<string, unknown>`, a generic object without type discrimination. Native schema at apps/native/src/router/schema.ts line 88 defines it as `ActionPayload`, a discriminated union of typed action objects (BodyAction | WorkAction | etc.). This prevents compile-time validation that module handlers receive the correct payload shape. Module handlers must cast unsafely (e.g., `as GroceryAction` at apps/native/src/modules/grocery/handler.ts line 20), losing type safety.
- **Fix:** Update worker dump-schema.ts to export ActionPayload type and use `payload: ActionPayload` instead of `Record<string, unknown>`. This requires moving ActionPayload to a shared types file (either packages/router-schema or exporting from dump-schema.ts and importing in native). Alternatively, document this as intentional and update module handlers to include more specific assertions with validation.
- **Evidence:** `Worker dump-schema.ts:46: 'payload: Record<string, unknown>'. Native schema.ts:88: 'payload: ActionPayload'. grocery/handler.ts:20: 'const p = fragment.payload as GroceryAction;'.`

### Module 'mood' in enum but missing from MODULE_CONFIGS routing registry
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:118-130`
- **Problem:** Module enum in dump-schema.ts includes 'mood' as a valid routing target (line 19), but MODULE_CONFIGS at route.ts lines 118-130 does not register a mood configuration. If a dump fragment is classified as 'mood' by the AI, the route handler will fail to find a module config, potentially causing crashes or undefined behavior. No mood.config.ts exists in the modules directory.
- **Fix:** Either: (1) remove 'mood' from the Module enum if it's not yet implemented, or (2) create workers/ai-proxy/src/modules/mood.config.ts with a ModuleConfig shape and add it to MODULE_CONFIGS. Check native app for mood handlers at apps/native/src/modules/mood/* to inform the implementation.
- **Evidence:** `dump-schema.ts line 19: ''mood'' in Module enum. route.ts lines 118-130: MODULE_CONFIGS registers admin, grocery, body, cycle, finance, goals, habits, medication, pets, sleep, work (11 modules) but not mood. No /modules/mood.config.ts file `

### enriched_signals INSERT lacks idempotency guarantee after raw_dumps UPSERT retry
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:325-364`
- **Problem:** The drain's `processOne()` writes raw_dumps via UPSERT (idempotent on dump.id), then enriched_signals via plain INSERT (not idempotent). If a crash occurs between the raw_dumps upsert succeeding and the enriched_signals insert, a retry will re-attempt both. The raw_dumps write is safe (upsert merges), but enriched_signals INSERT will fail with a FK constraint violation since the dump_id already exists in enriched_signals. This causes the retry to throw, leaving the enrichment incomplete and the queue entry unable to progress.
- **Fix:** Change insertEnrichedSignal to use UPSERT on (dump_id, user_hash) OR add unique constraint + on_conflict clause. Alternatively, wrap both writes in a transaction (if PostgREST supports RPC calls) or perform a pre-flight check via GET before INSERT.
- **Evidence:** `insertRawDump uses UPSERT (line 304-315): 'prefer: 'resolution=merge-duplicates'', but insertEnrichedSignal uses plain POST (line 350-360) with no on_conflict handling. Between the two writes (line 205-214), if the worker crashes, the retry`

### scheduled_jobs upsert misses unique constraint on dedupe_key when status is not pending
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260513000001_scheduled_jobs.sql:47-49`
- **Problem:** The unique constraint `scheduled_jobs_dedupe_uniq` is a partial index that ONLY applies to rows where status='pending'. If a notification job is delivered (status='sent', 'rejected', 'muted', etc.) and a NEW scheduled job with the same dedupe_key is enqueued, the upsert POST will succeed and create a DUPLICATE row instead of merging. This violates the idempotency contract: the same dedupe_key across the user's lifetime should resolve to one canonical job, not spawn duplicates once the prior job leaves 'pending' status.
- **Fix:** Replace the partial unique index with an unconditional unique constraint: `CREATE UNIQUE INDEX scheduled_jobs_dedupe_uniq ON public.scheduled_jobs (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL`. This forces ALL dedupe_keys per user to be unique, and the UPSERT will correctly merge even after the prior job reaches a terminal status. Update scheduleServerJob to handle the merge via the on_conflict handler.
- **Evidence:** `Line 48: 'where dedupe_key is not null and status = 'pending'' — the WHERE clause means the constraint does NOT apply to terminal jobs. An upsert with the same dedupe_key but different fire_at (e.g. monthly digest rescheduled) will INSERT r`

### scheduled_jobs UPSERT does not specify on_conflict clause in API client
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/packages/notifications/src/server-schedule.ts:72-78`
- **Problem:** The scheduleServerJob() call to api.supabase.rest.upsert() does NOT pass on_conflict parameters. While the REST API's upsert() helper sends 'prefer: resolution=merge-duplicates', this only works if Postgres has a UNIQUE constraint. Since the dedupe_uniq constraint is partial (line 48 of migrations), a conflict only raises on duplicate pending rows. If a prior job with the same dedupe_key exists but is terminal (sent/rejected/muted), the upsert INSERT succeeds and creates a new row instead of updating the old one.
- **Fix:** Either (1) fix the Postgres constraint to be unconditional (see prior finding), OR (2) explicitly specify the on_conflict behavior in the upsert: add a parameter like `onConflict: { target: 'user_id,dedupe_key', action: 'update' }` to the API client and forward it in the prefer header. Without this, rescheduling a prior digests causes duplicates.
- **Evidence:** `Line 72-75 shows the upsert is a blind POST with no on_conflict=[...] parameters. The API client always sends 'prefer: resolution=merge-duplicates' (line 327 in client.ts), but Postgres MERGE semantics require explicit on_conflict handling `

### grocery_purchase_history table missing GRANT statements for authenticated role
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260522000001_grocery_purchase_history.sql:31-43`
- **Problem:** The grocery_purchase_history table has RLS enabled with authenticated policies (SELECT and INSERT for service_role), but the migration is missing GRANT statements to actually give the authenticated role access to the table. Authenticated users can have correct RLS policies but will be blocked from even attempting to SELECT/INSERT without explicit GRANT privileges on the table itself.
- **Fix:** Add GRANT statements after the RLS policies: 'grant usage on schema public to authenticated;' and 'grant select, insert on public.grocery_purchase_history to authenticated; grant select, insert on public.grocery_purchase_history to service_role;' (following the pattern used in finance_records, profiles, and encrypted_state migrations).
- **Evidence:** `ALTER TABLE grocery_purchase_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY grocery_purchase_history_self_select
  ON grocery_purchase_history
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY grocery_purchase_`

### cook_history table missing GRANT statements for authenticated and service_role
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260522000002_cook_history.sql:25-38`
- **Problem:** The cook_history table has RLS enabled with SELECT/UPDATE policies for authenticated and INSERT for service_role, but the migration is missing GRANT statements. Without explicit table-level grants, the RLS policies cannot take effect even though they are correctly defined.
- **Fix:** Add GRANT statements before the GRANT EXECUTE line: 'grant usage on schema public to authenticated;' and 'grant select, insert, update on public.cook_history to authenticated; grant select, insert, update on public.cook_history to service_role;' and 'revoke all on public.cook_history from anon;'
- **Evidence:** `CREATE POLICY cook_history_self_select
  ON cook_history FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY cook_history_service_write
  ON cook_history FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY `

### partner_bilateral_sync migration missing GRANT statements for partner_codes, partner_pairs, and partner_snapshots tables
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:47-55`
- **Problem:** All three tables (partner_codes, partner_pairs, partner_snapshots) have RLS enabled with service_role policies, but the migration completely lacks GRANT statements. Without explicit grants, even service_role cannot access these tables despite having RLS policies defined. This blocks the ai-proxy worker from reading/writing partner data.
- **Fix:** Add GRANT statements at the end of the migration: 'grant select, insert, update, delete on public.partner_codes to service_role; grant select, insert, update, delete on public.partner_pairs to service_role; grant select, insert, update, delete on public.partner_snapshots to service_role; revoke all on public.partner_codes from anon, authenticated; revoke all on public.partner_pairs from anon, authenticated; revoke all on public.partner_snapshots from anon, authenticated;'
- **Evidence:** `ALTER TABLE partner_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY partner_codes_service ON partner_codes FOR ALL TO service_role`

### routing_cache table missing GRANT statements
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260521000001_routing_cache.sql:70-78`
- **Problem:** The routing_cache table has RLS enabled with a service_role policy but is missing GRANT statements. Without explicit GRANT privileges, the service_role Cloudflare worker cannot read or write to this table despite having a valid RLS policy. This blocks the routing cache functionality.
- **Fix:** Add GRANT statements after the policy: 'grant select, insert, update, delete on public.routing_cache to service_role; revoke all on public.routing_cache from anon, authenticated;'
- **Evidence:** `alter table public.routing_cache enable row level security;

-- Only the service_role (CF worker) may read or write. No anon/user access.
create policy "service_role full access"
  on public.routing_cache
  to service_role
  using (true)
  `

### N+1 store updates in applyGroceryMutations loop
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:400-812`
- **Problem:** The applyGroceryMutations function iterates over items and calls store.update() for EACH item (lines 406-646), triggering N separate store mutations for a batch of AI-routed grocery items. Similarly, in the async AI routing path (lines 775-812), the loop over result.items calls store.update() once per item to append to pantry/shopping slices, causing N+1 mutation overhead. For a 5-item grocery classification, this means 5 separate update calls instead of one batched operation.
- **Fix:** Batch grocery mutations: accumulate all mutations by target slice (pantry/items) and apply one store.update() call per slice instead of per item. This reduces store.update() calls from O(N) to O(2) and eliminates redundant array spread operations. Build a map {[slice]: items_to_add} then apply in a single pass.
- **Evidence:** `'''typescript
for (const aiItem of items) {  // line 406
  const act: GroceryRoutedAction = aiItem.action ?? 'add';
  switch (act) {
    case 'add': {
      store.update<...>('grocery', 'pantry', (cur) => [...(cur ?? []), {...}]);  // line `

### Hardcoded English UI strings in button labels across native components
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/notify/NotifyPrimeLine.tsx:127,135`
- **Problem:** Multiple UI affordances and button labels throughout the app are hardcoded in English: 'allow', 'not now', 'keep', 'undo', 'photo', 'dismiss'. These appear in NotifyPrimeLine, NeedsConfirmCard, TodayNoticings, and PatternCards, making the app unusable for Spanish/Turkish speakers who see untranslated UI.
- **Fix:** Extract all UI button text into a localization table indexed by AppLang. Thread locale through component props. Examples: 'allow'→en|es|tr, 'not now'→en|es|tr, 'keep'→en|es|tr, 'undo'→en|es|tr.
- **Evidence:** `allow
not now`

### Dump input error messages are hardcoded in English only
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/BrainDumpInput.tsx:217-223`
- **Problem:** Error messages shown to users after dump submission failures are all hardcoded in English. Spanish/Turkish users cannot understand critical feedback about what went wrong (network, rate limit, auth, vision failure).
- **Fix:** Create a localization function that maps error codes to triligual messages. Thread AppLang through the component and use it to select the message.
- **Evidence:** `isVisionFail ? "Couldn't read the photo. Try again or type it out." :
        code === 'unauthorized' ? 'sign in to dump' :
        code === 'rate_limited' ? 'going too fast — your words are saved, try again in a few seconds' :
        code`

### Photo intake error messages are hardcoded in English only
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/PhotoIntake.tsx:45-54`
- **Problem:** The reasonCopy function returns English-only error messages for photo validation failures. Spanish/Turkish users cannot understand why their photo was rejected.
- **Fix:** Convert reasonCopy to accept AppLang parameter and return localized message. Thread lang through usePhotoIntake hook to the error display.
- **Evidence:** `case 'unsupported_mime':
      return "This kind of photo isn't supported yet.";
    case 'too_large':
      return 'Photo is too large, try a smaller one.';
    case 'decode_failed':
      return "Couldn't read that photo — try another."`

### Microphone access error messages are hardcoded in English only
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/MicButton.tsx:81-84`
- **Problem:** Microphone permission and error messages are hardcoded in English. Spanish/Turkish users cannot understand why their mic failed.
- **Fix:** Create a localized error message function indexed by error type and language. Thread AppLang through MicButton.
- **Evidence:** `name === 'NotAllowedError'
          ? 'mic blocked — allow microphone access in System Settings'
          : name === 'NotFoundError'
            ? 'no microphone found'
            : 'mic error: ${name}'`

### Notification permission prompt label is hardcoded in English (appears twice)
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/notify/NotifyPrimeLine.tsx:49`
- **Problem:** The notification permission request shows a hardcoded English label. A second instance in FocusTimer uses 'allow ollie to ping you when a session ends?'. Spanish/Turkish users see English prompts.
- **Fix:** Move label to a localization table. Thread useAppLang into NotifyPrimeLine and select label by language. Update FocusTimer to use the same pattern.
- **Evidence:** `label = 'allow ollie to send quiet reminders?'`

### TodayNoticings kicker and button labels are hardcoded in English
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/brain/TodayNoticings.tsx:147,179,186`
- **Problem:** Three user-facing strings in the noticings surface are hardcoded: the 'worth a glance' kicker, 'not now' postpone button, and 'dismiss' button. Spanish/Turkish users see English.
- **Fix:** Create triligual lookup table for these strings. Thread useAppLang and select strings by language.
- **Evidence:** `worth a glance
not now
dismiss`

### NeedsConfirmCard uses hardcoded English text in confirmation prompt
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/NeedsConfirmCard.tsx:72,78,109,127`
- **Problem:** The routing confirmation card displays four English strings: the 'photo' badge, 'not sure · confirm?' kicker, 'keep' button, and 'undo' button. Spanish/Turkish users cannot use this critical UI.
- **Fix:** Thread AppLang to NeedsConfirmCard; create localization table for all four strings.
- **Evidence:** `photo
not sure · confirm?
keep
undo`

### Crisis banner 'notice' kicker is hardcoded in English
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/dump/DumpScreen.tsx:304`
- **Problem:** The kicker label 'notice' (intended to be a SMCP accent indicating the section type) is hardcoded in English on the safety-critical crisis banner. Spanish/Turkish speakers see untranslated text.
- **Fix:** Localize 'notice' (es: 'aviso', tr: 'uyarı') and thread through CrisisBanner.
- **Evidence:** `notice`

### No tests for critical segmentation pipeline (pass1Segment)
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation.ts`
- **Problem:** The Pass 1 segmentation function (sentenceSplit, pass1Segment, word-count logic) has zero test coverage despite being foundational to the brain-dump classification pipeline. This 114-line module implements locale-aware sentence breaking and conjunction splitting, critical for correctly fragmenting multi-topic dumps before classification. The `Intl.Segmenter` fallback path in particular has no coverage.
- **Fix:** Add comprehensive tests for: (1) pass1Segment with multilingual text (en, tr, es), (2) conjunction re-splitting with all supported conjunctions, (3) edge cases: empty strings, very long sentences, sentences with only punctuation, (4) the fallback regex path when Intl.Segmenter throws.
- **Evidence:** `File exists at line 1-114 but no test file found via 'find ... -name '*segmentation*.test.ts''. Pass1Fragment interface (lines 105-109) and Pass1Result (111-114) are tested implicitly through route.test.ts but the unit behavior (word counti`

### json-cascade provider fallback chain has no tests
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/json-cascade.ts`
- **Problem:** The jsonCascade function (lines 55-122) orchestrates the fallback chain (Groq→Cloudflare→Gemini→OpenRouter) that prevents silent data loss (cited in line 21: B3, 2026-06-05). Zero test coverage for: (1) parse rejection advancing the chain, (2) empty content from a provider triggering fallthrough, (3) the last provider's error bubbling correctly, (4) the `console.error` side-effect log on fallthrough.
- **Fix:** Add tests verifying: (1) first provider succeeds → returns immediately without calling others, (2) first provider throws → next provider is called, (3) parse callback throws → next provider runs, (4) all providers fail → last error is thrown, (5) empty content (line 79) correctly triggers fallthrough.
- **Evidence:** `122-line module with complex state machine logic (lines 109-121 for loop). No test files found. The chain array construction (lines 62-106) has conditional pushes based on env but no test coverage of the various provider subsets (only groq,`

### dump-classify core classification function untested
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-classify.ts`
- **Problem:** The classifyFragment function (285 lines) is the Layer 1 classifier invoked on every fragment. While dump-coverage.test.ts mocks Groq responses, there are NO unit tests for the classifier wrapper itself: (1) confidence score extraction from Groq's response, (2) JSON parse failures and error handling, (3) module/action mismatch handling, (4) the payload shape assembly logic, (5) edge cases like missing required fields or malformed tool_calls.
- **Fix:** Add isolated unit tests that mock Groq minimally and focus on classifyFragment's internal parsing logic: (1) valid Groq response with well-formed tool_calls → correct confidence/module/payload extraction, (2) Groq returns empty/null content → throws or returns sentinel, (3) tool_calls array is malformed or missing → handled gracefully, (4) confidence is missing from response → defaults correctly.
- **Evidence:** `File at line 1-285. Related test dump-coverage.test.ts (lines 1-46) explicitly states it does NOT cover the classifier wrapper (line 25: 'The classifier code itself is exercised end-to-end (prompt assembly + JSON parse + payload assembly), `

### Groq / Gemini / Cloudflare AI client modules are untested
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/groq.ts /Users/serrayildirim/ollie/workers/ai-proxy/src/gemini.ts /Users/serrayildirim/ollie/workers/ai-proxy/src/cloudflare-ai.ts`
- **Problem:** Three provider client modules (groq.ts, gemini.ts, cloudflare-ai.ts) have zero test coverage. These are foundational HTTP wrappers used throughout the router. Untested paths include: (1) error status codes (429, 503, 5xx) and their handling, (2) malformed responses (missing keys, invalid JSON), (3) rate-limit retries, (4) timeout behavior, (5) the metric/logging side effects.
- **Fix:** Add unit tests for each provider: (1) successful request→response parsing, (2) network errors throw, (3) HTTP error codes (429, 503, 502) are logged/surfaced correctly, (4) response parse failures are caught and logged safely (no secret leakage), (5) required API keys are validated at call time.
- **Evidence:** `groq.ts (no test file), gemini.ts (no test file), cloudflare-ai.ts (no test file). Used by jsonCascade and route handlers but error paths never exercised. For example, groqChat function (lines 60-130 implied) has no 429 backoff retry test.`

### No tests for segmentation-llm Pass 2 (Gemini Flash)
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation-llm.ts`
- **Problem:** The Pass 2 segmentation function (56 lines) calls Gemini Flash 2.5 with a JSON array response schema. Zero test coverage for: (1) valid Gemini response parsing, (2) array structure validation, (3) per-fragment text length validation, (4) Gemini failure paths, (5) JSON schema validation against the declared schema.
- **Fix:** Add tests: (1) successful Gemini call → array of fragments returned, (2) Gemini returns empty array → handled gracefully, (3) malformed JSON from Gemini → caught and escalated, (4) each fragment in response respects max-length constraint, (5) Gemini 429/503 → escalates to next provider via jsonCascade.
- **Evidence:** `segmentation-llm.ts exists (56 lines) with no test file. Depends on Gemini which is also untested. Decision C (line 17 of segmentation.ts) mandates JSON array response but no test verifies schema.`

### React type version mismatch between @ollie/store and apps/native
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/packages/store/package.json:21`
- **Problem:** The @ollie/store package declares @types/react@^18.3.12 (resolves to 18.3.28) in devDependencies, but apps/native uses @types/react@^19.1.8 (resolves to 19.2.15). Since store exports a React hook file (./react.ts) that depends on React types, and native depends on the store with React 19 runtime, there is a type version conflict. Native's React 19 types may not be compatible with store's React 18 types, potentially causing type errors in hook consumption.
- **Fix:** Update @ollie/store to use @types/react@^19.1.8 to match the installed React version (19.2.6 in native) and the consumer's type definitions, ensuring type compatibility across the workspace.
- **Evidence:** `packages/store/package.json line 21: '@types/react': '^18.3.12' (resolved 18.3.28) vs apps/native/package.json line 39: '@types/react': '^19.1.8' (resolved 19.2.15)`

## MEDIUM — 57

### Missing explicit RLS policy on telemetry tables written by service_role
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260514000001_raw_dumps.sql:45-49`
- **Problem:** The raw_dumps, enriched_signals, retention_events, session_events, module_events, and crisis_events tables have `revoke all from anon, authenticated` but lack explicit `grant insert, select, update, delete on <table> to service_role`. While the Cloudflare workers successfully write to these tables (suggesting implicit grants from table creation), the absence of explicit grants makes the authorization model unclear and fragile. If table ownership or role hierarchy ever changes, writes could silently fail or be inaccessible. The pattern should match research_corpus (20260514000012_research_corpus.sql line 69) which explicitly grants service_role access.
- **Fix:** Add explicit grant statements to all 6 telemetry tables. For each (raw_dumps, enriched_signals, retention_events, session_events, module_events, crisis_events):
```sql
grant insert, select, update, delete on public.<table> to service_role;
```
This makes the authorization intent explicit and survives ownership/role changes. The grant statement should immediately follow the `revoke all` line.
- **Evidence:** `Lines 45-49 of raw_dumps.sql:
'''
alter table public.raw_dumps enable row level security;
alter table public.raw_dumps force row level security;

revoke all on public.raw_dumps from anon, authenticated;
'''

No grant statement follows. Comp`

### Insufficient validation of arbitrary row object in /ingest-event
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/telemetry.ts:168-208`
- **Problem:** The /ingest-event endpoint accepts a body.row object (Record<string, unknown>) with minimal validation - only checks it's an object and not an array. The entire row is then directly stringified and sent to Supabase. While Supabase's schema validation will catch type errors, an attacker can send a deeply nested or extremely large row object that consumes memory/bandwidth before validation. No size limits are checked on individual fields or the total row object size.
- **Fix:** Add a size limit check before JSON.stringify: check that JSON.stringify(body.row).length does not exceed a reasonable limit (e.g., 64KB). For known event tables, optionally whitelist allowed column names and validate field types.
- **Evidence:** `if (!body.row || typeof body.row !== 'object' || Array.isArray(body.row)) {
    return json({ error: 'invalid_row' }, 400);
  }
  // ... later ...
  const url = '${env.SUPABASE_URL.replace(//$/, '')}/rest/v1/${body.table}';
  const resp = a`

### Hardcoded sleep inline pattern instead of using shared utility
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/gemini.ts:63`
- **Problem:** Two workers (ai-proxy/gemini.ts:63 and ai-proxy/router/vision.ts:77) use inline `new Promise((r) => setTimeout(r, ms))` patterns instead of importing the sleep() function from @ollie/api. While @ollie/api exports a sleep helper at line 379, these workers reimplement it inline, making the code less maintainable and introducing inconsistency if timeouts need to be configured globally.
- **Fix:** Extract the sleep function to a shared utility module (e.g., @ollie/util or @ollie/sleep). Export it from a common location and update both workers and @ollie/api to import it. This allows timeout behavior to be adjusted in one place if needed.
- **Evidence:** `'''typescript
// @ollie/workers/ai-proxy/gemini.ts:63
await new Promise((r) => setTimeout(r, 900));
// @ollie/workers/ai-proxy/router/vision.ts:77
await new Promise((r) => setTimeout(r, 1000));
// vs @ollie/api/client.ts:379
function sleep(`

### Debouncer reimplementation in sync module
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `/Users/serrayildirim/ollie/packages/sync/src/retry.ts:31-49`
- **Problem:** The @ollie/sync/retry.ts module exports a custom createDebouncer() function (lines 31-49), but this is a generic per-key debouncer that would be useful across the codebase. The comment in the module acknowledges that 'both sync clients (index.ts and finance.ts) hand-rolled the same per-key debounce' before consolidation, but the pattern could likely be needed elsewhere. There is no shared @ollie/debounce package, so future modules might reinvent this.
- **Fix:** Extract createDebouncer to @ollie/sync as a public export so other packages can import it, or create a dedicated @ollie/debounce package. Document this in the module barrel exports to increase discoverability.
- **Evidence:** `'''typescript
// @ollie/sync/retry.ts:31-49
export function createDebouncer<K>(delayMs: number): Debouncer<K> {
  const timers = new Map<K, ReturnType<typeof setTimeout>>();
  return {
    schedule(key, fn) {
      const existing = timers.g`

### Median function reimplemented in cadence module
- **Dimension:** Reinvented Wheels & Duplication
- **File:** `/Users/serrayildirim/ollie/packages/cadence/src/index.ts:206-214`
- **Problem:** The @ollie/cadence module implements its own median() function (lines 206-214) instead of importing from @ollie/logic/stats which exports a canonical median() at line 37 of stats/index.ts. The stats module's median explicitly handles the even-length case correctly (averaging two middle elements), and this function should be the single source of truth. The module comment notes a prior bug where some median implementations returned the wrong element for even-length arrays.
- **Fix:** Import median from @ollie/logic/stats instead of defining it locally. Update cadence to import `{ median } from '../logic/stats'` (or use the full path depending on cadence's dependency structure).
- **Evidence:** `'''typescript
// @ollie/cadence/index.ts:206
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 ==`

### Incomplete sub-path exports in @ollie/logic
- **Dimension:** File & Module Structure
- **File:** `/Users/serrayildirim/ollie/packages/logic/package.json:8-27`
- **Problem:** The @ollie/logic package exports 17 submodules (cycle, pets, grocery, etc.) but does not export 7 implemented sub-modules: consumption, corrections, dissection, predict, products, prompts, ritual. This inconsistency creates hidden imports and makes the module API surface incomplete—callers must use the full root import or undocumented subpaths.
- **Fix:** Either add all 7 submodules to the exports map in package.json (consistent API surface), or remove them from src/ and re-export only via the root namespace. Currently the CODEBASE_MAP.md itself flags this: 'Missing from exports: consumption, corrections, dissection, predict, products, prompts, ritual (importable only via the root index.ts namespace).'
- **Evidence:** `Exports declared at lines 8-27 include cycle, pets, grocery... but missing exports are consumption, corrections, dissection, predict, products, prompts, ritual. These modules exist in src/ (e.g., /packages/logic/src/dissection/) but are not`

### Orchestrator exports internal dedup utility for tests only
- **Dimension:** File & Module Structure
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/index.ts:40`
- **Problem:** @ollie/orchestrator exports appendCapped and DEFAULT_DEDUP_CAP from ./dedup-store at the public API level. These are implementation details used internally by orchestrators (work.ts, finance.ts, cycle.ts) for bounding emitted-id arrays. The exports are only used in orchestrator tests, not by consumers outside the package.
- **Fix:** Remove the dedup-store exports from the public API (index.ts line 40). Keep them importable from './dedup-store' directly for tests if needed, but they should not be part of the public @ollie/orchestrator interface.
- **Evidence:** `Line 40: 'export { appendCapped, DEFAULT_DEDUP_CAP } from './dedup-store';' Search results show appendCapped is only used in three files: orchestrator/src/{work,finance,cycle}.ts (internal) and orchestrator/tests/dedup-store.test.ts (test).`

### Incomplete package.json exports in @ollie/orchestrator
- **Dimension:** File & Module Structure
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/package.json:1-10`
- **Problem:** @ollie/orchestrator has no package.json exports field, unlike @ollie/logic and @ollie/notifications which explicitly declare submodules. This means the module relies on implicit file resolution, making its API surface ambiguous—consumers could import from src/research, src/braindump-dispatch, or src/types without hitting a bundler error.
- **Fix:** Add an exports field to orchestrator's package.json listing all public sub-modules (e.g., './cycle', './patterns', './research', './braindump-dispatch') so the module API is explicit. This allows bundlers to enforce proper import paths and makes the boundary clear.
- **Evidence:** `Orchestrator package.json lacks an exports field. In contrast, @ollie/logic defines 17 subpaths, @ollie/notifications defines 7 subpaths. Orchestrator defines none, so the entire src/ is implicitly importable.`

### @ollie/notifications imports from @ollie/api without declaration
- **Dimension:** File & Module Structure
- **File:** `/Users/serrayildirim/ollie/packages/notifications/package.json:23-26`
- **Problem:** The @ollie/notifications package depends on @ollie/api (line 24) but @ollie/api is not listed in the package.json dependencies. This hidden dependency could cause runtime failures if @ollie/api is not installed separately, or bundler confusion if the dependency graph is flattened.
- **Fix:** Add '@ollie/api': 'workspace:*' to notifications/package.json dependencies (line 24-26 block). Ensure all modules declare their full dependency tree in package.json.
- **Evidence:** `notifications/package.json lists @ollie/store and @ollie/events as dependencies, but not @ollie/api. However, notifications/src/server-schedule.ts imports 'type { OllieAPI } from '@ollie/api'', and notifications/src/index.ts likely uses it `

### Unsafe cast of object property access in orchestrator finance module
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:953`
- **Problem:** taxProfile is narrowed by an in-operator check, then cast `as unknown as { calculator: TaxCalculator }` to access .calculator. While the in-operator check provides runtime safety, the double-cast is unnecessary and hides the actual type of taxProfile from static analysis.
- **Fix:** Type the in-operator result properly: `if (taxProfile != null && 'calculator' in taxProfile) { const c = (taxProfile as any)['calculator'] as TaxCalculator; }` or define a type guard function.
- **Evidence:** `  const calculator: TaxCalculator = taxProfile != null && 'calculator' in taxProfile
    ? (taxProfile as unknown as { calculator: TaxCalculator }).calculator`

### Multiple as unknown casts in layout components lose type information
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/apps/native/src/layout/Box.tsx:78`
- **Problem:** resolveSpace() casts the space key lookup result through unknown: `space[val as unknown as SpaceKey]`. The pattern guards at runtime (in-operator check at line 78) but the double-cast suggests the types don't align naturally. Similar patterns appear in Row.tsx, Stack.tsx, Container.tsx, Spacer.tsx.
- **Fix:** Strengthen the type signature of the prop type union (`string & {}`) so TypeScript can narrow naturally, eliminating the need for the unknown cast.
- **Evidence:** `  if (val in space) return space[val as unknown as SpaceKey];`

### Theme tokens cast to unknown Record bypasses type safety
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/apps/native/src/theme/tokens.ts:208-225`
- **Problem:** tokensToCssVars() casts all theme token objects (palette, fonts, fontSizes, etc.) `as unknown as Record<string, string|number>` to iterate. The cast hides type mismatches if token shapes change; any non-string/number value would pass through.
- **Fix:** Define a stricter token type that enforces Record<string, string> (or number) structure, or use Object.entries() with explicit type narrowing instead of casting.
- **Evidence:** `  writeGroup('color', t.palette as unknown as Record<string, string>);
  writeGroup('font', t.fonts as unknown as Record<string, string>);`

### Unsafe cast in mood handler bypasses action type narrowing
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/mood/handler.ts:32`
- **Problem:** fragment.payload is cast `as unknown as MoodAction` without prior validation. If the payload is malformed, the cast allows it through. The switch statement at line 39 provides some runtime safety (default case), but a bad payload could still crash property access.
- **Fix:** Use Zod/io-ts to validate fragment.payload against a MoodAction schema before casting, returning an error result on validation failure.
- **Evidence:** `    const p = fragment.payload as unknown as MoodAction;`

### Unsafe JSON.parse without validation in grocery and work repos
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/repo.ts:not listed but seen in search`
- **Problem:** JSON.parse(raw) as unknown pattern appears in multiple repo files without schema validation. If the persisted JSON structure changes or corrupts, the code may crash or produce invalid data downstream.
- **Fix:** Wrap JSON.parse in a try/catch and use a schema validator (Zod) to ensure the parsed shape matches expectations before use.
- **Evidence:** `    const parsed = JSON.parse(raw) as unknown;`

### Object.keys() loses type information in loops
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/journal/extract.ts:262`
- **Problem:** Object.keys(e) returns string[] even though e is typed as Record<string, unknown>. Any iteration over the keys loses the original type information and must be re-narrowed. While this pattern works at runtime due to guard checks, it's fragile if logic changes.
- **Fix:** Use Object.entries(e) and destructure both key and value, allowing TypeScript to preserve type information across the loop.
- **Evidence:** `  for (const k of Object.keys(e)) {
    if (BANNED_FIELDS.has(k)) errors.push('banned field: ${k}');`

### Logic module casts object to unknown Record for iteration
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/finance/merge.ts:41`
- **Problem:** Object iteration casts the result `as unknown as Record<string, unknown>` to assign properties. This bypasses the type system and allows any key/value to be set without validation. If next contains unexpected keys, they'll be silently copied.
- **Fix:** Iterate with explicit type-safe assignment: `Object.entries(next ?? {}).forEach(([k, v]) => { if (v !== null && v !== undefined) out[k as keyof FinanceRecord] = v; })`
- **Evidence:** `      (out as unknown as Record<string, unknown>)[k] = v;`

### API client casts response text to unknown Type without parsing
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/packages/api/src/client.ts:194`
- **Problem:** When parseJson is false, the response text is cast directly to T without any validation or runtime checks: `const data = (await res.text()) as unknown as T;`. Callers receive whatever string is returned, typed as T, with no guarantee it matches.
- **Fix:** Document the parseJson=false behavior clearly, or provide a validation callback parameter so callers can optionally schema-check the text before using it.
- **Evidence:** `      if (!req.parseJson) {
        const data = (await res.text()) as unknown as T;`

### cadence-scanner fires notifications without awaiting; errors silently logged
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:409-420`
- **Problem:** Line 409 fires notify() without await and wraps only a defensive catch (lines 415-420) saying 'if notify throws synchronously'. But notify is async — if it rejects, the rejection is caught and logged, then the loop continues. If the same key fails repeatedly, the scanner keeps calling notify every 30 minutes, wasting resources on known failures. No exponential backoff or circuit-breaker logic.
- **Fix:** Add a per-key failure counter. After 3 consecutive failures for the same key, skip it for that day and log a warning-level message so operator alerts can catch systematic notification failures (e.g., wrong URL, database down).
- **Evidence:** `void notify({
  title,
  body,
  category: templates.category,
  dedupe_key: dedupeKey,
  action_url: templates.actionUrl,
}).catch((err: unknown) => {
  // Defensive: notify is supposed to swallow its own errors,
  // but if a future chang`

### sync/finance.ts recursion on syncIn can cause unbounded stack growth if pages never exhaust
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:544-546`
- **Problem:** Line 544-546 recursively calls syncIn() if rows.length >= PAGE_LIMIT. No recursion depth limit. If the remote table grows faster than the cursor advances (due to concurrent writes or a stuck cursor), the stack can grow unbounded, causing a stack overflow. The comment 'Bounded by the cursor advancing' is not true in a replay scenario.
- **Fix:** Implement a maximum recursion depth (e.g., 10 pages = 5000 rows per sync) and break the recursion with a logged warning if exceeded. Alternatively, convert to a loop: `while (rows.length >= PAGE_LIMIT) { ... rows = await fetch(...); }`
- **Evidence:** `    // If we hit the page limit, there are likely more rows — recurse
    // once to drain the rest. Bounded by the cursor advancing.
    if (rows.length >= PAGE_LIMIT) {
      await syncIn();
    }`

### worker-http newRequestId falls back to weak random UUID on crypto failure
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/worker-http/src/index.ts:66-72`
- **Problem:** The try/catch swallows crypto.randomUUID errors silently and falls back to a timestamp + Math.random string. On a worker with broken crypto (unlikely but possible), request_ids become non-unique, breaking log correlation. The fallback is predictable (timestamp is visible, Math.random is weak).
- **Fix:** Log the crypto failure at warn level so operators know request correlation is degraded. Consider adding a flag to upstreamError responses when using the fallback, or switch to a better fallback entropy source (e.g., nanosecond-precision timer + counter).
- **Evidence:** `export function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return 'req_${Date.now().toStrin`

### research-stream fire-and-forget cache writes have no error recovery
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/research-stream/src/index.ts:211-222`
- **Problem:** Line 212-219: trackTable fires a POST to /ingest-event via fire-and-forget with .catch(() => { /* best-effort */ }). If the worker is down, the research data is lost with no retry queue. Multiple calls to trackTable in quick succession can all fail without any batching or retry mechanism.
- **Fix:** Implement a small in-memory queue with retry logic (similar to the @ollie/research-stream flush mechanism itself). On first failure, queue the row. On next trackTable, check the queue and retry failed rows before issuing the new one.
- **Evidence:** `void f(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ${jwt}',
        },
        body: JSON.stringify({ table, row }),
      }).catch(() => { /* best-effort `

### sync/finance drainOnce has incomplete error path on upsert/delete failure
- **Dimension:** Error Handling & Resilience
- **File:** `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:340-395`
- **Problem:** Lines 357-369: if upsert fails with 'unauthorized', an event is emitted but execution continues to line 380 (the delete loop) without a return. This means even if auth is broken, the delete loop still tries to execute, potentially causing duplicate errors. Lines 380-394: if a delete fails, the function returns early, leaving the upserts queue dirty. If 10 upserts succeed and 1 delete fails, the queue is left with 1 delete, but on the next drain those 10 upserts are lost from snapshots and never sent again.
- **Fix:** Restructure drainOnce to track upsert and delete success independently. After upserts succeed, clear the upsert queue immediately. Only attempt deletes if upserts succeeded. On any failure, log the queue state so a stalled sync can be diagnosed.
- **Evidence:** `if (!r.ok) {
        if (r.error.code === 'unauthorized') {
          try { events.emit('sync:auth_expired', { ts: nowFn() }); }
          catch { /* registry warn ok */ }
        } else {
          // Leave queue intact, retry with exponen`

### Fire-and-forget promise chain lacks proper error boundaries in dispatch
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/dispatch.ts:95-109`
- **Problem:** The post-dispatch sync chain floats a Promise.all without a top-level catch. While both branches have internal .catch handlers, if recomputeBrain() rejects in an unexpected way after the .then() chains resolve, the error could escape uncaught. Additionally, the promise is floated with `void`, making it completely fire-and-forget with no way to track completion or coordinate with other async work. If the sync and brain recomputation order matters for watcher consistency, a watcher could read stale data before the chain completes.
- **Fix:** Add a comprehensive try/catch wrapper around the entire chain to catch any unexpected rejections from recomputeBrain(). Consider returning a settled promise (one that always resolves) from the chain to make the fire-and-forget intent explicit. If watcher consistency is critical, document the acceptable race window or add explicit synchronization.
- **Evidence:** `Lines 95-109: 'void Promise.all([...]).then(...).catch(...)' The promise is fire-and-forget with no tracking. The comment at line 91-94 acknowledges this is acceptable but creates implicit ordering assumptions.`

### Concurrent enqueue and drain in finance sync can lose updates
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/packages/sync/src/finance.ts:319-327 and 331-413`
- **Problem:** The debouncedDiff() function schedules diffAndEnqueue() asynchronously at line 321. During the debounce delay, store mutations can queue new items, and then drainOnce() can run while enqueues are still pending. If drainOnce() reads q at line 335 before a pending diffAndEnqueue() writes its results, those pending items are lost in the current flush cycle (they won't be in the 'shipped' set for cleanup, so they remain queued—actually acceptable—but the semantics are racy). Worse, if an enqueue happens between the initial readQueue and the cleanup writeQueue, items could be incorrectly filtered.
- **Fix:** Ensure enqueueUpsert and enqueueDelete are synchronous with respect to the queue write, or use a higher-level lock around enqueue+readQueue+writeQueue sequences. Alternatively, document that concurrent enqueues during a drain are acceptable (they'll be retried on the next cycle) and ensure tests verify this behavior.
- **Evidence:** `Line 320-322: 'diffDebouncer.schedule(storeKey, () => void diffAndEnqueue(...).then(() => scheduleDrain()))' The enqueue is async. If drainOnce starts before this completes, the queue mutation races with the drain cleanup at lines 371-374.`

### Potential cache stampede on Vectorize lookup in dump route
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump.ts:264-271`
- **Problem:** The dump route fans out Vectorize cache lookups in parallel with Promise.all(). Each lookup calls cacheLookup() with .catch() to handle failures gracefully (lines 266-269). However, if the cacheLookup fails (Vectorize down or timeout), all fragments default to cache miss and fall through to the AI classify path. On high concurrency with a shared cache backend, a Vectorize outage causes all requests to hammer the downstream AI providers (Groq/Gemini/Cloudflare) simultaneously instead of falling back to a degraded state or queue. There's no circuit breaker or request coalescing for the class phase.
- **Fix:** Add a circuit breaker around Vectorize calls to detect repeated failures and return a synthetic 'all miss' state without hammering the backend. Alternatively, implement request coalescing for identical embeddings to prevent duplicate AI calls for the same fragment across concurrent dumps. Consider adding exponential backoff on AI classify failures.
- **Evidence:** `Lines 264-271: 'Promise.all(embeddings.map((embedding) => cacheLookup(...).catch(() => null)))' On cache miss or timeout, all fragments skip to AI. No aggregation or backoff between requests.`

### recomputeDerived in finance.ts contains excessive try-catch blocks and repeated dedup patterns
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:274-850+`
- **Problem:** The recomputeDerived function (>1000 lines total) contains dozens of try-catch blocks wrapping similar emit/dedup patterns. The pattern repeats: read previous state from store, filter for new items, emit event, append to dedup set. This boilerplate could be extracted into a helper function or utility. The function is also difficult to maintain because the emit pattern is duplicated across recurring, stale subs, bills due, anomalies, patterns, etc.
- **Fix:** Create a helper function like emitOncePerKey(key: string, items: T[], keyFn: (item: T) => string, emitFn: (item: T) => void) to consolidate the dedup/emit/store pattern. This eliminates ~15+ duplicated try-catch blocks and makes the code more testable.
- **Evidence:** `      // Emit finance:subscription_stale for newly stale subs (dedup per pattern_id).
      try {
        const seenStale = new Set(store.get<string[]>('finance', '_staleSubEmittedIds', []) ?? []);
        const freshStale: string[] = [];
 `

### applyCapitalizedNameHeuristic in pii-scrub has 3 nested loops with complex flag logic
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/pii-scrub/src/index.ts:388-440`
- **Problem:** The applyCapitalizedNameHeuristic function has a complex multi-pass algorithm with three nested loops (parts split, isNameWord map, isAnchor map, then flagging logic). The two-condition logic for name detection (line 421-431) is difficult to follow — checking both adjacency and trigger words with different loop directions. This makes the function hard to test and maintain.
- **Fix:** Extract the two conditions into separate helper functions: isPartOfNameRun(i, isAnchor, words) and isPrecededByTrigger(i, words). Then simplify the main loop to `flagged[i] = isPartOfNameRun(i, ...) || isPrecededByTrigger(i, ...)`. This improves readability and testability.
- **Evidence:** `for (let i = 0; i < words.length; i++) {
    if (!isNameWord[i]) continue;
    // (1) part of a capitalized run of 2+ name-like words
    if (isAnchor[i - 1] || isAnchor[i + 1]) {
      flagged[i] = true;
      continue;
    }
    // (2) im`

### recomputeDerived function exceeds 1000 lines, making it a god function
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:309-1100+`
- **Problem:** The recomputeDerived function in the finance orchestrator is over 1000 lines and handles nearly every finance computation task: recurring detection, anomalies, D3 patterns, subscriptions, bills, savings, taxes, impulse pauses, milestone tracking, etc. Each sub-task could logically be its own function. The monolithic design makes it hard to navigate, test individual features, and reuse logic.
- **Fix:** Break recomputeDerived into smaller functions per domain: computeRecurringPatterns(), detectAnomalies(), detectD3Patterns(), emitSubscriptionEvents(), computeSavingsMetrics(), etc. Each would handle its own logic and emit pattern. Then recomputeDerived becomes a simple orchestrator calling each sub-function. Target 50-100 lines per function.
- **Evidence:** `function recomputeDerived(): void {
  try {
    const now = getNow();
    // ... 50+ lines of pre-setup ...
    // recurring detection
    // ... 30 lines ...
    // anomaly detection
    // ... 50 lines ...
    // D3 patterns
    // ... 60`

### apns-push worker tsconfig missing forceConsistentCasingInFileNames
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/workers/apns-push/tsconfig.json:1-16`
- **Problem:** The apns-push worker's tsconfig is completely standalone and omits forceConsistentCasingInFileNames, which is enforced in tsconfig.base.json. This allows case-sensitivity inconsistencies (e.g., importing from './Module' vs './module') that would fail on case-sensitive filesystems like CI Linux but work locally on macOS. Root cause: does not extend the base config.
- **Fix:** Either: (1) change apns-push/tsconfig.json to extend ../../tsconfig.base.json, or (2) explicitly add "forceConsistentCasingInFileNames": true to the compilerOptions.
- **Evidence:** `apns-push tsconfig.json has no "extends" field and no "forceConsistentCasingInFileNames" setting, whereas tsconfig.base.json defines "forceConsistentCasingInFileNames": true`

### worker-http missing noFallthroughCasesInSwitch setting
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/packages/worker-http/tsconfig.json:1-17`
- **Problem:** worker-http's standalone tsconfig omits noFallthroughCasesInSwitch, which is set in the base config. This allows switch statements to fall through unintentionally without TypeScript catching the error, creating a potential source of logic bugs in worker code.
- **Fix:** Extend tsconfig.base.json from worker-http/tsconfig.json (add "extends": "../../tsconfig.base.json" and remove duplicate settings), or explicitly add "noFallthroughCasesInSwitch": true.
- **Evidence:** `worker-http tsconfig.json compilerOptions do not include "noFallthroughCasesInSwitch", whereas tsconfig.base.json has "noFallthroughCasesInSwitch": true`

### apps/native tsconfig missing forceConsistentCasingInFileNames
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/apps/native/tsconfig.json:1-25`
- **Problem:** The native app's tsconfig does not extend the base config and omits forceConsistentCasingInFileNames. This is the only major app config in the workspace and its divergence creates a blind spot for case-sensitivity bugs that would surface on Linux CI runners but not macOS development machines.
- **Fix:** Either extend tsconfig.base.json (if compatible with Vite/Tauri setup) or explicitly add "forceConsistentCasingInFileNames": true to maintain parity with the rest of the workspace.
- **Evidence:** `apps/native/tsconfig.json does not have an "extends" field and does not define "forceConsistentCasingInFileNames", while tsconfig.base.json enforces it globally`

### ESLint config ignores all config files, creating drift risk
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/eslint.config.mjs:32`
- **Problem:** ESLint's flat config explicitly ignores all **/*.config.{js,mjs,cjs,ts} files. While this is intentional to avoid linting build tooling, it means any lint config files themselves (if written in TS/JS) are never checked. Combined with no linting of tools/eslint-plugin-ollie itself, the plugin code could drift from lint standards.
- **Fix:** Document this design decision in a comment in eslint.config.mjs. Consider adding a separate lint pass for the eslint-plugin-ollie source files in CI (tools/eslint-plugin-ollie/index.cjs) if that code is production-critical.
- **Evidence:** `eslint.config.mjs line 32: "**/*.config.{js,mjs,cjs,ts}",`

### Timezone-dependent dedupe key can cause duplicate cadence notifications when user changes timezone
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/cadence-scanner.ts:232-239`
- **Problem:** The localDayKey function constructs a dedupe key using Date.getFullYear/getMonth/getDate, which return LOCAL (browser) time. While this is correct for a client-side app, the design assumes the user's timezone remains stable. If a user travels across timezone boundaries and triggers a cadence scan in a different timezone on the same UTC day, the dedupe key will differ, allowing the same noticing to fire twice on the same physical day. The 24-hour dedupe window in notify() may not catch this if scans are < 24h apart in UTC but in different local calendar days.
- **Fix:** If the app must support multi-timezone scenarios, convert to UTC calendar day first (e.g., use getUTCFullYear/getUTCMonth/getUTCDate). Alternatively, add a comment documenting that localDayKey assumes stable timezone and is safe only for browser-side deployment.
- **Evidence:** `const d = new Date(ts); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return '${y}-${m}-${day}';  // Uses local time, not UTC`

### Grocery mutation regex does not match "threw out" (needs word boundary before subject)
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/braindump-dispatch.ts:98-99`
- **Problem:** The MUTATION_RE regex includes 'threw out' but the pattern requires a word boundary after it (\b). Testing shows 'threw it out' does NOT match the regex, only 'threw out [item]' would. This means a user input like 'I threw it out' will not be recognized as a mutation, so the placeholder will be written synchronously, and the AI result (which may have action='remove') will be treated as an 'add' path instead, potentially duplicating items.
- **Fix:** Adjust the regex to better handle natural language, or extend the test/training data to include common phrases. Consider: 'threw|threw it|threw them|threw out' as separate alternatives, or use a more lenient boundary (word character followed by space/end-of-string).
- **Evidence:** `const MUTATION_RE = /\b(remove|...threw out|...)\b/i;  test('I threw it out') → false;  test('threw out milk') → true`

### Store dedup keys never read outside the orchestrator that wrote them
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src:See dedup-store.ts for the helper; keys scattered across all orchestrators`
- **Problem:** The orchestrator writes many 'emitted' dedup-tracking keys (e.g., _predictionEmittedKeys, _anomalyEmittedIds, _billDueePredictedIds, _recurringCandidatesEmitted, _staleSubEmittedIds, _morningCheckEmittedDay, _debtAccumulatedDay, _windDownWindowDay, _postureNudgeEmittedBuckets, _hydrationEmittedAt, etc.) exclusively for intra-orchestrator consumption — to track which events have already fired and avoid duplicate emits on every recompute. These keys are private implementation details of dedup logic and should never be read by the UI or external modules. However, they pollute the store namespace and complicate schema audits. Most critically, if an orchestrator is ever disabled or recomputed in isolation, its dedup state becomes stale and orphan events or duplicates may re-fire.
- **Fix:** Move orchestrator-local dedup state into module-scope Maps or WeakMaps within the orchestrator closure, rather than persisting to the store. Keep only high-level OUTPUT keys in the store (e.g., patterns, lastRecomputeAt). If persistence across boot cycles is needed for dedup, use a separate optional storage layer (e.g., @ollie/store with a '_internal' prefix convention) or document the contract clearly. This reduces store clutter and clarifies the store's role: canonical state + UI reads, not orchestrator scratch space.
- **Evidence:** `Lines showing store.set of internal keys: body.ts:195 (_postureNudgeEmittedBuckets), body.ts:273 (_hydrationEmittedAt), cycle.ts:* (_predictionEmittedKeys, _pillMissedEmittedDates), finance.ts:* (10+ keys), goals.ts:*, sleep.ts:* (3+ keys),`

### Cross-module event listeners registered per-init without deduplication guard
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/index.ts:orchestrator/src/index.ts:273–312 (init); also orchestrator/src/dump.ts:99–105 (init with no guard)`
- **Problem:** The root orchestrator calls init() on all 14+ sub-orchestrators, each of which registers event listeners via events.on(). If init() is ever called twice (e.g., during hot-reload in dev, or if an app mistakenly re-boots), every listener will be registered again, creating duplicate handlers. The orchestrator does NOT track or deduplicate listeners; the second init() will silently double-subscribe. This can cause events to be processed twice, state writes to collide, and notifications to fire twice.
- **Fix:** Add a guard in createOrchestrator and each sub-orchestrator: maintain an initialized flag (already done in dump/goals/finance/etc but not enforced uniformly) and return early on second init(). Alternatively, ensure init() is idempotent by unsubscribing-then-resubscribing. Best practice: document the init/teardown contract clearly — init() should be called ONCE, and teardown() is required before a second init().
- **Evidence:** `RootOrchestrator.init() (orchestrator/src/index.ts:273–312) calls cycle.init(), pets.init(), body.init(), ... without checking if they were already initialized. Each sub-orchestrator has unsubs: Unsubscribe[] (e.g., orchestrator/src/dump.ts`

### Fragment.needsConfirm always set by worker but optional in native schema
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/router/schema.ts:91`
- **Problem:** Native schema marks needsConfirm as optional (`needsConfirm?: boolean`), but the worker always sets it to a boolean value (true or false) in every fragment. Handlers check `fragment.needsConfirm === true` safely, but the type contract is loose. If clients assume needsConfirm might be undefined, they could miss the intent. This is a minor safety issue but creates unnecessary ambiguity.
- **Fix:** Change native schema line 91 to `needsConfirm: boolean;` (required) to match the worker's contract. Update any code that checks `needsConfirm !== true` to ensure it's ready for false (low confidence confirmed route).
- **Evidence:** `Native schema line 91: 'needsConfirm?: boolean;' (optional). Worker dump.ts: always sets 'needsConfirm: tiered.needsConfirm' to boolean (never undefined). Module handler check at body/handler.ts line 48: 'fragment.needsConfirm === true' (sa`

### dump-schema.ts copied by hand from native schema, no sync mechanism
- **Dimension:** API Contract Consistency
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts:1-6`
- **Problem:** File header explicitly states 'Kept in sync by hand for now' and promises a future packages/router-schema dedup. This manual sync is error-prone and has already resulted in mismatches (pass2Triggered, CrisisSignal shape, ActionPayload type). No automated CI check enforces consistency between the two schemas, so future changes risk silent divergence.
- **Fix:** Implement the promised packages/router-schema dedup immediately. Create a single source of truth (either in packages/router-schema or a shared @ollie/router-contract) that both worker and native import. Add a CI check (e.g., TypeScript compilation or a lint rule) that fails if the two schema files differ. This prevents future silent drift.
- **Evidence:** `dump-schema.ts header lines 1-6: 'Worker mirror of apps/native/src/router/schema.ts · RouterOutput v1.0. Kept in sync by hand for now. Dedup via packages/router-schema/ later if the schema stabilizes...'`

### APNs push rate-limit does not persist across worker restarts or instances
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts:129-143`
- **Problem:** The rate-limit check uses a time-slot bucketing scheme (Math.floor(now / windowSec)) stored in KV. However, each rate-limit slot is namespaced by user OR device_token, and the KV TTL is set to 2× the window (line 141). If a user rapid-fires push requests from multiple app instances or devices before the slot key expires, the count logic races: each instance reads the count, increments, and writes back independently, potentially allowing more than 5 req/sec if the increment-and-write operations overlap.
- **Fix:** Migrate to a KV-backed atomic counter or use Cloudflare Durable Objects for per-user rate-limit state. Alternatively, accept the loose semantics and add a note documenting that the 5 req/sec cap is approximate under high concurrency (this may be acceptable for push notifications).
- **Evidence:** `Line 135-142: 'const raw = await kv.get(slot); const count = raw ? parseInt(raw, 10) || 0 : 0; if (count >= max) return false; await kv.put(slot, String(count + 1), ...)'. The read-check-write is not atomic, so concurrent requests can both `

### Notification delivery retry path does not guarantee deduplication on APNs re-delivery
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/flush-notifications.ts:221-241`
- **Problem:** When a scheduled_jobs row is retried (status stays 'pending', attempts bumped), the drain re-delivers to APNs with the SAME payload and job.dedupe_key. APNs itself is idempotent on the device_token per request, but there is no transaction semantics across multiple devices. If a job has 2 device tokens and the first push succeeds but the second fails, a retry will re-deliver the notification to the first device again. This could cause duplicate notifications on multi-device users across retries.
- **Fix:** Track per-device delivery state by storing a JSON array of { device_token, delivered: boolean } in a new column (e.g. delivery_log JSONB), OR make the dedupe_key include the device_token hash so each device is independently tracked. At minimum, document that multi-device users may receive duplicate notifications on retry.
- **Evidence:** `Line 223-225: the drain calls Promise.all() on multiple tokens. If one succeeds and another fails, 'anyOk' is true (line 226), marking the job 'sent' (line 231). But a subsequent manual retry via flushNotificationQueue would re-run the same`

### APNs push worker does not verify idempotency on duplicate requests within a window
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/apns-push/src/index.ts:55-125`
- **Problem:** The worker forwards requests to api.push.apple.com but does not deduplicate based on payload or a request ID. If the cron drain sends the same job twice (due to a retry loop or a cron re-execution) before the first request completes, APNs will receive two identical requests. Apple's APNs is idempotent per device_token within a collapses window, but explicit deduplication at the worker level is not implemented.
- **Fix:** Add a dedupe check: compute a hash of (deviceToken, payload) and store it in KV with a short TTL (60s). If a duplicate arrives within the window, return 200 immediately without calling APNs. This prevents duplicate pushes from accidental retries within the same tick.
- **Evidence:** `The worker has no idempotency key generation or request deduplication logic. It directly posts to APNs (line 107-116) with no dedupe check or short-term KV cache of recent (userId, deviceToken, payload_hash) combinations.`

### Drain does not handle enriched_signals FK constraint error distinctly from other failures
- **Dimension:** Idempotency & Retry Harness
- **File:** `/Users/serrayildirim/ollie/workers/cron/src/drain.ts:143-163`
- **Problem:** If the enriched_signals INSERT fails due to a duplicate dump_id (FK constraint), the error is caught generically (line 148-163) and treated as a transient failure. The entry is left in the KV queue for retry, but the retry will hit the SAME FK error forever, causing the entry to accumulate retries and eventually land in the DLQ. This masks the real issue: the enriched row was never inserted because raw_dumps was already written on a prior attempt.
- **Fix:** Catch FK/constraint errors explicitly and move them to a 'poison' DLQ immediately (e.g. `dlq:enrich:poison:${id}`) with the full error message. This signals to ops that the issue is application-level (schema mismatch) not transient, and prevents pointless retries.
- **Evidence:** `Line 148-163: 'catch (err) { ... failed++; const retries = await bumpRetry(env.CACHE_KV, parsed.id); if (retries >= MAX_RETRIES) { ... move to DLQ } }'. The error is not inspected; a FK violation is indistinguishable from a network timeout.`

### partner_snapshots table missing index on updated_at column
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:38-45`
- **Problem:** The partner_snapshots table has an updated_at column but no indexes on it. Given that this is a frequently-updated table (each time a partner pushes their status), queries filtering by or ordering by updated_at will do full table scans. Other similar tables (e.g., plaid_items, encrypted_state, push_tokens) have indexes on their updated_at columns for efficient queries.
- **Fix:** Add an index after the table creation: 'CREATE INDEX partner_snapshots_updated_at ON public.partner_snapshots (updated_at DESC);' to support efficient queries that filter or order by update recency.
- **Evidence:** `CREATE TABLE partner_snapshots (
  user_id text PRIMARY KEY,
  phrases jsonb NOT NULL DEFAULT '[]'::jsonb,
  self_word text,
  crisis boolean NOT NULL DEFAULT false,
  gone_dark boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT N`

### partner_snapshots table missing updated_at trigger
- **Dimension:** DB, Migrations & Schema
- **File:** `/Users/serrayildirim/ollie/supabase/migrations/20260602103016_partner_bilateral_sync.sql:38-55`
- **Problem:** The partner_snapshots table has an updated_at column with a default of now(), but unlike other similar tables (encrypted_state, finance_records, plaid_items, push_tokens), it lacks a BEFORE trigger to ensure updated_at is always set to now() on any INSERT or UPDATE. This means the timestamp won't be automatically refreshed when the worker updates a snapshot, creating stale timestamps.
- **Fix:** Add a trigger function and trigger similar to other tables: 'CREATE OR REPLACE FUNCTION public.partner_snapshots_touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$BEGIN new.updated_at := now(); RETURN new; END;$$; CREATE TRIGGER partner_snapshots_touch BEFORE INSERT OR UPDATE ON public.partner_snapshots FOR EACH ROW EXECUTE FUNCTION public.partner_snapshots_touch_updated_at();'
- **Evidence:** `CREATE TABLE partner_snapshots (
  user_id text PRIMARY KEY,
  phrases jsonb NOT NULL DEFAULT '[]'::jsonb,
  self_word text,
  crisis boolean NOT NULL DEFAULT false,
  gone_dark boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT N`

### Repeated filter+map chains without single-pass aggregation
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/finance/correlate.ts:84-94`
- **Problem:** The correlateFinanceWithCycle function calls entries.filter().map() four times separately (medBy for luteal, follicular, menstrual, ovulation, plus nonLuteal filter). Each call walks the entire entries array. For datasets with 100+ days of transaction history, this causes 5 full passes over the same data when one pass could accumulate all phase buckets in parallel.
- **Fix:** Single-pass accumulation: iterate entries once, building a Map<phase, number[]> of totals keyed by phase. Then call fMedian() once per phase. Reduces O(5N) to O(N+P) where P is phases (4).
- **Evidence:** `'''typescript
const medBy = (ph: string): number => {
  const vs = entries.filter((e) => e.phase === ph).map((e) => e.total);  // line 85 — phase 1
  return vs.length ? (fMedian(vs) ?? 0) : 0;
};
const lutealMed = medBy('luteal');       // `

### Duplicated filter+map over overlap array in sleep correlation
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/finance/correlate.ts:162-163`
- **Problem:** The correlateFinanceWithSleepDebt function filters the overlap array twice: once for lowSleep (debt >= 2) and once for normalSleep (debt < 2). Both scans cover the entire array, duplicating work. These are complementary conditions that partition the same data.
- **Fix:** Single-pass partition: iterate overlap once and push spend values into either lowSleep or normalSleep array. Reduces 2N to N.
- **Evidence:** `'''typescript
const lowSleep = overlap.filter((o) => o.debt >= 2).map((o) => o.spend);  // line 162 — full scan
const normalSleep = overlap.filter((o) => o.debt < 2).map((o) => o.spend);  // line 163 — full scan again'''`

### Serial Voyage embed + cache lookups instead of batched Promise.all
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:260-277`
- **Problem:** In handleRoute (module-agnostic routing), the flow is: voyageEmbed (single call), then cacheLookup (single call), both serial. For single-fragment inputs this is fine, but the /route/dump handler (line 264 in dump.ts) correctly batches embeddings (Promise.all in voyageEmbedBatch) and cache lookups (Promise.all over all embeddings). The /route/:module handler should adopt the same pattern if multi-fragment support is ever added, but currently the serial pattern is acceptable for single-item classification. However, the latency attribution is misleading: latencyMs is recorded BEFORE the cache lookup (line 279), so cache hit latency is not included in the response timing.
- **Fix:** No action required for current single-fragment /route/:module path. If supporting multi-item batch classification in future, apply the Promise.all pattern from /route/dump to parallelize Voyage embed + Vectorize lookups. Current latency attribution is correct (includes embed, starts before cache lookup completes).
- **Evidence:** `'''typescript
// /route/:module handler (lines 260-277 in route.ts)
let embedding: number[];
try {
  embedding = await voyageEmbed(cleanText, env.VOYAGE_API_KEY);  // line 263 — serial
} catch (err) { ... }
let cacheRow: CacheRow | null;
tr`

### GroceryNow display strings are hardcoded in English only
- **Dimension:** i18n Trilingual Coverage (EN/ES/TR)
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/grocery/GroceryNow.tsx:112-115`
- **Problem:** Three key informational strings in the grocery module are English-only, leaving Spanish/Turkish users unable to understand the state of their kitchen tracking.
- **Fix:** Thread AppLang into GroceryNow and localize these three status messages.
- **Evidence:** `Your kitchen is empty. Dump what you bought.
            A few things worth a glance.
            Nothing urgent — here's what's on hand.`

### dump-schema applyConfidencePolicy has single test path
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/dump-schema.ts`
- **Problem:** The applyConfidencePolicy function (lines 67-89) enforces server-side confidence tiers (≥0.80 silent, 0.60-0.79 needsConfirm, <0.60 demote to dump_only). Only one integration test covers it (dump.test.ts); the policy boundaries themselves (0.80, 0.60) are never directly unit-tested. No tests for: (1) confidence exactly at 0.80 and 0.60 thresholds, (2) originalGuess payload shape when demoting, (3) edge cases like negative/NaN confidence.
- **Fix:** Add isolated unit tests: (1) confidence 0.80 → needsConfirm=false, module unchanged, (2) confidence 0.79 → needsConfirm=true, (3) confidence 0.60 → needsConfirm=true, (4) confidence 0.59 → demoted to dump_only with originalGuess preserved, (5) edge: confidence 0, -1, Infinity.
- **Evidence:** `Function at lines 67-89. Test search found only integration-level coverage via dump.test.ts (not directly testing applyConfidencePolicy). The decision comment (line 62) labels this as 'Decision #5 (server-side enforcement)' but no direct te`

### Flaky setTimeout-based async test waits in braindump-dispatch tests
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/tests/braindump-dispatch.test.ts`
- **Problem:** Tests at lines 395, 432, 455 use hard-coded `setTimeout(r, 10)` or `setTimeout(r, 20)` to wait for fire-and-forget async AI calls to settle. These arbitrary delays are fragile and can cause race conditions on slow CI systems. The test at line 372 ('kind=add AI pantry result') depends on fetch mock completion within 10ms—a tight and brittle constraint.
- **Fix:** Replace setTimeout with Promise-based synchronization: (1) track the async call promise in dispatchAction so tests can await it, (2) use a test seam to inject a Promise that resolves when the async task completes, or (3) use vitest fake timers with vi.advanceTimersByTimeAsync() for deterministic control.
- **Evidence:** `Lines 395: 'await new Promise((r) => setTimeout(r, 10));' after dispatchAction with AI route. Line 432: same pattern. Line 455: 20ms wait. These are not deterministic and can flake on CI with high load.`

### lang-detect and transcribe modules have no test coverage
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/lang-detect.ts /Users/serrayildirim/ollie/workers/ai-proxy/src/router/transcribe.ts`
- **Problem:** lang-detect (166 lines) and transcribe (91 lines) are utility modules with no tests. lang-detect's language detection logic (likely Groq-based) is never tested for: (1) accuracy on mixed-language text, (2) edge cases (empty string, single character), (3) fallback behavior. transcribe's audio→text path is never exercised.
- **Fix:** Add tests for lang-detect: (1) English/Turkish/Spanish samples → correct language detected, (2) mixed-language text → language list or primary detected, (3) empty/short input → graceful fallback. For transcribe: (1) valid audio buffer → transcript returned, (2) invalid/corrupted audio → error handled.
- **Evidence:** `No .test.ts file found for either module. lang-detect used in dump.ts routing (implied) but behavior never asserted. transcribe presumably called from routes but no tests.`

### cook-history module untested despite being part of the main flow
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/cook-history.ts`
- **Problem:** cook-history (236 lines) likely handles historical data aggregation for context-aware classification. Zero tests for: (1) history fetching and filtering logic, (2) temporal windowing (how far back is history considered?), (3) empty/missing history graceful fallback.
- **Fix:** Add tests: (1) fetch history succeeds → correctly aggregated and shaped for classifier context, (2) fetch fails → graceful degradation (classification proceeds without history), (3) history is truncated to appropriate time window, (4) de-duplication of historical entries works.
- **Evidence:** `cook-history.ts (236 lines) exists with no test file. Module name suggests historical data cooking but behavior is entirely untested.`

### PII scrubber regex patterns are not unit-tested
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/pii.ts`
- **Problem:** The worker-level PII scrubber (pii.ts) uses a suite of regex patterns (lines 48-77) with documented complex ordering constraints ('URL must run before email/phone'). No unit tests verify: (1) each regex pattern matches/excludes correctly, (2) the order-dependent execution produces the right result, (3) edge cases (URLs with emails, phone numbers in addresses), (4) the hits counter is accurate.
- **Fix:** Add unit tests for each scrubber pattern: (1) URL_REGEX: matches https://example.com, http://sub.example.co.uk/path, rejects non-URLs, (2) EMAIL_REGEX: matches valid emails, rejects non-emails, (3) PHONE_REGEX: matches E.164, US, intl formats, avoids price strings, (4) address/GPS/name patterns, (5) ORDER TEST: a URL containing an email is scrubbed correctly (URL first), (6) hit counts match expected.
- **Evidence:** `Lines 48-77 define regex patterns; lines 80-125+ (implied) implement scrubbing logic. Package version @ollie/pii-scrub has a '100-sample golden test' (line 6) but this worker-level duplicate is untested. Risk: ordering bugs or regex drift f`

### No tests for error path in decrypt/encrypt under edge conditions
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/packages/crypto/tests/crypto.test.ts`
- **Problem:** The crypto test suite is comprehensive (412 lines) but lacks one critical area: what happens when `decryptData` receives a payload with a mismatched PBKDF2 iteration count that was NOT explicitly stored? The S7 migration (lines 186-230) tests explicit iteration counts but not the IMPLICIT fallback when `enc` payload lacks a `kdf_iter` field (which would require reading a legacy packed format).
- **Fix:** Add a test case: (1) legacy payload encrypted with 100k iterations but no kdf_iter field stored (simulating very old data), (2) attempt decrypt with default deriveKey(pass, salt) which uses 600k, (3) verify it correctly fails and the error message guides the caller to use the LEGACY_PBKDF2_ITERATIONS parameter.
- **Evidence:** `Test at lines 188-205 covers explicit iteration counts. The S7 migration comment (line 185) and code at lines 216-222 test the cross-count failure case, but no test for the 'missing kdf_iter field' scenario that would occur with very old pe`

### Mock-only assertion in consent sync tests does not verify actual behavior
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/packages/consent/tests/consent.test.ts`
- **Problem:** Tests at lines 152-162 and 314-320 assert that the `sync` callback is called with the right arguments (expect(sync).toHaveBeenCalledTimes(1); expect(sync.mock.calls[0]?.[1]).toBe('u1')), but do NOT verify that the LOCAL STATE was actually updated. A regression where setConsent fails to update the in-memory cache but still fires the sync callback would pass these tests.
- **Fix:** Add assertions after the sync mock checks that verify the local state was mutated: (1) after setConsent, check that a subsequent getConsent returns the updated value, (2) after sync fires, verify the store itself (via getConsentSync) reflects the change, not just the mock call.
- **Evidence:** `Lines 157-162: 'await setConsent(...);' then only check 'expect(sync).toHaveBeenCalledTimes(1);' and '.mock.calls[0]'. No assertion that getConsent or getConsentSync afterwards returns the new value. Same pattern at lines 317-320.`

### TypeScript version drift across workspace packages
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/apps/native/package.json:42`
- **Problem:** The native app pins TypeScript to ~5.8.3 while all other packages use ^5.6.0, which resolves to 5.9.3. This creates version drift where the native app lags behind by one minor version, potentially causing type compatibility issues or missing type features when the workspace builds together.
- **Fix:** Align native TypeScript version to match the workspace by changing ~5.8.3 to ^5.6.0, allowing it to use the same 5.9.3 version as other packages for consistency.
- **Evidence:** `apps/native/package.json line 42: "typescript": "~5.8.3" vs packages/*/package.json: "typescript": "^5.6.0" (resolved to 5.9.3)`

### React peer dependency version range in @ollie/store allows incompatible versions
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/packages/store/package.json:18`
- **Problem:** The @ollie/store package declares peerDependencies: { "react": ">=18" }, which allows both React 18 and 19. However, devDependencies specify @types/react@^18.3.12, pinning types to React 18. This creates an asymmetry: if a consumer installs React 19 (as native does), the store's React 18 types may not accurately reflect the actual React 19 API, leading to type mismatches.
- **Fix:** Either (a) update @types/react to ^19.0.0 in devDependencies and update peerDependencies to explicitly support both 18 and 19, or (b) narrow peerDependencies to ">=18 <19" if store is intended for React 18 only.
- **Evidence:** `packages/store/package.json lines 17-22: peerDependencies allows >=18 but @types/react is ^18.3.12`

## LOW — 19

### Telemetry endpoints missing per-user rate-limit on /ingest-event
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:315-343`
- **Problem:** The /enrich-dump, /ingest-event, and /label endpoints share a single per-user rate-limit bucket (`rl:telemetry:${userId}`, default 10 req/min per the RATE_MAX constant at line 113). However, /ingest-event can accept arbitrary table writes (retention_events, session_events, module_events, crisis_events, consent_audit — line 49-55), whereas /enrich-dump and /label have well-defined payloads. A malicious user could potentially spam /ingest-event with high-volume writes to module_events while staying within the shared telemetry rate-limit, as the rate-limit is per endpoint pool, not per operation. The telemetry bucket is intentionally shared (line 329-332 comment explains this), but /ingest-event's flexibility vs /enrich-dump's fixed cost creates asymmetry.
- **Fix:** Consider either: (a) separate rate-limit buckets for /ingest-event so user/telementry writes don't compete with labeling and enrichment, or (b) add a per-table write quota inside handleIngestEvent to bound high-cardinality tables (module_events, session_events). Option (a) is simpler: change `rl:telemetry:${userId}` to `rl:ingest:${userId}` in the /ingest-event branch only. No production risk — this is a defense-in-depth improvement, not a correctness fix.
- **Evidence:** `Lines 328-335 of index.ts:
'''typescript
const allowed = await checkRate(
  env.TELEM_RATE_LIMITER,
  env.RATE_KV,
  'rl:telemetry:${userId}',
);
if (!allowed) {
  return withCors(json({ error: 'rate_limited' }, 429));
}
'''

All three endp`

### CORS policy permits any origin but auth checks mitigate exposure
- **Dimension:** Security & Authorization
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/index.ts:124-131`
- **Problem:** All endpoints return `Access-Control-Allow-Origin: *`, which allows any website to make cross-origin requests to the worker. This is intentional (lines 117-122 explain that all endpoints require Authorization or x-user-id headers, which trigger preflight), but it means an attacker's website can attempt requests. The mitigation is strong — all sensitive endpoints require JWT or shared secrets — but the wide CORS policy + permissive HTTP headers (no Referrer-Policy, no X-Content-Type-Options) create a larger attack surface for auth-bypass attempts. A confused-deputy attack (e.g., exploiting a browser bug in JWT handling) would affect all users simultaneously.
- **Fix:** No immediate change required since auth checks are strong. For defense-in-depth: (a) consider restricting CORS to the known client origins (ollie.app, platform.ollie.app) once they stabilize; (b) add security headers to the CORS response (e.g., `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`). This is a nice-to-have, not a blocker.
- **Evidence:** `Lines 124-131 of index.ts:
'''typescript
function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Cont`

### Real API keys stored in gitignored .env.local and .env files
- **Dimension:** Secrets & Token Exposure
- **File:** `/Users/serrayildirim/ollie/.env.local:8,13`
- **Problem:** Production/dev API keys for Sentry (DSN), Supabase (anon key), and worker URLs are stored in .env.local. While these files are properly gitignored and never committed, they represent a local machine compromise risk if developer credentials are stolen.
- **Fix:** Continue using .gitignore for these files (already correctly configured). Consider documenting in CONTRIBUTING.md or onboarding guide that devs should treat .env files as sensitive and not share them. No change to codebase needed.
- **Evidence:** `VITE_SENTRY_DSN=https://[REDACTED_SENTRY_DSN]@o4511388392292352.ingest.us.sentry.io/4511388465889281
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlreHpmemtmc29sd2dtaGVpd3B4Iiwicm9sZSI6I`

### Real API keys in .env and .dev.vars local files
- **Dimension:** Secrets & Token Exposure
- **File:** `/Users/serrayildirim/ollie/.env and /Users/serrayildirim/ollie/workers/ai-proxy/.dev.vars:4,5 and line 1`
- **Problem:** Real Voyage AI and Gemini API keys are present in .env for local development (used by router build scripts). Real Groq API key is in workers/ai-proxy/.dev.vars for Wrangler local development. Both files are properly gitignored, but represent developer machine compromise risk.
- **Fix:** These keys should be rotated if developer machines are known to be compromised. Consider documenting in worker README files how to regenerate these keys (e.g., 'Generate via https://console.groq.com → API Keys'). The .gitignore protection is correct; no code change needed.
- **Evidence:** `VOYAGE_API_KEY=[REDACTED_VOYAGE_KEY]
GEMINI_API_KEY=<REDACTED — key rotated>
GROQ_API_KEY=[REDACTED_GROQ_KEY]`

### Unvalidated excludeDishes array size in /feed-me endpoint
- **Dimension:** Input Validation
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/feed-me.ts:457-466`
- **Problem:** The excludeDishes array in /feed-me is filtered for length but no maximum array size is enforced. A client can send { excludeDishes: [<1000 items>] } which will be included in the prompt context. While the individual item length is capped at PANTRY_MAX_ITEM_LEN (100 chars), the total array size could inflate the prompt and waste tokens if a large excludeDishes is passed.
- **Fix:** Add a maximum array length check: e.g., if (b.excludeDishes.length > 50) return { error: 'exclude_dishes_too_large' }. Choose a reasonable limit based on typical use cases (5-20 items is more realistic than 1000+).
- **Evidence:** `// excludeDishes (optional)
  const excludeDishes: string[] = [];
  if (b.excludeDishes !== undefined) {
    if (!Array.isArray(b.excludeDishes)) return { error: 'invalid_exclude_dishes' };
    for (const d of b.excludeDishes) {
      if (t`

### Large monolithic index files in orchestrator and notifications
- **Dimension:** File & Module Structure
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/index.ts:1-341`
- **Problem:** @ollie/orchestrator's index.ts is 341 lines and re-exports 40+ items from 15+ sub-modules (index, cycle, pets, body, grocery, sleep, finance, patterns, admin, dump, habits, work, goals, burhan, medication, orphan-cue-bridge, research, body-weekly, body-correlations, body-signals, matter-routing, cadence-scanner). This is a large barrel file that mixes types, functions, and interfaces in a way that makes tree-shaking difficult and the public API boundary unclear.
- **Fix:** Consider splitting the orchestrator's index.ts into logical sub-exports (e.g., orchestrator/cycle, orchestrator/patterns, orchestrator/research) matching the sub-modules, or add an exports field to limit the barrel to a smaller public surface.
- **Evidence:** `Lines 39-144 contain 100+ export statements re-exporting from sub-modules. Similarly, @ollie/notifications/src/index.ts is 485 lines. These large barrels complicate dead-code elimination and make it hard to know what is truly public vs. int`

### apps/native imports from @ollie/orchestrator sub-modules for types
- **Dimension:** File & Module Structure
- **File:** `/Users/serrayildirim/ollie/apps/native/src/modules/sleep/index.ts:N/A`
- **Problem:** The native app imports CadenceTrackedEntry types from @ollie/orchestrator in multiple module files. While these are type-only imports, they depend on orchestrator's implementation details (cadence-scanner.ts) rather than a stable, explicit public API. If orchestrator's internal structure changes, these imports could break.
- **Fix:** Either (1) add CadenceTrackedEntry and related types to orchestrator's public API (package.json exports), or (2) move the type definition to @ollie/orchestrator root and re-export it there. This ensures the type is stable across version changes.
- **Evidence:** `grep results show apps/native/src/modules/{cycle,sleep,pets,body,goals,admin,habits,work,finance,medication}/index.ts all import 'type { CadenceTrackedEntry } from '@ollie/orchestrator'. This type is defined in orchestrator/src/cadence-scan`

### Missing return type annotation on exported arrow function
- **Dimension:** TypeScript Type Safety
- **File:** `/Users/serrayildirim/ollie/apps/native/src/api/supabase.ts:62`
- **Problem:** The exported supabase constant uses an IIFE arrow function with explicit type annotation on the export, but the function body itself has no return type. While the export type is correct, the function's internal return is not explicitly annotated, making it slightly harder to verify the Proxy construction matches the SupabaseClient type.
- **Fix:** Add explicit return type to the IIFE: `(() => SupabaseClient): SupabaseClient => { ... }`
- **Evidence:** `export const supabase: SupabaseClient = (() => {
  return new Proxy({} as SupabaseClient, {`

### Unhandled promise in systemNotify scheduleAt can orphan timers
- **Dimension:** Async & Concurrency
- **File:** `/Users/serrayildirim/ollie/apps/native/src/notify/systemNotify.ts:275-298`
- **Problem:** The scheduleAt() function starts an async branch at line 275 to load the plugin and schedule with the OS. This async work completes after the handle is returned. If the async branch throws (import fails, invoke fails), the error is caught and logged, but the fallback timer is armed. However, there's a race: if cancel() is called before the async branch completes, the cancel() call could clear timerId (line 303) while the async branch is still running, then the async branch sets nativeScheduled=true. If cancel() runs after the async branch sets nativeScheduled but before reading the flag in cancel(), cancel() tries to invoke() the cancellation but timerId is already cleared, creating confusion about which path owns the cancellation.
- **Fix:** Use a promise-based coordination instead of flags. Store the pending native scheduling promise and cancel it if cancel() is called before it resolves. Or ensure a mutex guards both the async work and the cancel() logic.
- **Evidence:** `Lines 275-298: The async loadNotificationPlugin().then() sets nativeScheduled asynchronously. Lines 300-314: The cancel() function reads nativeScheduled synchronously. A race exists between setting nativeScheduled (line 291) and checking it`

### Finance orchestrator uses hardcoded threshold values scattered across the function
- **Dimension:** Clean Code & Complexity
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:96-100, 436, 628, 708, 746, 747`
- **Problem:** Magic numbers appear throughout recomputeDerived without clear labeling: 72-hour cooldown (line 436), 30-day savings milestone window, various date calculations. While some are defined as const (DEBOUNCE_MS, MAX_DUMP_LEN), others are inlined. This makes tuning thresholds difficult and inconsistent.
- **Fix:** Consolidate all configurable thresholds into a FinanceThresholds config object at the top of the module: const FINANCE_THRESHOLDS = { cooldownMs: 72 * 3600 * 1000, savingsPercentMilestones: [25, 50, 75, 100], ... }. Pass this via the orchestrator options so tests can inject custom values.
- **Evidence:** `const DEBOUNCE_MS = 500;
const MAX_DUMP_LEN = 4000;
const SAVINGS_LEDGER_CAP = 200;
// ...
const COOLDOWN_MS = 72 * 60 * 60 * 1000; // line 436
// ...
if (dayOfMonth === 1) { // line 708 — hardcoded day check
const THRESHOLDS = [25, 50, 75,`

### No dedicated linting CI gate; lint runs but failures may not block PRs
- **Dimension:** Linting & Config Hygiene
- **File:** `/Users/serrayildirim/ollie/.github/workflows/ci.yml:36`
- **Problem:** The CI workflow runs `pnpm lint` as part of the build job but does not have a separate linting-specific job or explicit pass/fail gate. If lint warnings are configured as errors in eslint.config.mjs, this is adequate; however, best practice is to call out linting as an explicit CI gate for visibility.
- **Fix:** Consider adding a separate CI job named 'lint' (alongside 'build') that runs `pnpm lint` and uploads lint results as an artifact for visibility in PR reviews. Alternatively, ensure the root eslint.config.mjs clearly marks all linting rules as 'error' rather than 'warn' where appropriate.
- **Evidence:** `ci.yml runs 'pnpm lint' on line 36 alongside typecheck and test, with no dedicated lint job or artifact capture`

### Deferability override in scoreNoticing can receive out-of-range values from learned resolver
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/logic/src/brain/select.ts:193-203`
- **Problem:** The resolvedDeferability function clamps learned values to [0, 1] using Math.max(0, Math.min(1, learned)). However, the comment in scoreNoticing (line 261) and the urgencyWeight calculation assume deferability is always in [0, 1]. If a future learned-map resolver returns NaN or infinite values before the clamp is applied, or if the clamp logic is accidentally removed, the scoring will produce invalid urgency weights and scores. This is not an immediate bug but a fragility for Sprint 4's learned-map feature.
- **Fix:** Add a type assertion or runtime assertion that resolvers respect the [0,1] range. Consider: export type DeferabilityResolver = (c, cs) => 0 | 0.5 | 1; (enum-like) or add a comment 'MUST return a number in [0, 1] or null/undefined'.
- **Evidence:** `if (typeof learned === 'number' && Number.isFinite(learned)) { return Math.max(0, Math.min(1, learned)); }  // Only clamps finite numbers; the resolver contract isn't enforced at type level`

### Cadence nextExpectedTs computed even when confidence is low-data; can show spurious dates
- **Dimension:** Algorithms Correctness & Efficiency
- **File:** `/Users/serrayildirim/ollie/packages/cadence/src/index.ts:147`
- **Problem:** When cadence confidence is 'low-data' (sampleSize < 2 or gaps.length === 0), the function returns medianIntervalMs=0 and nextExpectedTs=null, which is correct. However, when transitioning to 'low-data' via CV demotion (line 135-138), the nextExpectedTs is still computed as lastTs + medianIntervalMs. If CV is > 1.2 but sampleSize >= 2, the function sets confidence='low-data' but still returns a nextExpectedTs based on the (unreliable) median. This can lead to overdue calculations showing false 'overdue' for highly irregular patterns.
- **Fix:** Return nextExpectedTs=null when confidence='low-data', even if medianIntervalMs is non-zero. Example: nextExpectedTs: confidence === 'low-data' ? null : (lastTs + medianIntervalMs),
- **Evidence:** `line 130-141: if (tss.length >= STABLE_MIN_SAMPLES && cv <= STABLE_CV_THRESHOLD) confidence='stable'; else if (cv > STABLE_CV_THRESHOLD * 2) confidence='low-data'; else confidence='observed'; [then] nextExpectedTs: lastTs + medianIntervalMs`

### Store keys written by finance.ts but no explicit read by finance.goals path in UI
- **Dimension:** State & Store Consistency
- **File:** `/Users/serrayildirim/ollie/packages/orchestrator/src/finance.ts:orchestrator/src/finance.ts:1081; apps/native/src/modules/finance/bridge.ts (missing goals sync)`
- **Problem:** The finance orchestrator writes finance.goals (line 1081) to track savings goal progress. The key IS read internally (line 664, 1064) for dedup and goal advancement. However, unlike other derived keys (patterns, recurring, anomalies), there is no explicit UI component documented to read and render finance.goals. The native app modules/finance/bridge.ts does not mirror this key from SQLite, so on native the key will always be empty — the saving-goal feature will fail silently.
- **Fix:** Either (1) add finance.goals mirroring to apps/native/src/modules/finance/bridge.ts by querying the savings goals table, or (2) document that finance.goals is web-only. If it's a feature gap, prioritize fixing the native bridge. Currently there is no sync from SQLite → store for this key.
- **Evidence:** `store.set('finance', 'goals', nextGoals) at orchestrator/src/finance.ts:1081 has no corresponding native bridge write. The finance bridge (apps/native/src/modules/finance/bridge.ts) mirrors records, cancellations, and settings but not goals`

### Unnecessary AI cascade calls for modules without tiering
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/route.ts:143-189`
- **Problem:** The MODULE_TIERS registry (lines 148-189) defines confidence-based escalation for 10 modules (admin, body, cycle, finance, goals, habits, medication, pets, sleep, work), but 'grocery' is deliberately excluded. The comment at lines 140-142 states 'Modules without an entry use the default GROQ_MODEL single-call path'. This means grocery always does one Groq call, while other modules may do two (fast model → accurate if confidence < threshold). This is a design choice for consistency with cached grocery rows, but creates a performance divergence: grocery is cheaper but other modules pay for tier escalation on ~30% of misses.
- **Fix:** Document the design choice in code: add a comment above MODULE_TIERS explaining why grocery is excluded (for cache consistency) and the cost implication. This is not a bug but a deliberate tradeoff that should be explicit for future maintainers.
- **Evidence:** `'''typescript
const MODULE_TIERS: Record<string, TierConfig> = {
  admin: { models: [...], threshold: ... },
  // ... 9 more modules ...
  work: { models: [...], threshold: ... },
  // grocery is NOT in this map — line 148-189 shows explici`

### Oversized LLM prompts in pass-2 segmentation maxTokens
- **Dimension:** Performance & Cost
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/src/router/segmentation-llm.ts:34-39`
- **Problem:** The pass2Split function sets maxTokens to 1024 (line 39) to prevent truncation-induced JSON validation failures. The comment explains this was increased from 512 because long verbatim fragment dumps can exceed output limits. However, this increases inference cost on Groq/Gemini/OpenRouter per invocation. The problem statement (Decision A trigger ~30% of dumps) means ~30% of all dumps fire pass-2 with a 1024-token budget, which is higher than necessary for typical multi-topic dumps that split into 3-5 fragments.
- **Fix:** Optional: profile typical pass-2 output token usage. If most fall well below 1024, reduce to 768 (covers ~99th percentile of realistic multi-fragment splits). Saves ~25% inference cost on pass-2 calls. Requires A/B testing to confirm no truncation regression.
- **Evidence:** `'''typescript
// Line 34-39 in segmentation-llm.ts:
export async function pass2Split(text: string, providers: JsonProviders): Promise<string[]> {
  // maxTokens 1024 (was 512): a long run-on dump split into many verbatim
  // fragments can `

### dump-coverage.live tests are gated by environment but CI may not run them
- **Dimension:** Test Quality & Coverage
- **File:** `/Users/serrayildirim/ollie/workers/ai-proxy/tests/dump-coverage.live.test.ts`
- **Problem:** The LIVE Groq classifier regression tests (dump-coverage.live.test.ts) are only executed when DUMP_COVERAGE_LIVE=1 is set. The comment at line 2-7 explains the rationale but this means the live classifier behavior is tested manually/on-demand, not in CI. The 95%+ pass threshold (line 19) is a quality bar but no automated gate prevents regression.
- **Fix:** Document the manual LIVE test in the CI/CD pipeline documentation. Consider a pre-ship checklist item to run the live test. Alternatively, enable it in CI on main branch (after every merge) with a relaxed SLA for external rate limits (e.g., retry 429 aggressively).
- **Evidence:** `describe.skipIf(!LIVE) at line 35 gates the entire test suite. Instructions to run manually (lines 9-12) suggest this is not part of standard CI. Cost estimate ($3-5 per run, line 14) makes sense for manual runs but may have been skipped du`

### Missing @types/react-dom in @ollie/store despite React hook exports
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/packages/store/package.json:20-25`
- **Problem:** The @ollie/store package exports a ./react entry point that uses React hooks (useState, useEffect from 'react'), which are typed from React and React-DOM. However, only @types/react is declared in devDependencies, not @types/react-dom. While this works because react-dom is auto-installed as a peer via pnpm's autoInstallPeers setting, it's not explicitly declared, which could fail in stricter environments.
- **Fix:** Add @types/react-dom to the devDependencies of @ollie/store to explicitly declare the type dependency, improving clarity and reducing reliance on implicit peer resolution.
- **Evidence:** `packages/store/src/react.ts line 13: imports useState/useEffect from 'react', but packages/store/package.json has no @types/react-dom`

### Version specification for Cloudflare Workers Types exceeds current date
- **Dimension:** Dependency Health
- **File:** `/Users/serrayildirim/ollie/packages/apns-jwt/package.json:17`
- **Problem:** Multiple packages specify @cloudflare/workers-types@^4.20250906.0 (September 6, 2025), but the lock file resolves to 4.20260510.1 (May 10, 2026). While this is acceptable given the current date is 2026-06-09, it suggests the spec was pinned to a past date and should be updated to reflect the present.
- **Fix:** Update the @cloudflare/workers-types specifier to ^4.20260510.0 or later to match the resolved version and reflect current date.
- **Evidence:** `packages/apns-jwt/package.json line 17 and multiple worker packages: specifier ^4.20250906.0, resolved 4.20260510.1`

