/**
 * feed-me.config.ts — User-mode recipe ModuleConfig for /feed-me/:user.
 *
 * Pet-mode lives in pet-feed.config.ts; the endpoint picks one based on
 * `feedTarget`. Both share the same `RecipeSuggestion` output shape so the
 * frontend can render either with one component.
 *
 * Prompt structure (built per-request, see buildFeedMeSystemPrompt):
 *   - PANTRY (canonical names)
 *   - DIET FILTER (all/vegetarian/vegan/mediterranean/turkish)
 *   - LOCALE (responses in this language)
 *   - COUNT (default 3, max 5)
 *   - RECENT COOK SIGNALS (recent/loved/rejected/just-rejected, optional)
 *   - RULES (coverage, diversity, diet, step length)
 *
 * Spec: docs/handoffs/feed-me/00-SPEC.md
 */

import type { ModuleConfig } from './grocery.config';

// ─── output shape ─────────────────────────────────────────────────────────────

export interface RecipeIngredient {
  name: string;
  canonical: string | null;
  have: boolean;
  qty?: number;
  unit?: string;
}

/** One instructive step: action + a sensory "look for" cue (removes guessing,
 *  ADHD-first) + optional tip + optional per-step minutes. */
export interface RecipeStep {
  do: string;
  cue?: string;
  tip?: string;
  minutes?: number;
}

/** Optional "before you start" strip for the recipe detail screen. */
export interface RecipePrep {
  pan?: string;
  heat?: string;
  handsOnMinutes?: number;
}

export interface RecipeSuggestion {
  dish: string;
  cuisine: string;
  diet: string[];
  ingredients: RecipeIngredient[];
  steps: string[];
  /** Instructive steps (action + cue + optional tip). The detail screen prefers
   *  these; plain `steps` stays as the back-compat / fallback shape. */
  stepsDetailed?: RecipeStep[];
  /** Optional pan / heat / hands-on strip. */
  prep?: RecipePrep;
  prepMinutes: number;
  cookMinutes: number;
  servings: number;
  reasonSuggested?: string;
}

export interface RecipeBatch {
  suggestions: RecipeSuggestion[];
  language: 'en' | 'es' | 'tr' | 'other';
}

// ─── cook signals shape (mirrors feed_me_cook_signals RPC) ────────────────────

export interface CookSignal {
  dish: string;
  cuisine?: string;
  diet?: string[];
  count?: number;
  last_cooked_at?: string;
}

export interface CookSignals {
  recent: CookSignal[];
  loved: CookSignal[];
  rejected: CookSignal[];
  sampleSize: number;
}

// ─── per-request prompt context ───────────────────────────────────────────────

export type DietFilter = 'all' | 'vegetarian' | 'vegan' | 'mediterranean' | 'turkish';
export type FeedLocale = 'en' | 'es' | 'tr';

export interface FeedMePromptContext {
  pantry: string[];
  diet: DietFilter;
  locale: FeedLocale;
  count: number;
  signals: CookSignals;
  excludeDishes: string[];
}

