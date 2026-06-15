/**
 * /route/dump — brain-dump router (the universal app entry point).
 *
 * Pipeline (per the 10 locked decisions):
 *   1. Clerk JWT verify (Decision 6). userId is required — it namespaces
 *      Vectorize entries and research_corpus rows.
 *   2. Pass-1 segmentation: Intl.Segmenter sentence + trilingual
 *      conjunction overlay (Decision 5/B).
 *   3. Pass-2 segmentation (Decision A trigger): Groq Llama 3.3 70B
 *      with JSON mode (Decision C) for fragments that look weakly
 *      punctuated or code-switched. Pass-2 output is NEVER cached.
 *   4. Per-fragment language detect (Decision 4). 'mixed' is valid.
 *   5. Crisis classification IN PARALLEL with routing (Decision 9). All
 *      three lexicons regardless of dominant language. If any fragment
 *      hits the lexicon at tier ≥ 2, the response carries `crisis` and
 *      the client surfaces the crisis screen.
 *   6. For each fragment:
 *        a. Voyage multilingual-2 embed (1024-dim).
 *        b. Vectorize cache lookup (per-user namespace).
 *        c. HIT → return cached classification (no AI call).
 *        d. MISS → Groq classify (JSON mode, no try/catch parse).
 *        e. Apply 3-tier confidence policy (Decision 2): demote
 *           <0.60 to dump_only, mark 0.60-0.79 needsConfirm.
 *        f. Fire-and-forget cache write.
 *   7. Build RouterOutput with summary telemetry.
 *
 * Cost guardrails:
 *   - Voyage embed: ~$0.00002/fragment
 *   - Groq Llama 3.3 70B classification: free tier 14.4k req/day (cache miss only)
 *   - Pass-2 segmentation: triggered on ~30% of dumps per Decision A cost note
 *
 * NEVER cached: raw fragment text, pass-2 segmentation output.
 */

import { json, upstreamError } from '@ollie/worker-http';
import { detectCrisis } from '@ollie/crisis-lexicon';
import { verifyClerkJwt } from '../clerk-verify';
import { scrubPII } from '../pii';
import { pass1Segment } from './segmentation';
import { pass2Split } from './segmentation-llm';
import { detectFragmentLanguage } from './lang-detect';
import { classifyBatch, type ClassifyResult } from './dump-classify';
import { injectScheduledAt } from './remindIn';
import { writeInbox } from './server-apply';
import {
  type Fragment,
  type FragmentLanguage,
  type Module,
  type RouterOutput,
  applyConfidencePolicy,
} from './dump-schema';
import {
  cacheHitBump,
  cacheLookup,
  cacheUpsert,
  type VectorizeIndex,
} from './vectorize';
import { base64ByteSize, isVisionImage, visionExtract, type VisionImage } from './vision';
import type { CfAiBinding } from '../cloudflare-ai';

/** Hard upper bound on the raw image/pdf bytes the worker accepts.
 *  Frontend resizes images to ~700KB; PDFs aren't resized and routinely
 *  hit the multi-MB range. Cap chosen to fit a multi-page receipt PDF
 *  or scanned form while still bounding worker memory + Gemini upload. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Upper bound on a single dump's typed text (audit #47). A brain dump is short
 *  by nature; 10k chars is far above any real dump but blocks an abusive payload
 *  from reaching the segmenter / embedder / AI cascade. */
const MAX_TEXT_CHARS = 10_000;

const VOYAGE_MODEL = 'voyage-multilingual-2';
const VOYAGE_EMBED_DIM = 1024;

