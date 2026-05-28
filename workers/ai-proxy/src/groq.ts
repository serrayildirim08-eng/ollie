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

export const GROQ_MODEL = 'llama-3.3-70b-versatile';
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

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${label} groq ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices?: GroqChoice[] };
  const choice = data?.choices?.[0];
  if (!choice) {
    throw new Error(`${label} groq no choices: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return choice;
}