// ─── few-shot examples (3 — EN vegetarian, TR omni, ES omni) ──────────────────

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: RecipeBatch }> = [
  {
    input:
      'PANTRY: tomato, onion, garlic, egg, feta, bread, olive oil, bell pepper\n' +
      'DIET FILTER: vegetarian\nLOCALE: en\nCOUNT: 3',
    output: {
      language: 'en',
      suggestions: [
        {
          dish: 'Shakshuka',
          cuisine: 'Middle Eastern',
          diet: ['vegetarian', 'mediterranean'],
          ingredients: [
            { name: 'tomato', canonical: 'tomato', have: true, qty: 4 },
            { name: 'onion', canonical: 'onion', have: true, qty: 1 },
            { name: 'garlic', canonical: 'garlic', have: true, qty: 2, unit: 'cloves' },
            { name: 'bell pepper', canonical: 'bell pepper', have: true, qty: 1 },
            { name: 'egg', canonical: 'egg', have: true, qty: 4 },
            { name: 'feta', canonical: 'feta', have: true, qty: 50, unit: 'g' },
            { name: 'olive oil', canonical: 'olive oil', have: true, qty: 2, unit: 'tbsp' },
            { name: 'cumin', canonical: 'cumin', have: false, qty: 1, unit: 'tsp' },
          ],
          steps: [
            'Heat olive oil in a wide skillet over medium heat.',
            'Add diced onion and bell pepper, cook 5 minutes until soft.',
            'Stir in minced garlic and cumin for 30 seconds.',
            'Add chopped tomatoes and simmer 10 minutes until saucy.',
            'Crack eggs into the sauce, cover, cook 5 minutes until whites set.',
            'Top with crumbled feta and serve with bread.',
          ],
          stepsDetailed: [
            { do: 'Warm olive oil in a wide skillet.', cue: 'oil shimmers but does not smoke', minutes: 1 },
            { do: 'Soften diced onion and bell pepper.', cue: 'translucent and soft, not browned', minutes: 5 },
            { do: 'Stir in garlic and cumin.', cue: 'fragrant, about 30 seconds — do not let garlic brown' },
            { do: 'Add chopped tomatoes and simmer.', cue: 'sauce thickens, a spoon leaves a brief trail', tip: 'a pinch of salt + sugar balances tart tomatoes', minutes: 10 },
            { do: 'Make wells, crack in the eggs, cover.', cue: 'whites set, yolks still soft', minutes: 5 },
            { do: 'Top with crumbled feta and serve with bread.' },
          ],
          prep: { pan: 'wide skillet, with a lid', heat: 'medium', handsOnMinutes: 8 },
          prepMinutes: 10,
          cookMinutes: 20,
          servings: 2,
          reasonSuggested: 'your tomatoes will turn soon',
        },
        {
          dish: 'Feta and Tomato Toast',
          cuisine: 'Mediterranean',
          diet: ['vegetarian', 'mediterranean'],
          ingredients: [
            { name: 'bread', canonical: 'bread', have: true, qty: 2, unit: 'slices' },
            { name: 'tomato', canonical: 'tomato', have: true, qty: 1 },
            { name: 'feta', canonical: 'feta', have: true, qty: 60, unit: 'g' },
            { name: 'olive oil', canonical: 'olive oil', have: true, qty: 1, unit: 'tbsp' },
            { name: 'garlic', canonical: 'garlic', have: true, qty: 1, unit: 'clove' },
          ],
          steps: [
            'Toast the bread until golden.',
            'Rub each slice with a halved garlic clove.',
            'Drizzle generously with olive oil.',
            'Top with sliced tomato and crumbled feta.',
          ],
          prepMinutes: 5,
          cookMinutes: 5,
          servings: 2,
        },
        {
          dish: 'Garlic Tomato Soup',
          cuisine: 'European',
          diet: ['vegetarian'],
          ingredients: [
            { name: 'tomato', canonical: 'tomato', have: true, qty: 6 },
            { name: 'onion', canonical: 'onion', have: true, qty: 1 },
            { name: 'garlic', canonical: 'garlic', have: true, qty: 4, unit: 'cloves' },
            { name: 'olive oil', canonical: 'olive oil', have: true, qty: 2, unit: 'tbsp' },
            { name: 'vegetable broth', canonical: null, have: false, qty: 500, unit: 'ml' },
          ],
          steps: [
            'Sweat the onion and garlic in olive oil for 5 minutes.',
            'Add quartered tomatoes and broth, simmer 15 minutes.',
            'Blend smooth, season with salt and pepper.',
            'Serve hot with toasted bread.',
          ],
          prepMinutes: 10,
          cookMinutes: 25,
          servings: 3,
        },
      ],
    },
  },
  {
    input:
      'PANTRY: mercimek, soğan, havuç, domates, yumurta, biber, peynir\n' +
      'DIET FILTER: all\nLOCALE: tr\nCOUNT: 2',
    output: {
      language: 'tr',
      suggestions: [
        {
          dish: 'Mercimek Çorbası',
          cuisine: 'Turkish',
          diet: ['vegetarian', 'turkish'],
          ingredients: [
            { name: 'kırmızı mercimek', canonical: null, have: true, qty: 1, unit: 'su bardağı' },
            { name: 'soğan', canonical: 'onion', have: true, qty: 1 },
            { name: 'havuç', canonical: 'carrot', have: true, qty: 1 },
            { name: 'domates salçası', canonical: null, have: false, qty: 1, unit: 'yemek kaşığı' },
            { name: 'tereyağı', canonical: 'butter', have: false, qty: 2, unit: 'yemek kaşığı' },
          ],
          steps: [
            'Soğan ve havucu küp doğra, tereyağında 5 dakika kavur.',
            'Mercimeği ve salçayı ekle, 1 dakika daha karıştır.',
            '1 litre sıcak su ekle, kapağı kapatıp 25 dakika pişir.',
            'Blender ile pürüzsüz olana kadar çek.',
            'Tuz, karabiber ve nane ile servis et.',
          ],
          prepMinutes: 10,
          cookMinutes: 25,
          servings: 4,
          reasonSuggested: 'mercimek + soğan elinde, çabuk çıkar',
        },
        {
          dish: 'Menemen',
          cuisine: 'Turkish',
          diet: ['vegetarian', 'turkish'],
          ingredients: [
            { name: 'yumurta', canonical: 'egg', have: true, qty: 3 },
            { name: 'domates', canonical: 'tomato', have: true, qty: 2 },
            { name: 'sivri biber', canonical: 'bell pepper', have: true, qty: 2 },
            { name: 'peynir', canonical: 'feta', have: true, qty: 50, unit: 'g' },
            { name: 'zeytinyağı', canonical: 'olive oil', have: false, qty: 2, unit: 'yemek kaşığı' },
          ],
          steps: [
            'Biberleri ince doğra, zeytinyağında 3 dakika kavur.',
            'Doğranmış domatesi ekle, suyunu salıp çekene kadar pişir.',
            'Yumurtaları kırıp hafifçe karıştır, peyniri serpiştir.',
            'Yumurta tam katılaşmadan ocaktan al, ekmekle servis et.',
          ],
          prepMinutes: 5,
          cookMinutes: 12,
          servings: 2,
        },
      ],
    },
  },
  {
    input:
      'PANTRY: huevo, patata, cebolla, aceite de oliva, ajo, pan, tomate\n' +
      'DIET FILTER: vegetarian\nLOCALE: es\nCOUNT: 2',
    output: {
      language: 'es',
      suggestions: [
        {
          dish: 'Tortilla Española',
          cuisine: 'Spanish',
          diet: ['vegetarian', 'mediterranean'],
          ingredients: [
            { name: 'huevo', canonical: 'egg', have: true, qty: 6 },
            { name: 'patata', canonical: 'potato', have: true, qty: 3 },
            { name: 'cebolla', canonical: 'onion', have: true, qty: 1 },
            { name: 'aceite de oliva', canonical: 'olive oil', have: true, qty: 200, unit: 'ml' },
          ],
          steps: [
            'Pela y corta las patatas en láminas finas.',
            'Calienta el aceite y confita las patatas con la cebolla 20 minutos a fuego lento.',
            'Bate los huevos, añade las patatas escurridas y mezcla.',
            'Cuaja en sartén caliente 4 minutos por cada lado.',
            'Sirve templada con pan.',
          ],
          prepMinutes: 10,
          cookMinutes: 30,
          servings: 4,
        },
        {
          dish: 'Pan con Tomate',
          cuisine: 'Spanish',
          diet: ['vegetarian', 'vegan', 'mediterranean'],
          ingredients: [
            { name: 'pan', canonical: 'bread', have: true, qty: 4, unit: 'rebanadas' },
            { name: 'tomate maduro', canonical: 'tomato', have: true, qty: 2 },
            { name: 'ajo', canonical: 'garlic', have: true, qty: 1, unit: 'diente' },
            { name: 'aceite de oliva', canonical: 'olive oil', have: true, qty: 2, unit: 'cucharadas' },
          ],
          steps: [
            'Tuesta las rebanadas de pan.',
            'Frota cada rebanada con ajo cortado.',
            'Frota con tomate maduro hasta que la miga quede roja.',
            'Riega con aceite y una pizca de sal.',
          ],
          prepMinutes: 5,
          cookMinutes: 5,
          servings: 2,
          reasonSuggested: 'los tomates están a punto',
        },
      ],
    },
  },
];

