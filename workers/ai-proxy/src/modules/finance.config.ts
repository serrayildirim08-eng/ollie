/**
 * finance.config.ts — Module-specific config for `/route/finance` (Layer 2).
 *
 * Layer 1 (`/route/dump`) already routes a fragment to the finance module
 * with a chosen action. Layer 2 = finance-specific AI that takes the raw
 * fragment and resolves the specific action + payload. Port of cycle.config.ts
 * (same ModuleConfig, same tier ladder, same trilingual few-shot convention).
 *
 * Cost strategy (locked, see project_ollie_layer2_cost_strategy.md):
 *   1. Voyage semantic cache (handled by the shared route.ts) — cheap.
 *   2. Groq Llama 3.1 8B Instant (default tier) — sub-cent, ~300 tok/s.
 *   3. Groq GPT-OSS 120B (escalation when 8B confidence < 0.7) — only
 *      Groq-hosted model with native prompt caching (50% off cached input
 *      after first call). Same pair as sleep (commits 0b098e1 + a81567a).
 *   4. NEVER regex/keyword fallback (feedback_ollie_no_regex_routing.md).
 *
 * Trilingual: EN + ES + TR. The dump pipeline detects language upstream,
 * but the Layer 2 prompt also instructs the model to label the language
 * field so the response is self-describing for downstream consumers.
 *
 * Actions mirror the finance block in src/router/dump-classify.ts:
 *   - log_transaction       — { amount?, currency?, merchant? }
 *   - log_income            — { amount?, currency?, source? }            (2026-05-31)
 *   - log_refund            — { amount?, currency?, merchant?, originalItem? }
 *   - spending_reflection   — { note: REQUIRED, category?, sentiment? }
 *   - pending_decision      — { what: REQUIRED, amount?, currency?, deadline? }
 *   - add_bill              — { merchant: REQUIRED, amount?, cadence? }
 *   - savings_note          — { amount?, note? }
 *   - subscription_log      — { name: REQUIRED, amount?, currency?, cadence? }
 *
 * No cross-route mirror. Finance is standalone Layer 2.
 *
 * Inbound mirror note: when Layer 1 routes "bought milk for $5" to
 * grocery.pantry_add with price/currency, the GROCERY handler calls
 * finance.log_transaction directly (not through Layer 2). This Layer 2
 * fires only when Layer 1 directly routes to finance.
 *
 * Currency parsing: $→USD, USD, EUR, TL/TRY→TRY, £/GBP→GBP.
 * Cadence parsing: "monthly"/"aylık"/"mensual" → "monthly";
 *                  "yearly"/"yıllık"/"anual" → "yearly";
 *                  "weekly"/"haftalık"/"semanal" → "weekly";
 *                  "$X/month" → "monthly".
 */

import type { ModuleConfig } from './grocery.config';

// ─── action types ─────────────────────────────────────────────────────────────

export type FinanceAction =
  | 'log_transaction'
  | 'log_income'
  | 'log_refund'
  | 'spending_reflection'
  | 'pending_decision'
  | 'add_bill'
  | 'savings_note'
  | 'subscription_log';

