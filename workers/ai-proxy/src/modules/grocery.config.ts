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

export const CANONICAL_ITEMS = [
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
    // depletion signals — when user says "out of X" or "running low on X"
    // they're telling us they need to BUY more (not that they have it now).
    'out of','running low on','running out of','low on','almost out of',
    'we need','we are out of','have to buy','should get','must buy',
    // Turkish
    'al','almak','getir','satın al','almam lazım','lazım','bitti',
    'kalmadı','tükendi','almalıyım','almalıyız',
    // Spanish
    'comprar','traer','conseguir','necesito','necesitamos','me falta',
    'nos falta','hace falta','tengo que comprar','hay que comprar',
    'se acabó','se nos acabó','no hay','no queda','añade','agrega',
  ],
  plan: [
    'planning to buy','want','thinking about','considering','maybe',
    'almayı düşünüyorum','belki',
    'pensando en','quiero',
  ],
  pantry: [
    // confirmed POSSESSION — user already has the item in hand.
    // NOT to be confused with depletion ("out of X", "ran out") which is
    // ACQUIRE intent, not pantry. The verb signals OWNERSHIP, not LACK.
    'bought','got','picked up','have','stocked','restocked',
    'just bought','just got','just picked up','already have',
    // Turkish
    'aldım','aldık','getirdim','elimde var','elimde',
    // Spanish
    'compré','compramos','traje','trajimos','tengo','tenemos',
    'ya tengo','recién compré',
  ],
};

const CATEGORIES = [
  'dairy','meat','deli','produce','drinks','pantry','cleaning',
  'frozen','snacks','supplements','personal_care','period_products','other',
];

