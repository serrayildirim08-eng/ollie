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
import { classifyFragment } from './dump-classify';
import {
  type Fragment,
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

/** Hard upper bound on the raw image/pdf bytes the worker accepts.
 *  Frontend resizes images to ~700KB; PDFs aren't resized and routinely
 *  hit the multi-MB range. Cap chosen to fit a multi-page receipt PDF
 *  or scanned form while still bounding worker memory + Gemini upload. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const VOYAGE_MODEL = 'voyage-multilingual-2';
const VOYAGE_EMBED_DIM = 1024;

export interface DumpRouteEnv {
  VOYAGE_API_KEY: string;
  GROQ_API_KEY: string;
  /** Used when the request carries an `image` field. Already declared as a
   *  worker-wide secret (same one FeedMe uses). Missing/empty value with
   *  image present → 503 upstream-unavailable. Text-only dumps ignore it. */
  GEMINI_API_KEY: string;
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
}

const STAGING_TEST_USER_ID = 'staging-test-user';

export async function handleDumpRoute(req: Request, env: DumpRouteEnv): Promise<Response> {
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
        const split = await pass2Split(frag.text, env.GROQ_API_KEY);
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

  // 6. Per-fragment classification.
  const fragments: Fragment[] = [];
  let aiCalls = 0;
  let cacheHits = 0;

  for (const text of fragmentsText) {
    const language = detectFragmentLanguage(text);

    let embedding: number[];
    try {
      embedding = await voyageEmbed(text, env.VOYAGE_API_KEY);
    } catch (err) {
      return upstreamError('voyage_embed_failed', 502, err, { dumpId });
    }

    let cacheRow = null as Awaited<ReturnType<typeof cacheLookup>>;
    try {
      cacheRow = await cacheLookup(env.VECTORIZE_INDEX, userId, embedding);
    } catch (err) {
      console.error('[route/dump] vectorize lookup failed, miss-through', err);
    }

    if (cacheRow) {
      cacheHits++;
      const tiered = applyConfidencePolicy(cacheRow.module, cacheRow.payload, cacheRow.confidence);
      fragments.push({
        text,
        language,
        module: tiered.module,
        payload: tiered.payload,
        confidence: cacheRow.confidence,
        needsConfirm: tiered.needsConfirm,
        source: 'cache',
      });
      // Bump hit count asynchronously.
      void cacheHitBump(env.VECTORIZE_INDEX, cacheRow, userId, embedding).catch((e) =>
        console.error('[route/dump] cache bump failed', e),
      );
      continue;
    }

    // MISS — Groq classify.
    aiCalls++;
    let result: Awaited<ReturnType<typeof classifyFragment>>;
    try {
      result = await classifyFragment(text, language, env.GROQ_API_KEY);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return upstreamError('groq_classify_failed', 502, msg, { dumpId, fragment: text.slice(0, 80) });
    }

    const tiered = applyConfidencePolicy(result.module, result.payload, result.confidence);
    fragments.push({
      text,
      language,
      module: tiered.module,
      payload: tiered.payload,
      confidence: result.confidence,
      needsConfirm: tiered.needsConfirm,
      source: 'ai',
    });

    // Fire-and-forget cache write — never block response.
    void cacheUpsert(env.VECTORIZE_INDEX, {
      userId,
      text,
      embedding,
      module: tiered.module,
      payload: tiered.payload,
      confidence: result.confidence,
      language,
    }).catch((e) => console.error('[route/dump] cache upsert failed', e));
  }

  const durationMs = Date.now() - t0;
  const moduleCount: Partial<Record<Module, number>> = {};
  for (const f of fragments) {
    moduleCount[f.module] = (moduleCount[f.module] ?? 0) + 1;
  }

  console.log(
    '[route/dump]',
    JSON.stringify({
      input: combinedDump.slice(0, 120),
      visionUsed,
      fragments: fragments.map((f) => ({
        text: f.text.slice(0, 60),
        module: f.module,
        action: (f.payload as { action?: string }).action,
        price: (f.payload as { price?: number }).price,
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

  return json(output);
}

async function voyageEmbed(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [text],
      model: VOYAGE_MODEL,
      input_type: 'query',
      output_dimension: VOYAGE_EMBED_DIM,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`voyage ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== VOYAGE_EMBED_DIM) {
    throw new Error(`voyage returned unexpected shape`);
  }
  return embedding;
}
