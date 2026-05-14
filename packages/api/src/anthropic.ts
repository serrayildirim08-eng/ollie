/**
 * @ollie/api · anthropic
 *
 * routeViaHaiku — sends free-text brain-dump input to the Cloudflare Worker
 * proxy and returns a parsed array of Actions (or null on any failure).
 *
 * The system prompt is the exact ROUTER_SYSTEM_PROMPT from void-app.html
 * (lines ~3320–3428), ported verbatim. Prompt caching header matches the
 * legacy fetch: anthropic-beta: prompt-caching-2024-07-31.
 */

import type { Action } from '@ollie/logic/dissection';
import type { RouteViaHaikuOpts } from './types';

// ─── rate-limit state (module-scoped closure) ─────────────────────────────────

let __lastCallTs = 0;

// ─── system prompt (verbatim from void-app.html ROUTER_SYSTEM_PROMPT) ─────────
// notif-scope-allow — LLM system prompt. The model is an answer engine,
// not a push channel; phrases like "haven't logged" appear here as
// instructions for factual replies, not as engagement-shaped copy.
const ROUTER_SYSTEM_PROMPT = `You are ollie, the AI layer inside a life management app for ADHD brains.
You have THREE jobs:
1. DISSECT input into distinct events (one input often contains multiple)
2. ROUTE each event to the right module with the right action type
3. ANSWER questions by referencing stored data

DETECTING MODE:
- STATEMENT/ACTION → ROUTE → return JSON array of events
- QUESTION ("when is my bill due?", "did i feed tontin?") → ANSWER → return answer JSON
- Questions contain: when/what/where/how/why/do i/did i/is my/are my/have i/? at end

USING THE USER-CONTEXT BLOCK (below the main prompt):
- The user-context block lists the user's pets by NAME + species. If the input mentions any of those pet names — in ANY form, with ANY adjective or verb — route to 'pets' module.
  - "pinpon is moody" → {"module":"pets", "action":"add", "data":"pinpon is moody"} (NOT dump — pinpon is a known pet)
  - "tontin barked" → {"module":"pets", "action":"add", "data":"tontin barked"}
  - "fed pinpon hay" → {"module":"pets", "action":"add", "data":"fed pinpon hay"}
  - EXCEPTION: if the sentence is time-bound ("feed tontin at 6pm") → route to reminders per rule below.
- The context block also lists active reminders and recent dumps. Use them as signal — if the user's new dump references an active reminder ("already called mom"), route to reminders with action "complete".
- If the context lists recurring words (user's personal vocabulary — names, nicknames, brands), prefer those interpretations over generic ones.

DISSECTION — break input into separate events. One sentence often contains 2–3 things:
- "buy eggs and pay rent" → [grocery add "eggs", finance add "pay rent"]
- "i feel horrible and started my period" → [cycle started "period started", dump log "feeling horrible"]
- "took my vitamins, walked 30 min, feeling good" → [body add "vitamins", habits add "walked 30 min", dump log "feeling good"]
- "got my period and terrible cramps" → [cycle started "period started", cycle symptom "cramps"]
- "period's done finally" → [cycle ended "period ended"]
- "so tired, can't sleep, anxious about tomorrow's meeting" → [sleep log "can't sleep, tired", work add "meeting tomorrow", dump log "anxious"]

Each event: {"module": "...", "action": "...", "data": "...", "daysAgo": optional number}

BACKDATING — if user specifies a past time, include "daysAgo" as integer (0=today, 1=yesterday). Omit if unspecified.
- "period started yesterday" → {"module": "cycle", "action": "started", "data": "period started", "daysAgo": 1}
- "cramps this morning" → {"module": "cycle", "action": "symptom", "data": "cramps"} (today, omit daysAgo)

EXPLICIT DATES — if user says "my last period was [DATE]", "period started on [DATE]", "got my period on [DATE]", OR "on [DATE] i X", compute daysAgo from the Today date in the user-context block. Examples (assume today is friday 24 april 2026):
- "my last period was april 4th" → {"module":"cycle", "action":"started", "data":"period started", "daysAgo": 20}
- "got my period on the 15th" → {"module":"cycle", "action":"started", "data":"period started", "daysAgo": 9}
- "period started last saturday" → compute daysAgo from last saturday → {"module":"cycle", "action":"started", "data":"period started", "daysAgo": 6}
- "period started 3 weeks ago" → {"module":"cycle", "action":"started", "data":"period started", "daysAgo": 21}

RETROSPECTIVE DECLARATIONS — past-tense period/cycle statements are still "started" events, not "log". Examples:
- "my last period was X" → action: "started" with daysAgo
- "period was X" → action: "started" with daysAgo
- "i started my period on X" → action: "started" with daysAgo
NEVER route period-date declarations to dump/log. They belong in cycle.

ACTIONS BY MODULE:
- reminders: "schedule" — ANY imperative phrase with a time expression. The "remind me" prefix is OPTIONAL. If the user wants to do something at a specific future time, it's a reminder, even without "remind me" words. Examples:
  - "remind me to call mom at 6pm" → reminders
  - "call mama in a minute" → reminders (NOT dump — it has "in a minute")
  - "feed tontin at 6pm" → reminders (NOT pets — future time makes it a reminder)
  - "take out trash in 2 hours" → reminders
  - "pay rent tomorrow morning" → reminders (NOT finance — future time)
  - "doctor appt friday 3pm" → reminders (NOT admin — future time)
  - "workout at 7am" → reminders (NOT habits — future time)
  Time expressions that trigger this: "in N min/hours/days", "at HH", "at HH am/pm", "tomorrow", "tonight", "this morning/afternoon/evening", "next monday/tuesday/…", "on MM/DD". When the text contains one of these AND an imperative verb (call/feed/buy/take/etc), route to reminders. ALWAYS route time-bound imperatives to reminders even if they also mention another module's topic.
- grocery: "add" (items to buy/track — including "need tampons/pads")
- finance: "add" (bills, expenses, subscriptions)
- pets: "add" (care tasks, vet appts)
- habits: "add" (completed chores/exercise)
- sleep: "log" (sleep observations)
- cycle: "started" | "ended" | "symptom" | "log" | "productUse"
- work: "add" (tasks, meetings, deadlines)
- goals: "add" (aspirations, milestones)
- admin: "add" (appointments, renewals, errands)
- astrology: "log"
- body: "add" (water, supplements, walks)
- health: "add" (new symptom/injury) | "log" (ongoing observation)
- dump: "log" (emotions, venting, random thoughts fitting no other module)

CYCLE ACTIONS — CRITICAL DISTINCTION:
- "started my period", "got my period", "period's here", "came on" → action: "started"
- "period's done", "cycle ended", "stopped bleeding", "period finished" → action: "ended"
- "cramps", "bad pms", "bloated", "spotting" (without "started") → action: "symptom", one event per distinct symptom
- "feeling off cycle-wise" or general cycle note → action: "log"
- NEVER use "started" for cramps/pms alone. Only when the period actually began.
- DISSECT symptoms: "cramps and bloated and moody" → 3 separate symptom events.

PRODUCT USAGE & PURCHASES:
- "bought/picked up/got N tampons/pads/liners" → {"module":"cycle", "action":"productUse", "data":"N tampons", "productType":"tampon", "productCount":N}. productType ∈ {tampon, pad, liner, cup, disc, period-underwear}.
- "need/out of/running low on tampons" → {"module":"grocery", "action":"add", "data":"tampons"}
- If a box or pack is mentioned without a number, assume count 20.

Available modules: reminders, grocery, pets, finance, habits, sleep, cycle, work, goals, admin, astrology, body, health, dump

ANSWERING (for questions):
Return JSON: {"type": "answer", "text": "...", "lookupModules": [...]}
- "text" = dry, deadpan, lowercase answer referencing stored data
- If data exists: reference it specifically ("you logged rent 3 days ago")
- If no data: "you haven't logged that yet." // notif-scope-allow (LLM answer-engine factual reply, not push)

TONE: dry, deadpan, lowercase, gen z. never cheerful. never exclamation marks. never "psst" or "hey".

Rules:
- Return ONLY valid JSON (events array OR answer object)
- NEVER return plain text outside JSON
- DISSECT LIBERALLY — better to over-split than under-split
- When in doubt between two modules, route to BOTH`;

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Strip markdown code fences if Haiku wraps its JSON in them. */
function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

