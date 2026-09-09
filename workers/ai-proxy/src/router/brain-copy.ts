/**
 * POST /brain-copy — Sprint 3 noticing sentence generation (A1).
 *
 * The client (apps/native/src/modules/brain/copy.ts) builds BOTH prompts via
 * @ollie/logic/brain buildCopyPrompt and caches the result per
 * noticing/day/lang; it falls back to a hardcoded trilingual sentence on any
 * non-ok response. So this route only has to wrap a small Layer-2 model call —
 * it must never be load-bearing for correctness.
 *
 * Auth: Clerk JWT required (same policy as /route/dump).
 * Request:  { system: string, user: string, lang: 'en'|'es'|'tr' }
 * Response: { text: string, source: 'ai' } | { error: string }
 */

import { verifyClerkJwt } from '../clerk-verify';
import { groqChat } from '../groq';

interface BrainCopyBody {
  system?: unknown;
  user?: unknown;
  lang?: unknown;
}

const MAX_PROMPT_CHARS = 4_000; // facts prompts are ~300 chars; hard ceiling against abuse
const LANGS = new Set(['en', 'es', 'tr']);
// Same tier as the other Layer-2 surfaces (modules/*.config.ts).
const COPY_MODEL = 'openai/gpt-oss-120b';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function handleBrainCopy(
  req: Request,
  env: {
    GROQ_API_KEY: string;
    CLERK_ISSUER?: string;
    STAGING_TEST_BEARER?: string;
    ENVIRONMENT?: string;
  },
): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'missing_bearer' }, 401);
  const bearer = auth.slice('Bearer '.length);
  // Staging test bearer honored only off production (audit #24, mirrors #43).
  const stagingDoor =
    env.ENVIRONMENT !== 'production' && !!env.STAGING_TEST_BEARER && bearer === env.STAGING_TEST_BEARER;
  if (!stagingDoor) {
    let userId: string | null = null;
    try {
      userId = await verifyClerkJwt(bearer, { CLERK_ISSUER: env.CLERK_ISSUER });
    } catch {
      userId = null;
    }
    if (!userId) return json({ error: 'invalid_token' }, 401);
  }

  let body: BrainCopyBody;
  try {
    body = (await req.json()) as BrainCopyBody;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const { system, user, lang } = body;
  if (
    typeof system !== 'string' || !system.trim() ||
    typeof user !== 'string' || !user.trim() ||
    typeof lang !== 'string' || !LANGS.has(lang)
  ) {
    return json({ error: 'bad_request' }, 400);
  }
  if (system.length > MAX_PROMPT_CHARS || user.length > MAX_PROMPT_CHARS) {
    return json({ error: 'prompt_too_long' }, 413);
  }

  try {
    const choice = await groqChat(
      {
        apiKey: env.GROQ_API_KEY,
        model: COPY_MODEL,
        temperature: 0.4,
        // gpt-oss-120b is a reasoning model: it spends tokens thinking before
        // the visible sentence. A tight cap (e.g. 120) gets consumed by the
        // reasoning channel and returns empty content, so give ample headroom —
        // the final sentence is still one line; cost stays ~$0.0001/call.
        maxTokens: 600,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      'brain-copy',
    );
    const text = (choice.message.content ?? '').trim();
    if (!text) return json({ error: 'empty_completion' }, 502);
    return json({ text, source: 'ai' });
  } catch {
    // Client treats any non-ok as "use the static fallback" — keep it simple.
    return json({ error: 'upstream_failed' }, 502);
  }
}
