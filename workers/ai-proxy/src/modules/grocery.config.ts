/**
 * grocery.config.ts — Module-specific config for `/route/grocery`.
 *
 * This is the ONLY grocery-specific file in the routing infrastructure.
 * The worker endpoint, cache lookup, and PII scrub are all module-agnostic;
 * this pluggable config drives the Gemini prompt and structured output schema.
 *
 * Spec: docs/MODULE_AGNOSTIC_AI.md
 */

export interface GroceryItem {
  name: string;
  canonical: string | null;
  category: string;
  intent: 'acquire' | 'plan' | 'pantry' | 'unknown';
  target: 'shopping' | 'pantry';
  qty?: number;
  unit?: string;
  shelfLifeDays?: number;
  isRecipeExpansion?: boolean;
}

export interface GroceryClassification {
  items: GroceryItem[];
  /** Top-level intent of the dump fragment. */
  intent: 'acquire' | 'plan' | 'pantry' | 'unknown';
  /** Detected language of the raw text. */
  language: 'en' | 'es' | 'tr' | 'other';
  /** Non-null when the fragment describes a dish/recipe — kept for recipe expansion. */
  recipeSourceLabel?: string | null;
}

export type GroceryIntentVerb = {
  acquire: string[];
  plan: string[];
  pantry: string[];
};

export interface ModuleConfig<C> {
  /** Human-readable module name (used in system prompt). */
  moduleName: string;
  /** Known/canonical items for this module (drives normalization hint). */
  canonicalItems: string[];
  /** Verb sets per intent class. */
  intentVerbs: Record<string, string[]>;
  /** Category list. */
  categories: string[];
  /** Shelf-life map: canonical → days (module-specific, e.g. grocery). */
  shelfLifeMap: Record<string, number>;
  /** Few-shot examples for the Gemini prompt. */
  examples: Array<{ input: string; output: C }>;
  /** Build the Gemini system prompt for this module. */
  buildSystemPrompt(): string;
  /** Build the JSON schema block for Gemini function calling. */
  buildFunctionSchema(): Record<string, unknown>;
}

// ─── Grocery canonical items (abbreviated — key entries only) ─────────────────
// Full alias table lives in @ollie/logic/grocery/data.ts.
// We list the canonical keys here so Gemini can normalize to them.

const CANONICAL_ITEMS = [
  'milk','yogurt','cheese','feta','butter','cream','egg','mozzarella','parmesan',
  'chicken','ground beef','beef','lamb','pork','fish','shrimp','sausage','bacon',
  'ham','salami','tomato','onion','garlic','potato','sweet potato','carrot',
  'celery','cucumber','zucchini','eggplant','bell pepper','spinach','lettuce',
  'apple','banana','lemon','lime','orange','strawberry','blueberry',
  'bread','pasta','rice','flour','oats','cereal',
  'olive oil','vegetable oil','butter',
  'salt','pepper','cumin','paprika','cinnamon','oregano','thyme',
  'sugar','honey','maple syrup',
  'soy sauce','vinegar','tomato paste','ketchup','mustard','mayonnaise',
  'water','juice','coffee','tea','beer','wine',
  'chips','crackers','chocolate','candy','ice cream',
  'shampoo','soap','toothpaste','detergent','toilet paper',
  'tampons','pads','liners',
];

const INTENT_VERBS: GroceryIntentVerb = {
  acquire: [
    'buy','get','pick up','grab','need','add','order','stock up',
    'al','almak','getir','satın al',
    'comprar','traer','conseguir',
  ],
  plan: [
    'planning to buy','want','thinking about','considering','maybe',
    'almayı düşünüyorum','belki',
    'pensando en','quiero',
  ],
  pantry: [
    'bought','got','picked up','have','stocked','finished','used up',
    'aldım','bitti','tükendi',
    'compré','tengo','se acabó',
  ],
};

const CATEGORIES = [
  'dairy','meat','deli','produce','drinks','pantry','cleaning',
  'frozen','snacks','supplements','personal_care','period_products','other',
];