// ─── builders ─────────────────────────────────────────────────────────────────

/**
 * Build the per-request system prompt. The static module prompt (returned by
 * buildSystemPrompt()) is the constant frame; this function bakes in the
 * per-request pantry/diet/locale/signals.
 */
export function buildFeedMeSystemPrompt(ctx: FeedMePromptContext): string {
  const { pantry, diet, locale, count, signals, excludeDishes } = ctx;
  const recentLine =
    signals.recent.length > 0
      ? `- Recently cooked (avoid repeating in next 7 days): ${signals.recent.map((r) => r.dish).join(', ')}`
      : '- No recent cooking on file';
  const lovedLine =
    signals.loved.length > 0
      ? `- Loved dishes (prefer similar cuisine/style): ${signals.loved.map((l) => l.dish).join(', ')}`
      : '';
  const rejectedLine =
    signals.rejected.length > 0
      ? `- Disliked dishes (avoid these and close variants): ${signals.rejected.map((r) => r.dish).join(', ')}`
      : '';
  const excludeLine =
    excludeDishes.length > 0
      ? `- Just rejected THIS SESSION (do NOT suggest any of these): ${excludeDishes.join(', ')}`
      : '';

  return `You are an AI cook helping a ${locale} home cook plan a meal from what they already have.

PANTRY (canonical names): ${pantry.join(', ')}
DIET FILTER: ${diet}
LOCALE: ${locale} (respond in this language — dish names, step verbs, reasonSuggested all in ${locale})
COUNT: ${count} suggestions (no fewer, no more)

RECENT COOK SIGNALS:
${recentLine}
${lovedLine}
${rejectedLine}
${excludeLine}

RULES:
- Suggest exactly ${count} dishes the user can MOSTLY cook from the pantry (≥60% ingredient coverage).
- Mark each ingredient have=true when the canonical is in PANTRY (case-insensitive), have=false otherwise. Never invent that an ingredient is present.
- DIVERSITY: do not suggest three variations of the same dish; vary cuisine or technique.
- DIET ENFORCEMENT:
    • all → no restriction
    • vegetarian → no meat, no fish, no shellfish
    • vegan → no meat, fish, shellfish, dairy, eggs, honey
    • mediterranean → emphasise olive oil, legumes, vegetables, fish over red meat
    • turkish → traditional Turkish dishes (mercimek, menemen, pilav, köfte, dolma, etc); ground in Turkish home cooking, not "Turkish-inspired" fusion.
- STEPS: 3-7 short imperative sentences (plain \`steps\`). No prose, no chatter, no "enjoy!".
- INSTRUCTIVE (\`stepsDetailed\`): mirror the steps as objects — \`do\` = the action (≤14 words); \`cue\` = a short "look for" sensory/doneness check that removes guesswork ("soft and translucent, not browned" / "whites set, yolks still soft"); \`tip\` = a brief aside ONLY when genuinely useful (omit otherwise); \`minutes\` = per-step time when meaningful. One cue per step, terse — never a paragraph.
- PREP: fill \`prep\` with \`pan\` (e.g. "wide, with a lid"), \`heat\` (low/medium/high), \`handsOnMinutes\` (active minutes).
- reasonSuggested: optional, ≤ 12 words. Mention a turning-soon pantry item naturally ("your tomatoes will turn soon") OR a signal-driven hint ("you cooked feta last week and loved it"). Omit if there is no genuine reason.
- canonical: set to the canonical pantry name (lowercase) when the ingredient matches one of the PANTRY items; null when it is a fresh ingredient not in the pantry vocabulary.

OUTPUT:
Respond ONLY with the suggest_recipes function call. Do not narrate.`;
}

