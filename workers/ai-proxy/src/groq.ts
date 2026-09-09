/**
 * Thin Groq chat-completions client (OpenAI-compatible).
 *
 * Used by the brain-dump router (segmentation + classification) and the
 * module-agnostic `/route/:module` handler. Replaces the previous Gemini
 * 2.5 Flash callsites. Llama 3.3 70B is fast (~300 tok/s) and supports
 * JSON mode + tool calling, which is everything the router needs.
 *
 * Endpoint: https://api.groq.com/openai/v1/chat/completions
 * Auth:     Bearer <GROQ_API_KEY>  (Worker secret; never client-shipped)
 */

import { fetchWithTimeout, UPSTREAM_TIMEOUT_MS } from './fetch-timeout';

export const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface GroqTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface GroqOpts {
  apiKey: string;
  messages: GroqMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Force JSON object output. Mutually exclusive with `tools`. */
  jsonMode?: boolean;
  tools?: GroqTool[];
  toolChoice?:
    | 'auto'
    | 'required'
    | 'none'
    | { type: 'function'; function: { name: string } };
  model?: string;
}

export interface GroqToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface GroqChoice {
  message: {
    content: string | null;
    tool_calls?: GroqToolCall[];
  };
  finish_reason: string;
}

/** OpenAI-compatible usage block Groq returns alongside choices. */
interface GroqUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/**
 * gpt-oss-120b pricing, USD per 1M tokens. [VERIFY] confirm against
 * https://groq.com/pricing before trusting the cost_usd field — token
 * counts below are real (from the API), only this rate is assumed.
 */
const PRICE_PER_MTOK = { input: 0.15, output: 0.6 };

function costUsd(u: GroqUsage | undefined): number {
  const inTok = u?.prompt_tokens ?? 0;
  const outTok = u?.completion_tokens ?? 0;
  return (
    (inTok / 1_000_000) * PRICE_PER_MTOK.input +
    (outTok / 1_000_000) * PRICE_PER_MTOK.output
  );
}

/** Error thrown when Groq returns a non-2xx. `status` carries the HTTP code
 *  so callers can distinguish 429 (rate limit — recoverable, surface softly)
 *  from a genuine upstream failure. */
export type GroqHttpError = Error & { status?: number };

export async function groqChat(opts: GroqOpts, label: string): Promise<GroqChoice> {
  const body: Record<string, unknown> = {
    model: opts.model ?? GROQ_MODEL,
    messages: opts.messages,
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens ?? 512,
  };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };
  if (opts.tools) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? 'auto';
  }

  const startedAt = Date.now();
  // Per-call timeout (audit S2 · fix 3): a stalled Groq response otherwise held
  // the Worker for the full 30s wall. On timeout this throws a typed
  // UpstreamTimeoutError (.status=504) which the classify cascade treats as a
  // provider failure and falls through to the next free-tier provider.
  const res = await fetchWithTimeout(
    GROQ_URL,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    UPSTREAM_TIMEOUT_MS.groq,
    label,
  );
  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`${label} groq ${res.status}: ${detail.slice(0, 300)}`) as GroqHttpError;
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as { choices?: GroqChoice[]; usage?: GroqUsage };
  const choice = data?.choices?.[0];
  if (!choice) {
    throw new Error(`${label} groq no choices: ${JSON.stringify(data).slice(0, 300)}`);
  }

  // Measurement sayacı: one structured line per AI call. Watch live with
  // `wrangler tail ollie-ai-proxy`. No DB, no migration — pure observation.
  console.log(
    JSON.stringify({
      metric: 'ai_call',
      label,
      model: (body.model as string) ?? GROQ_MODEL,
      latency_ms: latencyMs,
      input_tokens: data.usage?.prompt_tokens ?? null,
      output_tokens: data.usage?.completion_tokens ?? null,
      cost_usd: Number(costUsd(data.usage).toFixed(6)),
    }),
  );

  return choice;
}