const SHELF_LIFE_MAP: Record<string, number> = {
  milk: 7, yogurt: 21, cheese: 30, feta: 30, butter: 60, cream: 10, egg: 28,
  mozzarella: 14, parmesan: 90,
  chicken: 2, 'ground beef': 2, beef: 4, lamb: 4, pork: 4, fish: 2, shrimp: 2,
  sausage: 14, bacon: 14, ham: 7, salami: 21,
  tomato: 7, onion: 30, garlic: 90, potato: 30, 'sweet potato': 21,
  carrot: 21, celery: 14, cucumber: 7, zucchini: 7, eggplant: 7,
  'bell pepper': 10, spinach: 5, lettuce: 7,
  apple: 30, banana: 7, lemon: 30, lime: 30, orange: 30,
  bread: 7, pasta: 730, rice: 1825, flour: 365, oats: 365,
};

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: GroceryClassification }> = [
  {
    input: 'need to get milk eggs and bread',
    output: {
      intent: 'acquire',
      language: 'en',
      recipeSourceLabel: null,
      items: [
        { name: 'milk',  canonical: 'milk',  category: 'dairy',  intent: 'acquire', target: 'shopping', shelfLifeDays: 7 },
        { name: 'eggs',  canonical: 'egg',   category: 'dairy',  intent: 'acquire', target: 'shopping', shelfLifeDays: 28 },
        { name: 'bread', canonical: 'bread', category: 'pantry', intent: 'acquire', target: 'shopping', shelfLifeDays: 7 },
      ],
    },
  },
  {
    input: 'making pasta tonight — need tomatoes onions and garlic',
    output: {
      intent: 'acquire',
      language: 'en',
      recipeSourceLabel: 'pasta',
      items: [
        { name: 'tomatoes', canonical: 'tomato', category: 'produce', intent: 'acquire', target: 'shopping', shelfLifeDays: 7,  isRecipeExpansion: true },
        { name: 'onions',   canonical: 'onion',  category: 'produce', intent: 'acquire', target: 'shopping', shelfLifeDays: 30, isRecipeExpansion: true },
        { name: 'garlic',   canonical: 'garlic', category: 'produce', intent: 'acquire', target: 'shopping', shelfLifeDays: 90, isRecipeExpansion: true },
      ],
    },
  },
  {
    input: 'süt aldım bitti artık',
    output: {
      intent: 'pantry',
      language: 'tr',
      recipeSourceLabel: null,
      items: [
        { name: 'süt', canonical: 'milk', category: 'dairy', intent: 'pantry', target: 'pantry', shelfLifeDays: 7 },
      ],
    },
  },
];

function buildSystemPrompt(): string {
  const canonicalSample = CANONICAL_ITEMS.slice(0, 30).join(', ');
  const acquireVerbs = INTENT_VERBS.acquire.slice(0, 8).join(', ');
  const pantryVerbs = INTENT_VERBS.pantry.slice(0, 8).join(', ');

  return `You are an AI grocery assistant. Extract grocery items from a user's brain-dump text.

CANONICAL ITEMS (normalize to these when possible): ${canonicalSample}, ...

INTENT CLASSIFICATION:
- "acquire": user wants to buy/get something (verbs: ${acquireVerbs})
- "plan": user is considering future purchase
- "pantry": user just bought or already has (verbs: ${pantryVerbs})
- "unknown": ambiguous

LANGUAGE: detect the primary language (en/es/tr/other).

RECIPE EXPANSION: if the text mentions a dish/meal, set recipeSourceLabel to the dish name; mark resulting ingredient items with isRecipeExpansion: true.

TARGET:
- "shopping": item should go on shopping list (acquire/plan intents)
- "pantry": item should go to pantry log (pantry intent)

SHELF LIFE: populate shelfLifeDays from your knowledge of typical shelf life.

Respond ONLY with the classify_grocery_items function call.`;
}

function buildFunctionSchema(): Record<string, unknown> {
  return {
    name: 'classify_grocery_items',
    description: 'Extract and classify grocery items from a brain-dump text fragment.',
    parameters: {
      type: 'object',
      required: ['intent', 'language', 'items'],
      properties: {
        intent: {
          type: 'string',
          enum: ['acquire', 'plan', 'pantry', 'unknown'],
          description: 'Top-level intent of the whole fragment.',
        },
        language: {
          type: 'string',
          enum: ['en', 'es', 'tr', 'other'],
        },
        recipeSourceLabel: {
          type: 'string',
          description: 'Dish/meal name if the text is a recipe expansion, otherwise null.',
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'category', 'intent', 'target'],
            properties: {
              name:             { type: 'string', description: 'Raw item name from user text.' },
              canonical:        { type: 'string', description: 'Normalized canonical name or null.' },
              category:         { type: 'string', enum: CATEGORIES },
              intent:           { type: 'string', enum: ['acquire', 'plan', 'pantry', 'unknown'] },
              target:           { type: 'string', enum: ['shopping', 'pantry'] },
              qty:              { type: 'number' },
              unit:             { type: 'string' },
              shelfLifeDays:    { type: 'number' },
              isRecipeExpansion:{ type: 'boolean' },
            },
          },
        },
      },
    },
  };
}

export const groceryConfig: ModuleConfig<GroceryClassification> = {
  moduleName: 'grocery',
  canonicalItems: CANONICAL_ITEMS,
  intentVerbs: INTENT_VERBS,
  categories: CATEGORIES,
  shelfLifeMap: SHELF_LIFE_MAP,
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