export interface FinanceClassification {
  action: FinanceAction;
  payload: Record<string, unknown>;
  confidence: number;
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── tier ladder ──────────────────────────────────────────────────────────────

/**
 * Cheap Groq Llama 3.1 8B Instant — handles the easy 80% (clear "spent $40"
 * / "kira aylık" style fragments). When the model returns confidence < 0.7
 * we re-call with the accurate tier (GPT-OSS 120B — has Groq prompt caching).
 * Same pair as sleep/cycle, same threshold, same reasoning.
 */
export const FINANCE_MODEL_FAST = 'llama-3.1-8b-instant';
export const FINANCE_MODEL_ACCURATE = 'openai/gpt-oss-120b';
export const FINANCE_ESCALATE_THRESHOLD = 0.7;

// ─── trilingual few-shot examples (16 = 2 per action × 8 actions) ────────────
// Mix EN / ES / TR across the set. Natural everyday phrases.

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: FinanceClassification }> = [
  // log_transaction — EN
  {
    input: 'spent $40 at sephora',
    output: {
      action: 'log_transaction',
      payload: { amount: 40, currency: 'USD', merchant: 'Sephora' },
      confidence: 0.97,
      language: 'en',
    },
  },
  // log_transaction — TR
  {
    input: '100 TL bağışladım',
    output: {
      action: 'log_transaction',
      payload: { amount: 100, currency: 'TRY' },
      confidence: 0.95,
      language: 'tr',
    },
  },
  // add_bill — EN
  {
    input: 'rent is $1800/month',
    output: {
      action: 'add_bill',
      payload: { merchant: 'rent', amount: 1800, cadence: 'monthly' },
      confidence: 0.96,
      language: 'en',
    },
  },
  // add_bill — TR
  {
    input: 'kira 18000 TL aylık',
    output: {
      action: 'add_bill',
      payload: { merchant: 'kira', amount: 18000, cadence: 'monthly' },
      confidence: 0.95,
      language: 'tr',
    },
  },
  // savings_note — EN
  {
    input: 'moved 500 to savings',
    output: {
      action: 'savings_note',
      payload: { amount: 500 },
      confidence: 0.96,
      language: 'en',
    },
  },
  // savings_note — ES
  {
    input: 'ahorré 100',
    output: {
      action: 'savings_note',
      payload: { amount: 100 },
      confidence: 0.93,
      language: 'es',
    },
  },
  // subscription_log — EN
  {
    input: 'renewed spotify $10/month',
    output: {
      action: 'subscription_log',
      payload: { name: 'Spotify', amount: 10, currency: 'USD', cadence: 'monthly' },
      confidence: 0.97,
      language: 'en',
    },
  },
  // subscription_log — TR
  {
    input: 'Netflix yeniledim',
    output: {
      action: 'subscription_log',
      payload: { name: 'Netflix' },
      confidence: 0.94,
      language: 'tr',
    },
  },
  // log_income — EN
  {
    input: 'akalan paycheck deposited',
    output: {
      action: 'log_income',
      payload: { source: 'akalan' },
      confidence: 0.96,
      language: 'en',
    },
  },
  // log_income — TR
  {
    input: 'maaş geldi',
    output: {
      action: 'log_income',
      payload: { source: 'salary' },
      confidence: 0.95,
      language: 'tr',
    },
  },
  // log_refund — EN
  {
    input: 'amazon refunded me $40',
    output: {
      action: 'log_refund',
      payload: { amount: 40, currency: 'USD', merchant: 'Amazon' },
      confidence: 0.96,
      language: 'en',
    },
  },
  // log_refund — ES
  {
    input: 'me devolvieron los zapatos',
    output: {
      action: 'log_refund',
      payload: { originalItem: 'shoes' },
      confidence: 0.93,
      language: 'es',
    },
  },
  // spending_reflection — ES
  {
    input: 'gastando demasiado en café',
    output: {
      action: 'spending_reflection',
      payload: { note: 'spending too much on coffee', category: 'café', sentiment: 'concerned' },
      confidence: 0.94,
      language: 'es',
    },
  },
  // spending_reflection — EN
  {
    input: "this is the third mouse i've bought this year",
    output: {
      action: 'spending_reflection',
      payload: {
        note: 'third mouse this year — repeated pattern',
        category: 'electronics',
        sentiment: 'concerned',
      },
      confidence: 0.93,
      language: 'en',
    },
  },
  // pending_decision — EN
  {
    input: 'moving quote 2400',
    output: {
      action: 'pending_decision',
      payload: { what: 'moving quote', amount: 2400 },
      confidence: 0.95,
      language: 'en',
    },
  },
  // pending_decision — TR
  {
    input: 'yeni laptop almalı mıyım',
    output: {
      action: 'pending_decision',
      payload: { what: 'new laptop' },
      confidence: 0.92,
      language: 'tr',
    },
  },
];

// ─── prompt (compressed, JSON-only, no chain-of-thought) ─────────────────────