export const SHELF_LIFE_MAP: Record<string, number> = {
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
  // Depletion signals — these mean BUY MORE, not "I have it". Critical
  // for not putting "out of X" into the pantry slice by mistake.
  {
    input: 'out of dish soap\nrunning low on coffee\nalmost out of olive oil',
    output: {
      intent: 'acquire',
      language: 'en',
      recipeSourceLabel: null,
      items: [
        { name: 'dish soap',  canonical: null,        category: 'cleaning', intent: 'acquire', target: 'shopping' },
        { name: 'coffee',     canonical: 'coffee',    category: 'drinks',   intent: 'acquire', target: 'shopping' },
        { name: 'olive oil',  canonical: 'olive oil', category: 'pantry',   intent: 'acquire', target: 'shopping' },
      ],
    },
  },
  // Abbreviations + depletion combined — common ADHD shorthand flow.
  // 'tp' should expand to toilet paper with canonical set; 'pb' is peanut butter.
  // User typed the abbreviation deliberately for speed — preserve it in `name`,
  // expose the expansion only via `canonical`.
  {
    input: 'need tp\nout of pb\nneed evoo',
    output: {
      intent: 'acquire',
      language: 'en',
      recipeSourceLabel: null,
      items: [
        { name: 'tp',   canonical: 'toilet paper', category: 'personal_care', intent: 'acquire', target: 'shopping' },
        { name: 'pb',   canonical: 'peanut butter', category: 'pantry',       intent: 'acquire', target: 'shopping' },
        { name: 'evoo', canonical: 'olive oil',     category: 'pantry',       intent: 'acquire', target: 'shopping' },
      ],
    },
  },
  // Multi-line, multi-intent — extract EACH line as a separate item.
  // This example exists to make explicit that newline-separated dumps
  // should produce N items, not a single summary item.
  {
    input: 'need garlic\nneed yogurt\nbuy bell pepper for the pigs\nbuy hay\nneed lemons',
    output: {
      intent: 'acquire',
      language: 'en',
      recipeSourceLabel: null,
      items: [
        { name: 'garlic',       canonical: 'garlic',      category: 'produce', intent: 'acquire', target: 'shopping', shelfLifeDays: 90 },
        { name: 'yogurt',       canonical: 'yogurt',      category: 'dairy',   intent: 'acquire', target: 'shopping', shelfLifeDays: 21 },
        { name: 'bell pepper',  canonical: 'bell pepper', category: 'produce', intent: 'acquire', target: 'shopping', shelfLifeDays: 10 },
        { name: 'hay',          canonical: null,          category: 'other',   intent: 'acquire', target: 'shopping' },
        { name: 'lemons',       canonical: 'lemon',       category: 'produce', intent: 'acquire', target: 'shopping', shelfLifeDays: 30 },
      ],
    },
  },
  // Comma-separated single-line list — same N-items rule as newlines.
  {
    input: 'tomatoes, garlic, onion',
    output: {
      intent: 'acquire',
      language: 'en',
      recipeSourceLabel: null,
      items: [
        { name: 'tomatoes', canonical: 'tomato', category: 'produce', intent: 'acquire', target: 'shopping', shelfLifeDays: 7 },
        { name: 'garlic',   canonical: 'garlic', category: 'produce', intent: 'acquire', target: 'shopping', shelfLifeDays: 90 },
        { name: 'onion',    canonical: 'onion',  category: 'produce', intent: 'acquire', target: 'shopping', shelfLifeDays: 30 },
      ],
    },
  },
  // Quantity + unit extraction.
  {
    input: 'buy 2 lemons\n1 kg pasta\na dozen eggs\nhalf a loaf of sourdough\nbig bag of hay',
    output: {
      intent: 'acquire',
      language: 'en',
      recipeSourceLabel: null,
      items: [
        { name: 'lemons',     canonical: 'lemon', category: 'produce', intent: 'acquire', target: 'shopping', qty: 2,    shelfLifeDays: 30 },
        { name: 'pasta',      canonical: 'pasta', category: 'pantry',  intent: 'acquire', target: 'shopping', qty: 1,    unit: 'kg' },
        { name: 'eggs',       canonical: 'egg',   category: 'dairy',   intent: 'acquire', target: 'shopping', qty: 12,   shelfLifeDays: 28 },
        { name: 'sourdough',  canonical: 'bread', category: 'pantry',  intent: 'acquire', target: 'shopping', qty: 0.5,  unit: 'loaf', shelfLifeDays: 7 },
        { name: 'hay',        canonical: null,    category: 'other',   intent: 'acquire', target: 'shopping', qty: 1,    unit: 'bag' },
      ],
    },
  },
  // Recipe context — meal name + explicit ingredients (NOT expansion).
  {
    input: 'want to do shakshuka, need tomatoes and feta',
    output: {
      intent: 'acquire',
      language: 'en',
      recipeSourceLabel: 'shakshuka',
      items: [
        { name: 'tomatoes', canonical: 'tomato', category: 'produce', intent: 'acquire', target: 'shopping', shelfLifeDays: 7,  isRecipeExpansion: false },
        { name: 'feta',     canonical: 'feta',   category: 'dairy',   intent: 'acquire', target: 'shopping', shelfLifeDays: 30, isRecipeExpansion: false },
      ],
    },
  },
  // Turkish — depletion + possession + acquire mix.
  {
    input: 'kahve bitti\nsüt almam lazım\nmatcha aldım\ntp bitti',
    output: {
      intent: 'acquire',
      language: 'tr',
      recipeSourceLabel: null,
      items: [
        { name: 'kahve',  canonical: 'coffee',       category: 'drinks',        intent: 'acquire', target: 'shopping' },
        { name: 'süt',    canonical: 'milk',         category: 'dairy',         intent: 'acquire', target: 'shopping', shelfLifeDays: 7 },
        { name: 'matcha', canonical: null,           category: 'drinks',        intent: 'pantry',  target: 'pantry' },
        { name: 'tp',     canonical: 'toilet paper', category: 'personal_care', intent: 'acquire', target: 'shopping' },
      ],
    },
  },
  // Spanish — depletion ("se acabó", "me falta"), possession ("compré"),
  // explicit need ("necesito"), pet context, abbreviation/canonical.
  {
    input: 'necesito comprar pasta\nme falta café\nse acabó el aceite de oliva\ncompré pan\nno hay heno para los cerditos\nhace falta papel higiénico',
    output: {
      intent: 'acquire',
      language: 'es',
      recipeSourceLabel: null,
      items: [
        { name: 'pasta',           canonical: 'pasta',        category: 'pantry',        intent: 'acquire', target: 'shopping' },
        { name: 'café',            canonical: 'coffee',       category: 'drinks',        intent: 'acquire', target: 'shopping' },
        { name: 'aceite de oliva', canonical: 'olive oil',    category: 'pantry',        intent: 'acquire', target: 'shopping' },
        { name: 'pan',             canonical: 'bread',        category: 'pantry',        intent: 'pantry',  target: 'pantry', shelfLifeDays: 7 },
        { name: 'heno',            canonical: null,           category: 'other',         intent: 'acquire', target: 'shopping' },
        { name: 'papel higiénico', canonical: 'toilet paper', category: 'personal_care', intent: 'acquire', target: 'shopping' },
      ],
    },
  },
  // Out-of-domain — not grocery, return empty.
  {
    input: 'buy stock',
    output: {
      intent: 'unknown',
      language: 'en',
      recipeSourceLabel: null,
      items: [],
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

COMMON ABBREVIATIONS — expand silently to the canonical full name:
- tp / t.p. / tps → toilet paper
- pb → peanut butter
- evoo → olive oil (extra virgin)
- ck / chx → chicken
- veg / veggies → vegetables (or specific veg if listed)
- gf → gluten free (modifier, not item — only if standalone, treat as note)
- df → dairy free (same — modifier)
- og → organic (modifier)
- mayo → mayonnaise
- shroom / shrooms → mushroom
- decaf → decaf coffee
- soda → soft drink
- ben/ben & jerrys → ice cream
- tp → toilet paper (yes, listed twice on purpose — this one matters)
Set the item's "name" to the user's original abbreviation (so the UI shows
what they typed) and "canonical" to the expanded canonical key. The user
should never have to see the expansion unless they ask for it.

CRITICAL — DEPLETION VS POSSESSION:
"out of X", "running low on X", "finished my X", "we ran out", "almost out of X"
all mean the user NEEDS TO BUY more — these are ACQUIRE intent, target=shopping.
ONLY use intent=pantry / target=pantry when the user confirms PRESENT possession:
"I have X", "just bought X", "got X", "picked up X", "already have X". When in
doubt, prefer acquire — putting a needed item in pantry by mistake is worse than
putting an owned item in shopping by mistake.

MULTI-LINE + COMMA-SEPARATED INPUT:
When the text contains multiple lines (newline-separated) OR comma/and-separated
list items (e.g. "eggs, milk, bread" or "bananas and oat milk"), treat EACH
entry as a separate item. Do NOT collapse them into a single summary item.
"eggs, milk, bread" should produce THREE items, not one.

QUANTITY + UNIT PARSING:
Extract qty (number) and unit (string) when present. Examples:
- "buy 2 lemons" → qty=2, name="lemons", canonical="lemon"
- "1 kg pasta" → qty=1, unit="kg", name="pasta", canonical="pasta"
- "a dozen eggs" → qty=12, name="eggs", canonical="egg"
- "half a loaf of sourdough" → qty=0.5, unit="loaf", name="sourdough", canonical="bread"
- "big bag of hay" → qty=1, unit="bag", name="hay" (descriptive size kept in unit)
- "small jar of matcha" → qty=1, unit="jar", name="matcha"
- "two bell peppers" → qty=2, name="bell peppers", canonical="bell pepper"
Leave qty/unit unset only when the text gives no quantity signal at all.

RECIPE CONTEXT:
"making pasta tonight, need basil" → recipeSourceLabel="pasta", items=[basil]
isRecipeExpansion=true only for ingredients the user did NOT explicitly list
(i.e. items you'd add via canonical pasta-recipe knowledge). When the user
explicitly lists the ingredients, leave isRecipeExpansion=false but still
populate recipeSourceLabel. "want to do shakshuka, need tomatoes and feta"
→ recipeSourceLabel="shakshuka", items=[tomatoes (explicit), feta (explicit)].

PET FOOD:
"hay for the pigs", "romaine for tontin and pinpon" — these are still grocery
items the user is shopping for; extract them normally. The "for the pets"
phrase is context, not a domain switch.

OUT-OF-DOMAIN:
If the input is clearly not about food/grocery/household supplies (e.g.
"buy stock", "pet a dog", "schedule dentist"), return intent="unknown" and
items=[]. Do NOT hallucinate grocery items from non-grocery text.

LANGUAGE: detect the primary language (en/es/tr/other).

RECIPE EXPANSION: if a single fragment mentions a dish/meal name AND lists its
ingredients, set recipeSourceLabel to the dish name and mark the ingredient items
with isRecipeExpansion: true. Do NOT do recipe expansion across newline-separated
items — those are independent shopping entries, not a recipe.

TARGET:
- "shopping": item should go on shopping list (acquire/plan intents)
- "pantry": item should go to pantry log (pantry intent only)

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