export interface DumpRouteEnv {
  VOYAGE_API_KEY: string;
  GROQ_API_KEY: string;
  /** Used when the request carries an `image` field. Already declared as a
   *  worker-wide secret (same one FeedMe uses). Missing/empty value with
   *  image present → 503 upstream-unavailable. Text-only dumps ignore it. */
  GEMINI_API_KEY: string;
  /** OpenRouter API key — final classify-cascade fallback (optional). */
  OPENROUTER_API_KEY?: string;
  /** Required at runtime for /route/dump; declared optional here so it
   *  remains compatible with the broader Env shape (InvitesEnv keeps it
   *  optional during Clerk migration). The handler returns 503 if missing. */
  CLERK_ISSUER?: string;
  /** Staging-only side door for golden-test harness. When set, a request
   *  with `Authorization: Bearer <STAGING_TEST_BEARER>` bypasses Clerk JWT
   *  verify and runs as the fixed userId `staging-test-user`. The secret
   *  exists ONLY on `ollie-ai-proxy-staging`; prod never has it set, so
   *  the branch is unreachable on prod. */
  STAGING_TEST_BEARER?: string;
  VECTORIZE_INDEX: VectorizeIndex;
  /** Cloudflare Workers AI binding — same-platform classify fallback (no key).
   *  Optional so the worker still boots if the binding is absent. */
  AI?: CfAiBinding;
  /** A6b server-apply (dump_inbox). */
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE?: string;
  ENVELOPE_KEK?: string;
  SERVER_APPLY_ENABLED?: string;
}

const STAGING_TEST_USER_ID = 'staging-test-user';