function buildSystemPrompt(): string {
  return `You are Ollie's finance-module Layer 2 AI. The user dumped a fragment that has already been routed to the finance module. Pick the most specific finance action and extract its payload.

LANGUAGE: detect the primary language (en/es/tr/other). Handle mixed-language fragments — don't refuse.

ACTIONS (pick exactly one):
- log_transaction: a one-off payment, purchase, or expense (money OUT). payload: { amount? (number), currency? (ISO 4217: "USD"/"EUR"/"TRY"/"GBP"), merchant? (string, title-case the business name) }
    Currency symbols: $ → "USD", £ → "GBP", € → "EUR", TL/TRY → "TRY". Leave omitted when not stated.
    Triggers: "spent X at Y", "paid X", "gasté X en Y", "X TL harcadım", "pagué X de Y", "gastos X en Y".
- log_income: money IN — salary, freelance payment, client payment, gift, asset sale. NOT a refund (use log_refund). payload: { amount? (number), currency? (ISO 4217), source? (string — the payer name when stated, or "salary" / "freelance" as a generic) }
    Triggers: "got paid", "deposited", "received", "hit my account", "geldi", "ödediler", "depositaron", "me pagaron", "paycheck", "maaş", "salary".
    Examples: "maaş geldi" → { source: "salary" } ; "akalan paycheck deposited" → { source: "akalan" } ; "elin energy paid me 500" → { amount: 500, source: "elin energy" } ; "depositaron el sueldo" → { source: "salary" } ; "freelance 5000 TL geldi" → { amount: 5000, currency: "TRY", source: "freelance" }.
- log_refund: money came back from a previous purchase. payload: { amount? (number), currency? (ISO 4217), merchant? (string), originalItem? (string — what was returned) }
    Triggers: "refunded me", "returned the X", "got a refund for X", "iade aldım", "me devolvieron", "X devuelto".
    Examples: "returned the scarf" → { originalItem: "scarf" } ; "amazon refunded me $40" → { amount: 40, currency: "USD", merchant: "Amazon" } ; "me devolvieron los zapatos" → { originalItem: "shoes" } ; "iade aldım" → { } ; "amazon 200 TL iade etti" → { amount: 200, currency: "TRY", merchant: "Amazon" }.
- spending_reflection: user is reflecting on a SPENDING PATTERN, not logging a single transaction. payload: { note (REQUIRED — the reflection itself, paraphrased into English), category? (string — what's being reflected on: "café"/"takeout"/"electronics"/"subscriptions"/"impulse"), sentiment? ("concerned"|"satisfied"|"neutral") }
    Triggers: "too much", "demasiado", "çok harcıyorum", "always", "again", "Nth time" ("third mouse this year"), "i always end up at X", "keep buying", "forgot to cancel … again".
    Sentiment defaults to "concerned" for pattern-marker reflections; "satisfied" when the user is happy about it.
    Examples: "gastando demasiado en café" → { note: "spending too much on coffee", category: "café", sentiment: "concerned" } ; "this is the third mouse I've bought this year" → { note: "third mouse this year — repeated pattern", category: "electronics", sentiment: "concerned" } ; "kahveye çok harcıyorum" → { note: "spending too much on coffee", category: "café", sentiment: "concerned" }.
- pending_decision: money-related decision the user has NOT yet made. Quotes, options being weighed, "should I…" money questions. payload: { what (REQUIRED — the decision in English), amount? (number), currency? (ISO 4217), deadline? (string) }
    Triggers: "should I…", "thinking about…", "quote", "deposit (no payment verb)", "comprar o no", "almalı mıyım", "looking at the X", "got a quote".
    Examples: "moving quote 2400" → { what: "moving quote", amount: 2400 } ; "should I get the new laptop?" → { what: "new laptop" } ; "comprar o no el sofá" → { what: "buy the sofa" } ; "yeni laptop almalı mıyım" → { what: "new laptop" }.
- add_bill: a recurring fixed expense like rent, utilities, insurance. payload: { merchant (REQUIRED — the bill name or payee, title-case), amount? (number), cadence? ("monthly"|"yearly"|"weekly") }
    Cadence: "monthly"/"aylık"/"mensual"/"$X/month" → "monthly"; "yearly"/"yıllık"/"anual"/"$X/year" → "yearly"; "weekly"/"haftalık"/"semanal" → "weekly".
    Triggers: "rent is X/month", "electricity bill X", "kira X aylık", "luz X mensual".
- savings_note: transferring money to savings or noting a savings milestone. payload: { amount? (number), note? (string — preserve user's note if any) }
    Triggers: "moved X to savings", "saved X", "ahorré X", "tasarrufa X attım", "biriktirdim".
- subscription_log: a recurring subscription service (streaming, software, apps). payload: { name (REQUIRED — the service name, title-case), amount? (number), currency? (ISO 4217), cadence? ("monthly"|"yearly"|"weekly") }
    Triggers: "renewed X", "subscribed to X", "X aboneliği yenilendi", "suscribí a X", "$X/month Netflix".

DISAMBIGUATION:
- "spent $40 at sephora" → log_transaction with amount=40, currency="USD", merchant="Sephora".
- "rent is $1800/month" → add_bill (recurring fixed expense), not log_transaction.
- "Netflix $10/month" → subscription_log, not add_bill (streaming service vs. utility/fixed bill).
- "moved 500 to savings" → savings_note (no merchant, no subscription).
- "pagé 50 dólares de luz" → add_bill with merchant="Luz" (utility bill triggers add_bill, not log_transaction).
- "200 pesos en farmacia" → log_transaction with amount=200, merchant="Farmacia" (one-off pharmacy spend).
- "subscribed €15/month" → subscription_log with currency="EUR", cadence="monthly".
- "maaş geldi" → log_income, NOT log_transaction (money IN, not money OUT).
- "akalan paycheck deposited" → log_income with source="akalan", NOT log_transaction.
- "amazon refunded me $40" → log_refund, NOT log_income (refund of a prior purchase, not new income).
- "gastando demasiado en café" → spending_reflection (pattern marker "demasiado"), NOT log_transaction (no single discrete spend).
- "forgot to cancel free trial again" → spending_reflection with category="subscriptions", NOT subscription_log (it's a self-observation about a pattern, not a new subscription).
- "moving quote 2400" → pending_decision (quote received, decision pending), NOT log_transaction (no payment happened).
- "should I get the new laptop?" → pending_decision, NOT log_transaction and NOT dump_only.
- Currency when unstated: leave currency field omitted — do NOT default to USD.

OUTPUT — respond ONLY with the classify_finance_action function call. JSON only, no prose, no chain-of-thought.

CONFIDENCE: be honest. If the fragment is ambiguous, return confidence < 0.7 so the router can escalate to a stronger model. Do NOT inflate confidence to seem decisive.`;
}