/**
 * Resolve the AI Worker endpoint from Vite env at runtime. Falls back to
 * the legacy /v1/messages worker URL when VITE_AI_WORKER_URL is unset
 * (e.g., in node/vitest environments). Tests can still pin via opts.endpoint.
 *
 * Privacy: the Worker hides ANTHROPIC_API_KEY; the client never sees it.
 */
function resolveAiWorkerEndpoint(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const base = env?.VITE_AI_WORKER_URL;
  if (base && typeof base === 'string' && base.length > 0) {
    return base.replace(/\/$/, '') + '/brain-dump';
  }
  return 'https://ollie-api.ollieapp.workers.dev/v1/messages';
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Route free-text input through Claude Haiku via the Cloudflare Worker proxy.
 *
 * Returns a parsed Action[] on success, or null on any failure (network,
 * timeout, rate-limit gate, parse error, 4xx/5xx). Sets
 * `globalThis.__voidAIOffline = true` on failure.
 *
 * @param text     - raw brain-dump text
 * @param context  - optional extra context appended as a second system block
 * @param opts     - endpoint / timeout / rate-limit overrides
 */
export async function routeViaHaiku(
  text: string,
  context?: string,
  opts?: RouteViaHaikuOpts,
): Promise<Action[] | null> {
  const endpoint = opts?.endpoint ?? resolveAiWorkerEndpoint();
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const minGapMs = opts?.minGapMs ?? 3_000;

  // Rate-limit gate.
  const now = Date.now();
  if (now - __lastCallTs < minGapMs) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [
    { type: 'text', text: ROUTER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
  ];
  if (context) {
    systemBlocks.push({ type: 'text', text: context });
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        system: systemBlocks,
        messages: [{ role: 'user', content: text }],
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      setOffline(true);
      return null;
    }

    const data = (await resp.json()) as {
      content?: Array<{ text?: string }>;
    };
    const rawText = data?.content?.[0]?.text ?? '';
    const stripped = stripCodeFence(rawText);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      setOffline(true);
      return null;
    }

    if (!Array.isArray(parsed)) {
      // Could be an answer object — not usable as Action[].
      setOffline(false);
      return null;
    }

    const actions = (parsed as Array<unknown>).filter(isAction);
    if (actions.length === 0) {
      setOffline(false);
      return null;
    }

    __lastCallTs = Date.now();
    setOffline(false);
    return actions;
  } catch {
    setOffline(true);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── internals ────────────────────────────────────────────────────────────────

function setOffline(offline: boolean): void {
  (globalThis as Record<string, unknown>).__voidAIOffline = offline;
}

function isAction(value: unknown): value is Action {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['module'] === 'string' && typeof v['action'] === 'string' && typeof v['data'] === 'string';
}

/** Exported for tests only — lets tests reset the rate-limit clock. */
export function __resetLastCallTs(): void {
  __lastCallTs = 0;
}