export async function handleDumpRoute(
  req: Request,
  env: DumpRouteEnv,
  ctx?: ExecutionContext,
): Promise<Response> {
  // Keep background cache writes alive past the Response. Without ctx.waitUntil
  // the Workers runtime cancels any promise still pending when fetch() returns,
  // which silently dropped the Vectorize cache writes that make repeat dumps
  // fast + cheap (dogfood B5, 2026-06-05). Falls back to plain fire-and-forget
  // when no ctx is threaded (unit tests) — harmless there since nothing cancels.
  const keepAlive = (p: Promise<unknown>): void => {
    if (ctx?.waitUntil) ctx.waitUntil(p);
    else void p;
  };
  const t0 = Date.now();

  // 1. Clerk JWT (required for /route/dump per Decision 6).
  if (!env.CLERK_ISSUER) {
    return json({ error: 'clerk_issuer_unset' }, 503);
  }
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return json({ error: 'unauthorized' }, 401);
  }
  const bearer = auth.slice('Bearer '.length);

  let userId: string | null;
  if (env.STAGING_TEST_BEARER && bearer === env.STAGING_TEST_BEARER) {
    userId = STAGING_TEST_USER_ID;
  } else {
    userId = await verifyClerkJwt(bearer, { CLERK_ISSUER: env.CLERK_ISSUER });
  }
  if (!userId) {
    return json({ error: 'invalid_jwt' }, 401);
  }

  // Parse body
  let body: {
    text?: string;
    dumpId?: string;
    locale?: string;
    image?: VisionImage;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (!body) {
    return json({ error: 'bad_json' }, 400);
  }

  const userText = typeof body.text === 'string' ? body.text.trim() : '';
  const hasImage = body.image !== undefined;

  if (hasImage && !isVisionImage(body.image)) {
    return json({ error: 'bad_image' }, 400);
  }

  if (!userText && !hasImage) {
    return json({ error: 'missing_text' }, 400);
  }

  if (userText.length > MAX_TEXT_CHARS) {
    return json({ error: 'text_too_large' }, 413);
  }

  if (hasImage && base64ByteSize((body.image as VisionImage).data) > MAX_IMAGE_BYTES) {
    return json({ error: 'image_too_large' }, 413);
  }

  // Vision pre-pass — if image present, ask Gemini Flash 2.5 to describe
  // what's in it. The description is prepended to the user's text dump
  // (if any) and the combined string flows through Layer 1 + Layer 2.
  let visionUsed = false;
  let visionDescription = '';
  if (hasImage) {
    if (!env.GEMINI_API_KEY) {
      return json({ error: 'gemini_key_unset' }, 503);
    }
    try {
      const extract = await visionExtract(body.image as VisionImage, env.GEMINI_API_KEY);
      visionDescription = extract.text;
      visionUsed = true;
    } catch (err) {
      return upstreamError('vision_failed', 502, err, { dumpId: body.dumpId });
    }
  }

  const combinedDump = visionDescription
    ? userText
      ? `[image: ${visionDescription} ]\n\n${userText}`
      : `[image: ${visionDescription} ]`
    : userText;

  const dumpId = body.dumpId ?? crypto.randomUUID();
  const locale = body.locale ?? 'tr';

  // PII scrub once on the whole dump; preserves segmentation faithfulness.
  const { scrubbed: cleanDump } = scrubPII(combinedDump);

  // 2 + 3. Segmentation (pass-1 + pass-2 for flagged fragments).
  const pass1 = pass1Segment(cleanDump, locale);
  const fragmentsText: string[] = [];
  let pass2Triggered = 0;

  for (const frag of pass1.fragments) {
    if (frag.needsPass2) {
      pass2Triggered++;
      try {
        const split = await pass2Split(frag.text, {
          groq: env.GROQ_API_KEY,
          gemini: env.GEMINI_API_KEY,
          cfAI: env.AI,
          openrouter: env.OPENROUTER_API_KEY,
        });
        if (split.length > 0) {
          fragmentsText.push(...split);
          continue;
        }
      } catch (err) {
        // Pass-2 failure: fall back to the pass-1 fragment unsplit.
        console.error('[route/dump] pass2 failed, using pass1 fragment', err);
      }
    }
    fragmentsText.push(frag.text);
  }

  // 5. Crisis check — all 3 lexicons against the WHOLE dump in parallel.
  // (Per fragment also acceptable; the lexicon library does the right
  // thing either way, but checking the whole dump avoids missing signals
  // that span a fragment boundary like "I want to" + "die tonight".)
  // Crisis detection runs over the combined dump so a photo of a note
  // ("kendime zarar vermek istiyorum" scrawled on paper) still triggers
  // the upstream lexicon path even with no typed text.
  const crisis = detectCrisis(combinedDump) ?? undefined;

  // Crisis short-circuit (product decision 2026-06-15). When the lexicon flags
  // a crisis phrase we deliberately keep NOTHING: no classification, no Voyage
  // embed, no Vectorize cache write, no telemetry log of the raw text, and no
  // server-apply inbox row. Ollie is not a crisis tool — it responds gently
  // (soft client banner) and stores none of the input anywhere. We return only
  // the crisis signal with an empty originalDump so the text isn't even echoed
  // back in the response. This MUST stay above the embed/classify/cache/log/
  // writeInbox path below.
  if (crisis) {
    return json({
      schemaVersion: '1.0',
      originalDump: '',
      dumpId,
      timestamp: Date.now(),
      language: detectFragmentLanguage(combinedDump),
      crisis,
      fragments: [],
      summary: {
        moduleCount: {},
        cacheHitRate: 0,
        aiCalls: 0,
        durationMs: Date.now() - t0,
        pass2Triggered: 0,
      },
    } satisfies RouterOutput);
  }

  // 6. Per-fragment classification.
  //    Pass A: embed + Vectorize cache lookup for every fragment.
  //    Pass B: ONE batched Groq classify for all cache misses — the ~4k-token
  //    classifier prompt is sent once per dump rather than once per fragment,
  //    which keeps multi-fragment dumps under Groq's free-tier 8k tokens/min
  //    rate limit (a 3-fragment dump drops from ~12k tokens to ~4.5k).
  const slots: Array<Fragment | null> = new Array(fragmentsText.length).fill(null);
  let aiCalls = 0;
  let cacheHits = 0;

  interface Miss {
    index: number;
    text: string;
    language: FragmentLanguage;
    embedding: number[];
  }
  const misses: Miss[] = [];

  // ── Pass A — batch embed + parallel cache lookup ──
  // Fragments are independent, so instead of N serial round-trips we (1) embed
  // every fragment in ONE Voyage call and (2) fan the Vectorize lookups out
  // with Promise.all. A multi-fragment dump's Pass-A latency drops from O(N)
  // round-trips to O(1) — the user-visible "sort out" delay on long dumps.
  const uid = userId; // non-null past the 401 guard; pin as const for the closures
  const languages = fragmentsText.map((t) => detectFragmentLanguage(t));

  let embeddings: number[][] = [];
  if (fragmentsText.length > 0) {
    try {
      embeddings = await voyageEmbedBatch(fragmentsText, env.VOYAGE_API_KEY);
    } catch (err) {
      return upstreamError('voyage_embed_failed', 502, err, { dumpId });
    }
  }

  const cacheRows = await Promise.all(
    embeddings.map((embedding) =>
      cacheLookup(env.VECTORIZE_INDEX, uid, embedding).catch((err) => {
        console.error('[route/dump] vectorize lookup failed, miss-through', err);
        return null as Awaited<ReturnType<typeof cacheLookup>>;
      }),
    ),
  );

  for (let i = 0; i < fragmentsText.length; i++) {
    const text = fragmentsText[i];
    const language = languages[i];
    const embedding = embeddings[i];
    const cacheRow = cacheRows[i];

    if (cacheRow) {
      cacheHits++;
      const tiered = applyConfidencePolicy(cacheRow.module, cacheRow.payload, cacheRow.confidence);
      // remindIn always re-anchors against the CURRENT clock — even on a cache
      // hit. "remind me in 1 minute" said now must fire 60s from now, never
      // 60s from when the cache row was first written.
      const reminderStatus = injectScheduledAt(tiered.payload, Date.now());
      if (reminderStatus.status === 'dropped') {
        console.warn(
          '[route/dump] remindIn dropped (cache)',
          JSON.stringify({ reason: reminderStatus.reason, dumpId, fragment: i }),
        );
      }
      slots[i] = {
        text,
        language,
        module: tiered.module,
        payload: tiered.payload,
        confidence: cacheRow.confidence,
        needsConfirm: tiered.needsConfirm,
        source: 'cache',
      };
      // Bump hit count asynchronously (survives past the Response via waitUntil).
      keepAlive(
        cacheHitBump(env.VECTORIZE_INDEX, cacheRow, userId, embedding).catch((e) =>
          console.error('[route/dump] cache bump failed', e),
        ),
      );
      continue;
    }

    misses.push({ index: i, text, language, embedding });
  }

  // ── Pass B — single batched Groq classify for all misses ──
  if (misses.length > 0) {
    aiCalls = 1; // one upstream call regardless of how many fragments missed
    let results: ClassifyResult[];
    try {
      results = await classifyBatch(
        misses.map((m) => ({ text: m.text, language: m.language })),
        { groq: env.GROQ_API_KEY, gemini: env.GEMINI_API_KEY, cfAI: env.AI, openrouter: env.OPENROUTER_API_KEY },
      );
    } catch (err) {
      // Both providers busy: Groq 429 (rate) AND Gemini fallback 429/503
      // (rate / model-overloaded). Recoverable, not a real failure — surface
      // it softly (client shows "going too fast, your words are saved" and
      // keeps the draft) instead of an alarming 502.
      const status = (err as { status?: number })?.status;
      if (status === 429 || status === 503) {
        return json({ error: 'rate_limited' }, 429);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return upstreamError('groq_classify_failed', 502, msg, { dumpId });
    }

    for (let j = 0; j < misses.length; j++) {
      const m = misses[j];
      const result = results[j];
      const tiered = applyConfidencePolicy(result.module, result.payload, result.confidence);
      // Resolve remindIn → scheduledAtMs against the current clock BEFORE the
      // cache upsert below so the cached entry carries the canonical hint
      // shape (handlers always see scheduledAtMs already injected on re-hits).
      const reminderStatus = injectScheduledAt(tiered.payload, Date.now());
      if (reminderStatus.status === 'dropped') {
        console.warn(
          '[route/dump] remindIn dropped (ai)',
          JSON.stringify({ reason: reminderStatus.reason, dumpId, fragment: m.index }),
        );
      }
      slots[m.index] = {
        text: m.text,
        language: m.language,
        module: tiered.module,
        payload: tiered.payload,
        confidence: result.confidence,
        needsConfirm: tiered.needsConfirm,
        source: 'ai',
      };

      // Background cache write — never blocks the response, but kept alive past
      // it via waitUntil so the runtime doesn't cancel the Vectorize write.
      keepAlive(
        cacheUpsert(env.VECTORIZE_INDEX, {
          userId,
          text: m.text,
          embedding: m.embedding,
          module: tiered.module,
          payload: tiered.payload,
          confidence: result.confidence,
          language: m.language,
        }).catch((e) => console.error('[route/dump] cache upsert failed', e)),
      );
    }
  }

  // Every slot is now filled (cache hit or AI); compact to a dense array.
  const fragments: Fragment[] = slots.filter((f): f is Fragment => f !== null);

  const durationMs = Date.now() - t0;
  const moduleCount: Partial<Record<Module, number>> = {};
  for (const f of fragments) {
    moduleCount[f.module] = (moduleCount[f.module] ?? 0) + 1;
  }

  // Telemetry log carries STRUCTURE ONLY, never user content (audit #44). The
  // previous version logged combinedDump.slice(0,120) + each fragment's text,
  // which dropped unscrubbed PII into Worker logs. We log lengths/shape instead.
  console.log(
    '[route/dump]',
    JSON.stringify({
      inputLen: combinedDump.length,
      visionUsed,
      fragments: fragments.map((f) => ({
        textLen: f.text.length,
        module: f.module,
        action: (f.payload as { action?: string }).action,
        confidence: f.confidence,
      })),
      aiCalls,
      cacheHits,
    }),
  );

  const output: RouterOutput = {
    schemaVersion: '1.0',
    originalDump: combinedDump,
    dumpId,
    timestamp: Date.now(),
    language: detectFragmentLanguage(combinedDump),
    ...(visionUsed ? { visionUsed: true } : {}),
    crisis,
    fragments,
    summary: {
      moduleCount,
      cacheHitRate: fragments.length === 0 ? 0 : cacheHits / fragments.length,
      aiCalls,
      durationMs,
      pass2Triggered,
    },
  };

  // A6b: server-side durability. Mirror routed fragments into the encrypted
  // dump_inbox so a dump that arrived while the app was CLOSED (Siri TELL, a
  // future server brain) survives. Shadow/dual-write — gated by
  // SERVER_APPLY_ENABLED, fire-and-forget so it never slows the response.
  keepAlive(
    writeInbox(
      env,
      uid,
      dumpId,
      fragments.map((f) => ({ module: f.module, payload: f.payload })),
    ).catch((err) => console.warn('[route/dump] writeInbox failed (non-fatal)', err)),
  );

  return json(output);
}

/** Embed every fragment in a single Voyage call. Voyage accepts an input
 *  array and returns one row per input, each tagged with its `index`; we
 *  re-order by that index so the result aligns positionally with `texts`
 *  regardless of response ordering. */
async function voyageEmbedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: 'query',
      output_dimension: VOYAGE_EMBED_DIM,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`voyage ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data: Array<{ embedding: number[]; index?: number }> };
  const rows = data?.data;
  if (!Array.isArray(rows) || rows.length !== texts.length) {
    throw new Error(`voyage returned unexpected shape`);
  }
  const out: number[][] = new Array(texts.length);
  rows.forEach((row, i) => {
    if (!Array.isArray(row.embedding) || row.embedding.length !== VOYAGE_EMBED_DIM) {
      throw new Error(`voyage returned unexpected shape`);
    }
    // Honor the response's own `index` when present (Voyage sets it), else
    // fall back to array position — the response is already input-ordered.
    const slot = typeof row.index === 'number' ? row.index : i;
    out[slot] = row.embedding;
  });
  return out;
}