// ─── function schema (tool calling) ──────────────────────────────────────────

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_finance_action',
    description: 'Resolve the specific finance action + payload for a fragment already routed to the finance module.',
    parameters: {
      type: 'object',
      required: ['action', 'payload', 'confidence', 'language'],
      properties: {
        action: {
          type: 'string',
          enum: [
            'log_transaction',
            'log_income',
            'log_refund',
            'spending_reflection',
            'pending_decision',
            'add_bill',
            'savings_note',
            'subscription_log',
          ],
        },
        confidence: {
          type: 'number',
          description: 'Self-reported confidence 0-1. Values below 0.7 trigger model escalation.',
        },
        language: {
          type: 'string',
          enum: ['en', 'es', 'tr', 'other'],
        },
        payload: {
          type: 'object',
          description: 'Action-specific fields. See action enum for the per-action shape.',
          properties: {
            // log_transaction + add_bill + log_income + log_refund + pending_decision
            amount: { type: 'number' },
            currency: { type: 'string' },
            merchant: { type: 'string' },
            // add_bill + subscription_log
            cadence: { type: 'string', enum: ['monthly', 'yearly', 'weekly'] },
            // savings_note + spending_reflection
            note: { type: 'string' },
            // subscription_log
            name: { type: 'string' },
            // log_income
            source: { type: 'string' },
            // log_refund
            originalItem: { type: 'string' },
            // spending_reflection
            category: { type: 'string' },
            sentiment: { type: 'string', enum: ['concerned', 'satisfied', 'neutral'] },
            // pending_decision
            what: { type: 'string' },
            deadline: { type: 'string' },
          },
        },
      },
    },
  };
}

// ─── exported ModuleConfig ───────────────────────────────────────────────────

export const financeConfig: ModuleConfig<FinanceClassification, undefined> = {
  moduleName: 'finance',
  canonicalItems: [], // finance has no item registry; the prompt enumerates actions.
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
