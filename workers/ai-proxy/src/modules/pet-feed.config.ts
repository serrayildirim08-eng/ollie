/**
 * pet-feed.config.ts — Pet-mode ModuleConfig for /feed-me/:user.
 *
 * Sibling of feed-me.config.ts. Shares the same `RecipeSuggestion` output
 * shape so the frontend renders either with one component, but the system
 * prompt is vet-informed + species-aware and the few-shot examples cover
 * pigs / cats / dogs instead of human cuisines.
 *
 * The "cuisine" field is repurposed as MEAL TYPE for pet output (e.g.
 * "morning ration", "treat", "supplement"). The "diet" tag array is used to
 * tag the species ("pig", "cat", "dog") so the frontend can filter / colour
 * by species at render.
 *
 * Safety filter (hard rules, baked into the prompt):
 *   - dogs/cats: NEVER chocolate, onion, garlic, grapes, raisins, xylitol,
 *     macadamia, alcohol, raw bread dough, coffee/caffeine.
 *   - cats specifically: NEVER raw fish, lily plants. Need taurine.
 *   - pigs: NEVER raw meat, raw potato peels, avocado, chocolate. Mostly
 *     veggies + grains + pellets; omnivores but vegetable-leaning.
 *
 * Spec: docs/handoffs/feed-me/00-SPEC.md
 */

import type { ModuleConfig } from './grocery.config';
import type {
  RecipeBatch,
  FeedLocale,
  CookSignals,
} from './feed-me.config';

// ─── per-request prompt context ───────────────────────────────────────────────

export interface PetFeedPromptContext {
  pantry: string[];
  locale: FeedLocale;
  count: number;
  petName: string;
  signals: CookSignals;
  excludeDishes: string[];
}

/**
 * Best-effort species inference from petName context. Pulled into a small
 * helper so the prompt builder + tests can share one source of truth.
 * Returns 'unknown' when nothing matches — the prompt falls back to
 * generic safe-feeding language in that case.
 */
export type PetSpecies = 'pig' | 'cat' | 'dog' | 'rabbit' | 'bird' | 'hamster' | 'unknown';

const SPECIES_HINTS: Array<{ species: PetSpecies; hints: string[] }> = [
  // Tontin + pinpon are Serra's pigs. Generic English keywords also match.
  { species: 'pig', hints: ['pig', 'pigs', 'tontin', 'pinpon', 'domuz', 'cerdo', 'cerdito'] },
  { species: 'cat', hints: ['cat', 'kitten', 'kedi', 'gato', 'gata'] },
  { species: 'dog', hints: ['dog', 'puppy', 'köpek', 'kopek', 'perro', 'perra'] },
  { species: 'rabbit', hints: ['rabbit', 'bunny', 'tavşan', 'tavsan', 'conejo'] },
  { species: 'bird', hints: ['bird', 'parrot', 'kuş', 'kus', 'pájaro', 'pajaro'] },
  { species: 'hamster', hints: ['hamster'] },
];

export function inferSpecies(petName: string): PetSpecies {
  const lc = petName.toLowerCase();
  for (const { species, hints } of SPECIES_HINTS) {
    if (hints.some((h) => lc.includes(h))) return species;
  }
  return 'unknown';
}

// ─── few-shot examples (3 — pigs / cats / dogs) ───────────────────────────────