const DIET_TAGS = ['vegetarian', 'vegan', 'mediterranean', 'turkish', 'pescetarian', 'gluten-free', 'dairy-free'];

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'suggest_recipes',
    description: 'Suggest 1-5 dishes the user can cook from their pantry, with steps and have/missing ingredient split.',
    parameters: {
      type: 'object',
      required: ['suggestions', 'language'],
      properties: {
        language: {
          type: 'string',
          enum: ['en', 'es', 'tr', 'other'],
        },
        suggestions: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: {
            type: 'object',
            required: ['dish', 'cuisine', 'diet', 'ingredients', 'steps', 'prepMinutes', 'cookMinutes', 'servings'],
            properties: {
              dish: { type: 'string' },
              cuisine: { type: 'string' },
              diet: {
                type: 'array',
                items: { type: 'string', enum: DIET_TAGS },
              },
              ingredients: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'have'],
                  properties: {
                    name: { type: 'string' },
                    canonical: { type: 'string' },
                    have: { type: 'boolean' },
                    qty: { type: 'number' },
                    unit: { type: 'string' },
                  },
                },
              },
              steps: {
                type: 'array',
                minItems: 3,
                maxItems: 7,
                items: { type: 'string' },
              },
              stepsDetailed: {
                type: 'array',
                minItems: 3,
                maxItems: 7,
                items: {
                  type: 'object',
                  required: ['do'],
                  properties: {
                    do: { type: 'string' },
                    cue: { type: 'string' },
                    tip: { type: 'string' },
                    minutes: { type: 'number' },
                  },
                },
              },
              prep: {
                type: 'object',
                properties: {
                  pan: { type: 'string' },
                  heat: { type: 'string' },
                  handsOnMinutes: { type: 'number' },
                },
              },
              prepMinutes: { type: 'number' },
              cookMinutes: { type: 'number' },
              servings: { type: 'number' },
              reasonSuggested: { type: 'string' },
            },
          },
        },
      },
    },
  };
}

/**
 * The module-static system prompt is used for cache-key parity with the rest
 * of the ModuleConfig surface, but `geminiSuggest` actually calls the
 * per-request `buildFeedMeSystemPrompt(ctx)` because feed-me requires
 * runtime context (pantry + signals) baked into the system prompt.
 */
function buildSystemPrompt(): string {
  return 'See buildFeedMeSystemPrompt(ctx) for the live system prompt.';
}

export const feedMeConfig: ModuleConfig<RecipeBatch> = {
  moduleName: 'feed_me',
  canonicalItems: [],
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