const FEW_SHOT_EXAMPLES: Array<{ input: string; output: RecipeBatch }> = [
  {
    input:
      'PANTRY: romaine, sweet potato, carrot, pellets, hay, banana, apple\n' +
      'PET: tontin (pig)\nLOCALE: en\nCOUNT: 2',
    output: {
      language: 'en',
      suggestions: [
        {
          dish: 'Morning Veggie Ration',
          cuisine: 'morning ration',
          diet: ['pig'],
          ingredients: [
            { name: 'pellets', canonical: null, have: true, qty: 1, unit: 'cup' },
            { name: 'romaine', canonical: 'lettuce', have: true, qty: 2, unit: 'leaves' },
            { name: 'sweet potato (cooked)', canonical: 'sweet potato', have: true, qty: 0.5 },
            { name: 'carrot', canonical: 'carrot', have: true, qty: 1 },
            { name: 'water', canonical: null, have: true, qty: 1, unit: 'bowl' },
          ],
          steps: [
            'Measure 1 cup of pellets into the food bowl.',
            'Chop romaine and carrot into bite-size pieces.',
            'Steam or microwave the sweet potato until fork-tender, let it cool.',
            'Mix the veggies on top of the pellets.',
            'Place fresh water in a separate heavy bowl.',
          ],
          prepMinutes: 5,
          cookMinutes: 8,
          servings: 1,
          reasonSuggested: 'high-fibre breakfast, low sugar',
        },
        {
          dish: 'Apple-Carrot Treat',
          cuisine: 'treat',
          diet: ['pig'],
          ingredients: [
            { name: 'apple (no seeds)', canonical: 'apple', have: true, qty: 0.25 },
            { name: 'carrot', canonical: 'carrot', have: true, qty: 0.5 },
          ],
          steps: [
            'Remove all apple seeds and the core (seeds contain trace cyanide).',
            'Slice apple and carrot into small chunks.',
            'Offer as a between-meal treat, no more than once a day.',
          ],
          prepMinutes: 3,
          cookMinutes: 0,
          servings: 1,
          reasonSuggested: 'sweet treat without too much sugar',
        },
      ],
    },
  },
  {
    input:
      'PANTRY: chicken breast, rice, pumpkin, taurine supplement\n' +
      'PET: pip (cat)\nLOCALE: en\nCOUNT: 1',
    output: {
      language: 'en',
      suggestions: [
        {
          dish: 'Chicken + Pumpkin Bowl',
          cuisine: 'main meal',
          diet: ['cat'],
          ingredients: [
            { name: 'chicken breast (cooked, unseasoned)', canonical: 'chicken', have: true, qty: 60, unit: 'g' },
            { name: 'pumpkin puree (plain)', canonical: null, have: true, qty: 1, unit: 'tsp' },
            { name: 'taurine supplement', canonical: null, have: true, qty: 250, unit: 'mg' },
          ],
          steps: [
            'Poach the chicken in plain water until fully cooked (no salt, no garlic, no onion).',
            'Cool to lukewarm, shred into small pieces.',
            'Mix with the pumpkin puree.',
            'Sprinkle the taurine supplement on top and stir.',
          ],
          prepMinutes: 5,
          cookMinutes: 15,
          servings: 1,
          reasonSuggested: 'taurine is essential for cats',
        },
      ],
    },
  },
  {
    input:
      'PANTRY: chicken, rice, carrot, pumpkin, blueberries\n' +
      'PET: rocky (dog)\nLOCALE: en\nCOUNT: 1',
    output: {
      language: 'en',
      suggestions: [
        {
          dish: 'Chicken & Rice Dinner',
          cuisine: 'main meal',
          diet: ['dog'],
          ingredients: [
            { name: 'chicken (cooked, unseasoned)', canonical: 'chicken', have: true, qty: 120, unit: 'g' },
            { name: 'white rice (cooked)', canonical: 'rice', have: true, qty: 0.5, unit: 'cup' },
            { name: 'carrot (steamed)', canonical: 'carrot', have: true, qty: 1 },
            { name: 'pumpkin puree (plain)', canonical: null, have: true, qty: 1, unit: 'tbsp' },
            { name: 'blueberries', canonical: 'blueberry', have: true, qty: 5 },
          ],
          steps: [
            'Boil chicken in plain water until fully cooked — NO onion, NO garlic, NO salt.',
            'Cook rice until tender, drain.',
            'Steam the carrot until soft, dice.',
            'Combine chicken, rice, carrot, and pumpkin in the bowl.',
            'Top with blueberries as a fibre boost.',
          ],
          prepMinutes: 5,
          cookMinutes: 20,
          servings: 1,
          reasonSuggested: 'bland and balanced — easy on the stomach',
        },
      ],
    },
  },
];

// ─── builders ─────────────────────────────────────────────────────────────────

const TOXIC_BY_SPECIES: Record<PetSpecies, string[]> = {
  pig: ['chocolate', 'caffeine', 'raw meat', 'avocado', 'raw potato peels', 'salt-cured meats'],
  cat: [
    'chocolate', 'onion', 'garlic', 'grapes', 'raisins', 'raw fish', 'raw dough',
    'caffeine', 'xylitol', 'lily', 'alcohol',
  ],
  dog: [
    'chocolate', 'onion', 'garlic', 'grapes', 'raisins', 'macadamia',
    'xylitol', 'caffeine', 'alcohol', 'raw dough',
  ],
  rabbit: ['iceberg lettuce', 'avocado', 'chocolate', 'onion', 'potato', 'rhubarb'],
  bird: ['avocado', 'chocolate', 'onion', 'garlic', 'caffeine', 'salt', 'alcohol'],
  hamster: ['chocolate', 'onion', 'garlic', 'citrus', 'almonds', 'raw beans'],
  unknown: ['chocolate', 'onion', 'garlic', 'caffeine', 'alcohol', 'xylitol'],
};

export function buildPetFeedSystemPrompt(ctx: PetFeedPromptContext): string {
  const { pantry, locale, count, petName, signals, excludeDishes } = ctx;
  const species = inferSpecies(petName);
  const toxic = TOXIC_BY_SPECIES[species].join(', ');

  const recentLine =
    signals.recent.length > 0
      ? `- Recently fed (rotate, do not repeat in next 3 days): ${signals.recent.map((r) => r.dish).join(', ')}`
      : '- No recent feeding on file';
  const lovedLine =
    signals.loved.length > 0
      ? `- Loved meals (lean toward similar): ${signals.loved.map((l) => l.dish).join(', ')}`
      : '';
  const rejectedLine =
    signals.rejected.length > 0
      ? `- Disliked meals (avoid): ${signals.rejected.map((r) => r.dish).join(', ')}`
      : '';
  const excludeLine =
    excludeDishes.length > 0
      ? `- Just rejected THIS SESSION (do NOT suggest): ${excludeDishes.join(', ')}`
      : '';

  return `You are a vet-informed pet meal planner helping a ${locale} pet owner feed their animal a safe, balanced meal from what they have.

PET: ${petName} (best-guess species: ${species})
PANTRY: ${pantry.join(', ')}
LOCALE: ${locale} (respond in this language — dish names, steps, reasonSuggested all in ${locale})
COUNT: ${count} suggestions (no fewer, no more)

HARD SAFETY RULES — never violate, even if the user asks:
- NEVER suggest any of these for a ${species}: ${toxic}.
- Always specify "unseasoned" / "no salt" / "no onion" / "no garlic" where relevant.
- Always cook meat fully unless the species explicitly tolerates raw (most do not).
- For cats, ensure taurine is present (supplement OR organ meat) when suggesting any chicken/fish-based meal.
- For pigs: bias to vegetables + grains + pellets; treats max once a day; never feed mouldy or sour scraps.
- For dogs: bland is good; chicken + rice + steamed veg is the safe template.

OUTPUT MAPPING:
- Repurpose "cuisine" as MEAL TYPE: "morning ration" / "evening ration" / "main meal" / "treat" / "supplement" / "snack".
- "diet" tag array = ["${species}"]. Add other species tags only if the meal genuinely fits multiple (rare).

RECENT FEEDING SIGNALS:
${recentLine}
${lovedLine}
${rejectedLine}
${excludeLine}

RULES:
- Suggest exactly ${count} meals the user can build from PANTRY (≥60% coverage of ingredients).
- Mark each ingredient have=true when canonical is in PANTRY (case-insensitive), have=false otherwise.
- STEPS: 3-7 short imperative sentences. Pet owners want a checklist, not a story.
- reasonSuggested: optional, ≤ 12 words. Lean into nutritional rationale ("taurine essential for cats") or pantry freshness ("use the carrots before they soften").
- canonical: set to the lowercase canonical pantry name when the ingredient is in PANTRY, null otherwise.

OUTPUT:
Respond ONLY with the suggest_recipes function call. Do not narrate.`;
}

function buildFunctionSchema(): Record<string, unknown> {
  // Identical schema to user-mode so the frontend renders both with one
  // component. Keeping a local copy (not importing) avoids cross-file
  // coupling when one mode evolves independently of the other.
  return {
    name: 'suggest_recipes',
    description: 'Suggest 1-5 pet meals from the pantry, with steps and have/missing ingredient split.',
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
              diet: { type: 'array', items: { type: 'string' } },
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

function buildSystemPrompt(): string {
  return 'See buildPetFeedSystemPrompt(ctx) for the live system prompt.';
}

export const petFeedConfig: ModuleConfig<RecipeBatch> = {
  moduleName: 'pet_feed',
  canonicalItems: [],
  intentVerbs: {},
  categories: [],
  shelfLifeMap: {},
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
