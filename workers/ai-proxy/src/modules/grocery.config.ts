/**
 * grocery.config.ts — Module-specific config for `/route/grocery`.
 *
 * This is the ONLY grocery-specific file in the routing infrastructure.
 * The worker endpoint, cache lookup, and PII scrub are all module-agnostic;
 * this pluggable config drives the Gemini prompt and structured output schema.
 *
 * Spec: docs/MODULE_AGNOSTIC_AI.md
 */

/**
 * Mutation action — added 2026-05-22 for list mutation commands
 * (remove / check / move_to_pantry). Defaults to 'add' so existing
 * Gemini cache rows and downstream consumers without `action` keep
 * working unchanged.
 */
export type GroceryAction = 'add' | 'remove' | 'check' | 'move_to_pantry';

export interface GroceryItem {
  name: string;
  canonical: string | null;
  category: string;
  intent: 'acquire' | 'plan' | 'pantry' | 'unknown' | 'edit';
  target: 'shopping' | 'pantry';
  /**
   * The mutation to apply to the targeted slice.
   *   - 'add' (default): append to slice.
   *   - 'remove': delete a matching item from slice.
   *   - 'check': mark a matching item as bought in shopping.
   *   - 'move_to_pantry': remove from shopping AND append to pantry
   *     (the "scratch X, got some" case).
   * Items without an `action` field are treated as 'add' (backward compat).
   */
  action?: GroceryAction;
  qty?: number;
  unit?: string;
  shelfLifeDays?: number;
  isRecipeExpansion?: boolean;
}

export interface GroceryClassification {
  items: GroceryItem[];
  /** Top-level intent of the dump fragment. */
  intent: 'acquire' | 'plan' | 'pantry' | 'unknown' | 'edit';
  /** Detected language of the raw text. */
  language: 'en' | 'es' | 'tr' | 'other';
  /** Non-null when the fragment describes a dish/recipe — kept for recipe expansion. */
  recipeSourceLabel?: string | null;
}

/**
 * List context passed alongside `text` on /route/grocery so Gemini can
 * disambiguate "remove pasta" when multiple pastas exist, expand
 * "everything except X" against the actual list, and decide where
 * "I finished X" applies (pantry remove vs shopping add).
 *
 * Capped to 50 items per slice at the worker boundary to keep prompt
 * tokens bounded.
 */
export interface GroceryListContext {
  shoppingItems?: Array<{ name: string; canonical?: string | null }>;
  pantryItems?: Array<{ name: string; canonical?: string | null }>;
}

/** Soft cap on list-context entries injected into the prompt. */
export const LIST_CONTEXT_CAP = 50;

export type GroceryIntentVerb = {
  acquire: string[];
  plan: string[];
  pantry: string[];
};

export interface ModuleConfig<C, Ctx = unknown> {
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
  /**
   * Build the Gemini system prompt for this module. Optional `context`
   * argument is appended to the prompt when present (e.g. current
   * shopping + pantry lists for grocery mutation disambiguation).
   */
  buildSystemPrompt(context?: Ctx): string;
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

/**
 * Allowed category bucket for `SHELF_LIFE_DETAIL`. Decoupled from the
 * existing `CATEGORIES` constant (which is the Gemini classification taxonomy
 * used by the prompt) — these are STORAGE buckets used by the pantry-aging
 * logic to colour-code visual fade. Keeping them small + stable so the
 * consumer can switch on the union exhaustively.
 */
export type ShelfCategory =
  | 'dairy'
  | 'produce'
  | 'meat'
  | 'pantry'
  | 'frozen'
  | 'bakery'
  | 'beverage'
  | 'cleaning'
  | 'personal_care'
  | 'wellness'
  | 'pet';

export interface ShelfLifeEntry {
  /**
   * Default shelf life in days. For ambient-stable items (canned, dried,
   * sealed) this is the SEALED-in-pantry value. For perishables it is the
   * fridge value at typical home temps.
   *
   * RESEARCH POLICY (locked 2026-05-30):
   *   - Primary source: USDA FoodKeeper App + FoodSafety.gov Cold Storage Chart.
   *   - Secondary: USDA fact sheets, manufacturer guidelines, EWG (cleaners),
   *     Mayo Clinic / Cleveland Clinic (OTC).
   *   - When sources disagree on a range, pick the LOWER bound — better to
   *     fade a day early than to miss a spoiled item.
   *   - "Indefinite" claims (honey, salt, sugar, dry rice, dry beans) capped
   *     at 365 because the aging UI needs a finite tick.
   */
  days: number;
  /** Storage bucket — drives icon/colour in the aging UI. */
  category: ShelfCategory;
  /**
   * Once-opened shelf life in days. Populate only when "sealed" and "opened"
   * materially differ (milk doesn't — it's always fridge; mayo does — sealed
   * pantry-stable, opened fridge ~60d).
   */
  openedDays?: number;
  /** Free-text source / caveat. Short. Anchored to a citation when load-bearing. */
  note?: string;
}

/**
 * SHELF_LIFE_DETAIL — rich entry per canonical. The flat `SHELF_LIFE_MAP`
 * below is auto-derived from this so legacy consumers (replenishment.ts)
 * keep working with `Record<string, number>`.
 *
 * Source convention in `note`:
 *   USDA = USDA FoodKeeper App or USDA fact sheet
 *   FSG  = FoodSafety.gov Cold Food Storage Chart
 *   MFG  = manufacturer guideline (Kraft, Heinz, etc.)
 *   EWG  = Environmental Working Group replacement cycle guidance
 *   CC   = Cleveland Clinic / Mayo Clinic / WebMD wellness
 *   CONV = industry convention when no single authoritative source applies
 */
export const SHELF_LIFE_DETAIL: Record<string, ShelfLifeEntry> = {
  // ─── DAIRY ──────────────────────────────────────────────────────────────
  milk:               { days: 7,   category: 'dairy', openedDays: 7,   note: 'USDA fridge 1wk past sell-by' },
  'whole milk':       { days: 7,   category: 'dairy', openedDays: 7,   note: 'USDA' },
  'skim milk':        { days: 7,   category: 'dairy', openedDays: 7,   note: 'USDA' },
  'lowfat milk':      { days: 7,   category: 'dairy', openedDays: 7,   note: 'USDA' },
  '2% milk':          { days: 7,   category: 'dairy', openedDays: 7,   note: 'USDA' },
  'oat milk':         { days: 10,  category: 'dairy', openedDays: 7,   note: 'MFG Oatly opened 7d' },
  'almond milk':      { days: 10,  category: 'dairy', openedDays: 7,   note: 'MFG Silk opened 7d' },
  'soy milk':         { days: 10,  category: 'dairy', openedDays: 7,   note: 'MFG opened 7d' },
  'coconut milk':     { days: 10,  category: 'dairy', openedDays: 5,   note: 'MFG opened 5d' },
  'cashew milk':      { days: 10,  category: 'dairy', openedDays: 7,   note: 'MFG' },
  'rice milk':        { days: 10,  category: 'dairy', openedDays: 7,   note: 'MFG' },
  'lactose-free milk':{ days: 7,   category: 'dairy', openedDays: 7,   note: 'USDA' },
  'shelf-stable milk':{ days: 180, category: 'dairy', openedDays: 7,   note: 'UHT MFG, opened acts like fresh' },
  buttermilk:         { days: 14,  category: 'dairy', openedDays: 14,  note: 'USDA' },
  yogurt:             { days: 21,  category: 'dairy', openedDays: 7,   note: 'USDA 1-2wk past sell-by' },
  'greek yogurt':     { days: 21,  category: 'dairy', openedDays: 7,   note: 'USDA' },
  'plant yogurt':     { days: 14,  category: 'dairy', openedDays: 7,   note: 'MFG' },
  kefir:              { days: 14,  category: 'dairy', openedDays: 10,  note: 'MFG Lifeway' },
  ayran:              { days: 7,   category: 'dairy', openedDays: 3,   note: 'MFG Pinar; cultured drink' },
  labneh:             { days: 21,  category: 'dairy', openedDays: 7,   note: 'MFG' },
  cheese:             { days: 30,  category: 'dairy', openedDays: 21,  note: 'USDA hard cheese opened 3-4wk' },
  cheddar:            { days: 42,  category: 'dairy', openedDays: 28,  note: 'USDA 6wk sealed, 4wk opened' },
  mozzarella:         { days: 14,  category: 'dairy', openedDays: 7,   note: 'USDA fresh 1wk opened' },
  'fresh mozzarella': { days: 7,   category: 'dairy', openedDays: 3,   note: 'USDA brined' },
  parmesan:           { days: 90,  category: 'dairy', openedDays: 60,  note: 'USDA hard aged' },
  feta:               { days: 30,  category: 'dairy', openedDays: 14,  note: 'USDA brined' },
  gouda:              { days: 60,  category: 'dairy', openedDays: 28,  note: 'USDA' },
  brie:               { days: 14,  category: 'dairy', openedDays: 7,   note: 'USDA soft cheese' },
  camembert:          { days: 14,  category: 'dairy', openedDays: 7,   note: 'USDA soft cheese' },
  ricotta:            { days: 7,   category: 'dairy', openedDays: 5,   note: 'USDA fresh cheese' },
  'cottage cheese':   { days: 10,  category: 'dairy', openedDays: 7,   note: 'USDA' },
  'cream cheese':     { days: 14,  category: 'dairy', openedDays: 10,  note: 'USDA' },
  'goat cheese':      { days: 14,  category: 'dairy', openedDays: 7,   note: 'USDA' },
  halloumi:           { days: 30,  category: 'dairy', openedDays: 7,   note: 'MFG sealed; opened 1wk' },
  manchego:           { days: 60,  category: 'dairy', openedDays: 28,  note: 'USDA hard cheese' },
  provolone:          { days: 30,  category: 'dairy', openedDays: 21,  note: 'USDA' },
  swiss:              { days: 42,  category: 'dairy', openedDays: 28,  note: 'USDA' },
  'blue cheese':      { days: 21,  category: 'dairy', openedDays: 7,   note: 'USDA' },
  beyaz_peynir:       { days: 30,  category: 'dairy', openedDays: 14,  note: 'TR equivalent of feta' },
  kasar:              { days: 60,  category: 'dairy', openedDays: 28,  note: 'TR aged sheep cheese' },
  butter:             { days: 60,  category: 'dairy', openedDays: 30,  note: 'USDA fridge 1-2mo' },
  ghee:               { days: 365, category: 'dairy', openedDays: 90,  note: 'MFG sealed pantry; opened still very stable' },
  cream:              { days: 10,  category: 'dairy', openedDays: 5,   note: 'USDA heavy cream' },
  'heavy cream':      { days: 10,  category: 'dairy', openedDays: 5,   note: 'USDA' },
  'sour cream':       { days: 21,  category: 'dairy', openedDays: 10,  note: 'USDA' },
  'whipped cream':    { days: 5,   category: 'dairy', openedDays: 3,   note: 'CONV' },
  'half and half':    { days: 10,  category: 'dairy', openedDays: 7,   note: 'USDA' },
  'condensed milk':   { days: 365, category: 'pantry', openedDays: 5,  note: 'MFG sealed; opened fridge ~5d' },
  'evaporated milk':  { days: 365, category: 'pantry', openedDays: 5,  note: 'MFG sealed; opened fridge ~5d' },

  // ─── PRODUCE — FRUIT ────────────────────────────────────────────────────
  apple:              { days: 30,  category: 'produce', note: 'USDA fridge 4-6wk' },
  'green apple':      { days: 30,  category: 'produce', note: 'USDA' },
  banana:             { days: 5,   category: 'produce', note: 'USDA counter 2-5d ripe' },
  orange:             { days: 21,  category: 'produce', note: 'USDA fridge 3wk' },
  mandarin:           { days: 14,  category: 'produce', note: 'USDA' },
  clementine:         { days: 14,  category: 'produce', note: 'USDA' },
  tangerine:          { days: 14,  category: 'produce', note: 'USDA' },
  grapefruit:         { days: 21,  category: 'produce', note: 'USDA' },
  lemon:              { days: 30,  category: 'produce', note: 'USDA fridge 3-4wk' },
  lime:               { days: 21,  category: 'produce', note: 'USDA' },
  strawberry:         { days: 5,   category: 'produce', note: 'USDA fridge 5-7d' },
  blueberry:          { days: 7,   category: 'produce', note: 'USDA' },
  raspberry:          { days: 3,   category: 'produce', note: 'USDA 2-3d' },
  blackberry:         { days: 3,   category: 'produce', note: 'USDA' },
  cranberry:          { days: 21,  category: 'produce', note: 'USDA' },
  grapes:             { days: 7,   category: 'produce', note: 'USDA' },
  'red grapes':       { days: 7,   category: 'produce', note: 'USDA' },
  'green grapes':     { days: 7,   category: 'produce', note: 'USDA' },
  watermelon:         { days: 14,  category: 'produce', openedDays: 4, note: 'USDA whole 1-2wk; cut 3-4d' },
  cantaloupe:         { days: 7,   category: 'produce', openedDays: 4, note: 'USDA' },
  honeydew:           { days: 7,   category: 'produce', openedDays: 4, note: 'USDA' },
  melon:              { days: 7,   category: 'produce', openedDays: 4, note: 'USDA generic melon' },
  peach:              { days: 5,   category: 'produce', note: 'USDA fridge 3-5d' },
  nectarine:          { days: 5,   category: 'produce', note: 'USDA' },
  pear:               { days: 5,   category: 'produce', note: 'USDA fridge 5-7d once ripe' },
  plum:               { days: 5,   category: 'produce', note: 'USDA' },
  apricot:            { days: 5,   category: 'produce', note: 'USDA' },
  cherry:             { days: 4,   category: 'produce', note: 'USDA 3-7d, lower bound' },
  mango:              { days: 5,   category: 'produce', note: 'USDA fridge once ripe' },
  pineapple:          { days: 5,   category: 'produce', openedDays: 5, note: 'USDA whole 2-3d counter; cut 5-7d fridge' },
  kiwi:               { days: 14,  category: 'produce', note: 'USDA' },
  avocado:            { days: 3,   category: 'produce', note: 'USDA ripe 2-3d' },
  pomegranate:        { days: 30,  category: 'produce', note: 'USDA fridge ~2mo whole; conservative' },
  fig:                { days: 3,   category: 'produce', note: 'USDA fresh fig 2-3d' },
  'dried fig':        { days: 180, category: 'pantry', note: 'MFG sealed' },
  date:               { days: 180, category: 'pantry', note: 'USDA dried fruit pantry' },
  'medjool date':     { days: 180, category: 'pantry', note: 'MFG' },
  persimmon:          { days: 5,   category: 'produce', note: 'CONV' },
  papaya:             { days: 5,   category: 'produce', note: 'USDA' },
  passion_fruit:      { days: 7,   category: 'produce', note: 'CONV' },
  guava:              { days: 5,   category: 'produce', note: 'CONV' },
  lychee:             { days: 5,   category: 'produce', note: 'CONV' },
  rhubarb:            { days: 5,   category: 'produce', note: 'USDA' },
  quince:             { days: 14,  category: 'produce', note: 'CONV' },
  starfruit:          { days: 5,   category: 'produce', note: 'CONV' },
  dragonfruit:        { days: 5,   category: 'produce', note: 'CONV' },
  'kiwi berry':       { days: 5,   category: 'produce', note: 'CONV' },
  'dried apricot':    { days: 180, category: 'pantry', note: 'MFG' },
  'dried cranberry':  { days: 365, category: 'pantry', note: 'MFG' },
  raisin:             { days: 365, category: 'pantry', note: 'MFG' },
  prune:              { days: 180, category: 'pantry', note: 'MFG' },
  'dried mango':      { days: 180, category: 'pantry', note: 'MFG' },

  // ─── PRODUCE — VEG ──────────────────────────────────────────────────────
  tomato:             { days: 7,   category: 'produce', note: 'USDA counter ripe 3-5d; fridge 1wk' },
  'cherry tomato':    { days: 7,   category: 'produce', note: 'USDA' },
  'roma tomato':      { days: 7,   category: 'produce', note: 'USDA' },
  'heirloom tomato':  { days: 5,   category: 'produce', note: 'USDA softer skin, shorter' },
  onion:              { days: 30,  category: 'produce', note: 'USDA dry storage 1-2mo' },
  'red onion':        { days: 30,  category: 'produce', note: 'USDA' },
  'yellow onion':     { days: 30,  category: 'produce', note: 'USDA' },
  'white onion':      { days: 30,  category: 'produce', note: 'USDA' },
  'spring onion':     { days: 7,   category: 'produce', note: 'USDA' },
  'green onion':      { days: 7,   category: 'produce', note: 'USDA' },
  scallion:           { days: 7,   category: 'produce', note: 'USDA' },
  shallot:            { days: 30,  category: 'produce', note: 'USDA' },
  garlic:             { days: 90,  category: 'produce', note: 'USDA whole bulb 3-5mo dry; conservative 3mo' },
  'garlic bulb':      { days: 90,  category: 'produce', note: 'USDA' },
  potato:             { days: 30,  category: 'produce', note: 'USDA cool dark 1-2mo' },
  'sweet potato':     { days: 21,  category: 'produce', note: 'USDA cool 3-4wk' },
  'baby potato':      { days: 21,  category: 'produce', note: 'USDA smaller; shorter' },
  carrot:             { days: 21,  category: 'produce', note: 'USDA fridge 3-4wk' },
  'baby carrot':      { days: 14,  category: 'produce', note: 'USDA' },
  celery:             { days: 14,  category: 'produce', note: 'USDA 1-2wk' },
  cucumber:           { days: 7,   category: 'produce', note: 'USDA 1wk' },
  zucchini:           { days: 7,   category: 'produce', note: 'USDA' },
  squash:             { days: 14,  category: 'produce', note: 'USDA summer squash' },
  'butternut squash': { days: 30,  category: 'produce', note: 'USDA winter squash 1mo cool' },
  pumpkin:            { days: 60,  category: 'produce', note: 'USDA whole cool 2-3mo' },
  'bell pepper':      { days: 10,  category: 'produce', note: 'USDA 1-2wk; lower bound' },
  'red pepper':       { days: 10,  category: 'produce', note: 'USDA' },
  'green pepper':     { days: 10,  category: 'produce', note: 'USDA' },
  'yellow pepper':    { days: 10,  category: 'produce', note: 'USDA' },
  'orange pepper':    { days: 10,  category: 'produce', note: 'USDA' },
  chili:              { days: 14,  category: 'produce', note: 'USDA fresh hot pepper' },
  jalapeno:           { days: 14,  category: 'produce', note: 'USDA' },
  serrano:            { days: 14,  category: 'produce', note: 'USDA' },
  habanero:           { days: 14,  category: 'produce', note: 'USDA' },
  eggplant:           { days: 7,   category: 'produce', note: 'USDA 5-7d' },
  broccoli:           { days: 5,   category: 'produce', note: 'USDA 3-5d' },
  cauliflower:        { days: 7,   category: 'produce', note: 'USDA 1wk' },
  cabbage:            { days: 30,  category: 'produce', note: 'USDA fridge 3-5wk' },
  'red cabbage':      { days: 30,  category: 'produce', note: 'USDA' },
  'napa cabbage':     { days: 14,  category: 'produce', note: 'USDA' },
  kale:               { days: 7,   category: 'produce', note: 'USDA' },
  spinach:            { days: 5,   category: 'produce', note: 'USDA 3-5d' },
  arugula:            { days: 5,   category: 'produce', note: 'USDA' },
  lettuce:            { days: 7,   category: 'produce', note: 'USDA iceberg 1wk' },
  'romaine lettuce':  { days: 7,   category: 'produce', note: 'USDA' },
  'iceberg lettuce':  { days: 7,   category: 'produce', note: 'USDA' },
  'mixed greens':     { days: 5,   category: 'produce', note: 'USDA pre-washed 3-5d' },
  cilantro:           { days: 7,   category: 'produce', note: 'USDA herb 7-10d' },
  parsley:            { days: 7,   category: 'produce', note: 'USDA' },
  dill:               { days: 7,   category: 'produce', note: 'USDA' },
  mint:               { days: 7,   category: 'produce', note: 'USDA' },
  basil:              { days: 5,   category: 'produce', note: 'USDA delicate herb' },
  rosemary:           { days: 14,  category: 'produce', note: 'USDA hardy herb' },
  thyme:              { days: 14,  category: 'produce', note: 'USDA' },
  sage:               { days: 14,  category: 'produce', note: 'USDA' },
  oregano:            { days: 7,   category: 'produce', note: 'USDA fresh' },
  chives:             { days: 7,   category: 'produce', note: 'USDA' },
  leek:               { days: 14,  category: 'produce', note: 'USDA 1-2wk' },
  asparagus:          { days: 4,   category: 'produce', note: 'USDA 3-4d' },
  mushroom:           { days: 7,   category: 'produce', note: 'USDA 4-7d; conservative upper' },
  'button mushroom':  { days: 7,   category: 'produce', note: 'USDA' },
  'cremini mushroom': { days: 7,   category: 'produce', note: 'USDA' },
  'portobello':       { days: 7,   category: 'produce', note: 'USDA' },
  'shiitake':         { days: 10,  category: 'produce', note: 'USDA' },
  'oyster mushroom':  { days: 7,   category: 'produce', note: 'USDA' },
  corn:               { days: 3,   category: 'produce', note: 'USDA fresh on cob 1-3d' },
  'corn on the cob':  { days: 3,   category: 'produce', note: 'USDA' },
  beet:               { days: 21,  category: 'produce', note: 'USDA 2-3wk' },
  radish:             { days: 14,  category: 'produce', note: 'USDA' },
  turnip:             { days: 14,  category: 'produce', note: 'USDA' },
  parsnip:            { days: 21,  category: 'produce', note: 'USDA' },
  'ginger root':      { days: 21,  category: 'produce', note: 'USDA fridge 3-4wk' },
  ginger:             { days: 21,  category: 'produce', note: 'USDA' },
  galangal:           { days: 21,  category: 'produce', note: 'CONV' },
  turmeric_root:      { days: 21,  category: 'produce', note: 'CONV' },
  fennel:             { days: 10,  category: 'produce', note: 'USDA' },
  artichoke:          { days: 7,   category: 'produce', note: 'USDA' },
  okra:               { days: 4,   category: 'produce', note: 'USDA 3-4d' },
  'brussels sprouts': { days: 7,   category: 'produce', note: 'USDA' },
  'bok choy':         { days: 5,   category: 'produce', note: 'USDA' },
  endive:             { days: 5,   category: 'produce', note: 'USDA' },
  watercress:         { days: 5,   category: 'produce', note: 'USDA' },
  microgreens:        { days: 5,   category: 'produce', note: 'CONV' },
  alfalfa_sprouts:    { days: 3,   category: 'produce', note: 'USDA sprouts very perishable' },
  'green beans':      { days: 5,   category: 'produce', note: 'USDA 3-5d' },
  snap_peas:          { days: 5,   category: 'produce', note: 'USDA' },
  snow_peas:          { days: 5,   category: 'produce', note: 'USDA' },
  rutabaga:           { days: 21,  category: 'produce', note: 'USDA' },
  jicama:             { days: 14,  category: 'produce', note: 'USDA' },
  kohlrabi:           { days: 14,  category: 'produce', note: 'USDA' },
  'collard greens':   { days: 5,   category: 'produce', note: 'USDA' },
  'swiss chard':      { days: 5,   category: 'produce', note: 'USDA' },
  bok_choi:           { days: 5,   category: 'produce', note: 'USDA' },

  // ─── MEAT / FISH (fresh) ───────────────────────────────────────────────
  chicken:            { days: 2,   category: 'meat', note: 'FSG raw poultry 1-2d fridge' },
  'chicken breast':   { days: 2,   category: 'meat', note: 'FSG' },
  'chicken thigh':    { days: 2,   category: 'meat', note: 'FSG' },
  'chicken wings':    { days: 2,   category: 'meat', note: 'FSG' },
  'whole chicken':    { days: 2,   category: 'meat', note: 'FSG' },
  'ground chicken':   { days: 2,   category: 'meat', note: 'FSG ground 1-2d' },
  beef:               { days: 4,   category: 'meat', note: 'FSG steak 3-5d fridge' },
  steak:              { days: 4,   category: 'meat', note: 'FSG' },
  'beef roast':       { days: 4,   category: 'meat', note: 'FSG' },
  'ground beef':      { days: 2,   category: 'meat', note: 'FSG ground 1-2d' },
  brisket:            { days: 4,   category: 'meat', note: 'FSG' },
  ribeye:             { days: 4,   category: 'meat', note: 'FSG' },
  sirloin:            { days: 4,   category: 'meat', note: 'FSG' },
  'short ribs':       { days: 4,   category: 'meat', note: 'FSG' },
  veal:               { days: 4,   category: 'meat', note: 'FSG' },
  lamb:               { days: 4,   category: 'meat', note: 'FSG' },
  'lamb chops':       { days: 4,   category: 'meat', note: 'FSG' },
  'ground lamb':      { days: 2,   category: 'meat', note: 'FSG' },
  pork:               { days: 4,   category: 'meat', note: 'FSG 3-5d' },
  'pork chops':       { days: 4,   category: 'meat', note: 'FSG' },
  'pork loin':        { days: 4,   category: 'meat', note: 'FSG' },
  'ground pork':      { days: 2,   category: 'meat', note: 'FSG' },
  turkey:             { days: 2,   category: 'meat', note: 'FSG poultry' },
  'turkey breast':    { days: 2,   category: 'meat', note: 'FSG' },
  'ground turkey':    { days: 2,   category: 'meat', note: 'FSG' },
  duck:               { days: 2,   category: 'meat', note: 'FSG' },
  goose:              { days: 2,   category: 'meat', note: 'FSG' },
  rabbit:             { days: 2,   category: 'meat', note: 'FSG' },
  fish:               { days: 2,   category: 'meat', note: 'FSG raw fish 1-2d' },
  salmon:             { days: 2,   category: 'meat', note: 'FSG' },
  tuna:               { days: 2,   category: 'meat', note: 'FSG' },
  'tuna steak':       { days: 2,   category: 'meat', note: 'FSG' },
  'sea bass':         { days: 2,   category: 'meat', note: 'FSG' },
  cod:                { days: 2,   category: 'meat', note: 'FSG' },
  halibut:            { days: 2,   category: 'meat', note: 'FSG' },
  tilapia:            { days: 2,   category: 'meat', note: 'FSG' },
  trout:              { days: 2,   category: 'meat', note: 'FSG' },
  mackerel:           { days: 2,   category: 'meat', note: 'FSG' },
  sardine:            { days: 2,   category: 'meat', note: 'FSG fresh; canned 1825d' },
  anchovy:            { days: 2,   category: 'meat', note: 'FSG fresh' },
  shrimp:             { days: 2,   category: 'meat', note: 'FSG shellfish 1-2d' },
  prawn:              { days: 2,   category: 'meat', note: 'FSG' },
  scallop:            { days: 2,   category: 'meat', note: 'FSG' },
  oyster:             { days: 2,   category: 'meat', note: 'FSG live 5-10d but conservative for shucked' },
  clam:               { days: 2,   category: 'meat', note: 'FSG live; conservative' },
  mussel:             { days: 2,   category: 'meat', note: 'FSG' },
  octopus:            { days: 2,   category: 'meat', note: 'FSG' },
  squid:              { days: 2,   category: 'meat', note: 'FSG' },
  calamari:           { days: 2,   category: 'meat', note: 'FSG' },
  lobster:            { days: 2,   category: 'meat', note: 'FSG' },
  crab:               { days: 2,   category: 'meat', note: 'FSG' },

  // ─── DELI / CURED / SMOKED ─────────────────────────────────────────────
  salami:             { days: 21,  category: 'meat', openedDays: 7,  note: 'USDA cured dry; opened 1wk' },
  prosciutto:         { days: 21,  category: 'meat', openedDays: 5,  note: 'USDA opened 3-5d' },
  jamon:              { days: 21,  category: 'meat', openedDays: 5,  note: 'USDA Spanish cured' },
  pancetta:           { days: 21,  category: 'meat', openedDays: 7,  note: 'USDA' },
  bacon:              { days: 7,   category: 'meat', openedDays: 7,  note: 'USDA sealed 2wk; opened 1wk' },
  ham:                { days: 7,   category: 'meat', openedDays: 5,  note: 'USDA deli 3-5d opened' },
  'deli ham':         { days: 7,   category: 'meat', openedDays: 5,  note: 'USDA' },
  pastirma:           { days: 30,  category: 'meat', openedDays: 14, note: 'TR air-cured; conservative' },
  sucuk:              { days: 30,  category: 'meat', openedDays: 14, note: 'TR cured sausage' },
  chorizo:            { days: 21,  category: 'meat', openedDays: 7,  note: 'USDA dry-cured' },
  pepperoni:          { days: 21,  category: 'meat', openedDays: 21, note: 'USDA dry sausage' },
  mortadella:         { days: 14,  category: 'meat', openedDays: 5,  note: 'USDA' },
  'smoked salmon':    { days: 14,  category: 'meat', openedDays: 5,  note: 'USDA cold-smoked 2wk sealed' },
  'hot dog':          { days: 14,  category: 'meat', openedDays: 7,  note: 'USDA sealed 2wk; opened 1wk' },
  sausage:            { days: 14,  category: 'meat', openedDays: 7,  note: 'USDA' },
  'breakfast sausage':{ days: 5,   category: 'meat', note: 'USDA fresh raw 1-2d; cooked 3-4d (mid)' },
  bratwurst:          { days: 4,   category: 'meat', note: 'USDA fresh sausage' },

  // ─── EGGS / PANTRY PROTEIN ─────────────────────────────────────────────
  egg:                { days: 28,  category: 'dairy', note: 'USDA 3-5wk past pack date' },
  'chicken egg':      { days: 28,  category: 'dairy', note: 'USDA' },
  'quail egg':        { days: 28,  category: 'dairy', note: 'USDA' },
  'duck egg':         { days: 35,  category: 'dairy', note: 'USDA' },
  'liquid eggs':      { days: 7,   category: 'dairy', openedDays: 3, note: 'USDA opened 2-3d' },
  'egg whites':       { days: 7,   category: 'dairy', openedDays: 3, note: 'USDA' },
  tofu:               { days: 7,   category: 'pantry', openedDays: 3, note: 'USDA opened 3-5d, conservative' },
  'silken tofu':      { days: 7,   category: 'pantry', openedDays: 3, note: 'USDA' },
  tempeh:             { days: 7,   category: 'pantry', openedDays: 7, note: 'USDA' },
  seitan:             { days: 7,   category: 'pantry', openedDays: 5, note: 'MFG' },
  natto:              { days: 14,  category: 'pantry', openedDays: 3, note: 'MFG fermented' },

  // ─── GRAINS / STARCHES ─────────────────────────────────────────────────
  rice:               { days: 365, category: 'pantry', note: 'USDA white rice indef; cap 365' },
  'white rice':       { days: 365, category: 'pantry', note: 'USDA' },
  'brown rice':       { days: 180, category: 'pantry', note: 'USDA bran oil rancids 6mo' },
  'basmati rice':     { days: 365, category: 'pantry', note: 'USDA' },
  'jasmine rice':     { days: 365, category: 'pantry', note: 'USDA' },
  'arborio rice':     { days: 365, category: 'pantry', note: 'USDA' },
  'wild rice':        { days: 180, category: 'pantry', note: 'USDA' },
  pasta:              { days: 730, category: 'pantry', note: 'USDA dried 2y sealed' },
  'whole wheat pasta':{ days: 365, category: 'pantry', note: 'USDA shorter due to bran' },
  'gluten free pasta':{ days: 365, category: 'pantry', note: 'MFG' },
  spaghetti:          { days: 730, category: 'pantry', note: 'USDA' },
  penne:              { days: 730, category: 'pantry', note: 'USDA' },
  fettuccine:         { days: 730, category: 'pantry', note: 'USDA' },
  linguine:           { days: 730, category: 'pantry', note: 'USDA' },
  rigatoni:           { days: 730, category: 'pantry', note: 'USDA' },
  fusilli:            { days: 730, category: 'pantry', note: 'USDA' },
  macaroni:           { days: 730, category: 'pantry', note: 'USDA' },
  lasagna:            { days: 730, category: 'pantry', note: 'USDA dried sheets' },
  ravioli:            { days: 5,   category: 'pantry', openedDays: 3, note: 'USDA fresh refrigerated' },
  gnocchi:            { days: 14,  category: 'pantry', note: 'MFG shelf-stable; fresh shorter' },
  ramen:              { days: 365, category: 'pantry', note: 'MFG dried instant' },
  udon:               { days: 14,  category: 'pantry', note: 'MFG fresh; dry would be 365' },
  soba:               { days: 365, category: 'pantry', note: 'MFG dried' },
  bulgur:             { days: 365, category: 'pantry', note: 'USDA' },
  couscous:           { days: 365, category: 'pantry', note: 'USDA' },
  quinoa:             { days: 365, category: 'pantry', note: 'USDA 2-3y but cap 365' },
  oats:               { days: 365, category: 'pantry', note: 'USDA rolled oats 1-2y' },
  'rolled oats':      { days: 365, category: 'pantry', note: 'USDA' },
  'steel cut oats':   { days: 365, category: 'pantry', note: 'USDA' },
  'instant oats':     { days: 365, category: 'pantry', note: 'USDA' },
  granola:            { days: 180, category: 'pantry', openedDays: 30, note: 'MFG sealed 6mo; opened 1mo' },
  cereal:             { days: 365, category: 'pantry', openedDays: 90, note: 'MFG sealed 1y; opened 2-3mo' },
  cornflakes:         { days: 365, category: 'pantry', openedDays: 90, note: 'MFG' },
  muesli:             { days: 365, category: 'pantry', openedDays: 60, note: 'MFG' },
  bread:              { days: 7,   category: 'bakery', note: 'USDA counter 5-7d' },
  'white bread':      { days: 7,   category: 'bakery', note: 'USDA' },
  'whole wheat bread':{ days: 7,   category: 'bakery', note: 'USDA' },
  sourdough:          { days: 5,   category: 'bakery', note: 'CONV no preservatives' },
  pita:               { days: 7,   category: 'bakery', note: 'CONV' },
  lavash:             { days: 5,   category: 'bakery', note: 'CONV' },
  tortilla:           { days: 7,   category: 'bakery', openedDays: 7, note: 'MFG opened fridge 1wk' },
  'corn tortilla':    { days: 7,   category: 'bakery', openedDays: 7, note: 'MFG' },
  'flour tortilla':   { days: 7,   category: 'bakery', openedDays: 7, note: 'MFG' },
  naan:               { days: 5,   category: 'bakery', note: 'CONV' },
  baguette:           { days: 2,   category: 'bakery', note: 'CONV stales fast' },
  ciabatta:           { days: 3,   category: 'bakery', note: 'CONV' },
  brioche:            { days: 5,   category: 'bakery', note: 'CONV' },
  'rye bread':        { days: 7,   category: 'bakery', note: 'USDA' },
  'gluten free bread':{ days: 5,   category: 'bakery', note: 'MFG denser/spoils faster' },
  crackers:           { days: 240, category: 'pantry', openedDays: 30, note: 'MFG sealed 6-12mo; opened 1mo' },
  breadsticks:        { days: 90,  category: 'pantry', openedDays: 21, note: 'MFG' },
  croutons:           { days: 60,  category: 'pantry', openedDays: 7,  note: 'MFG' },
  'rice cakes':       { days: 90,  category: 'pantry', openedDays: 14, note: 'MFG' },
  'matzo':            { days: 365, category: 'pantry', note: 'MFG' },

  // ─── LEGUMES ────────────────────────────────────────────────────────────
  'dried chickpea':   { days: 365, category: 'pantry', note: 'USDA dry 1y+; cap 365' },
  chickpea:           { days: 365, category: 'pantry', note: 'USDA dried' },
  'canned chickpea':  { days: 365, category: 'pantry', openedDays: 4, note: 'USDA 2-5y sealed cap 365; opened fridge 3-4d' },
  'black bean':       { days: 365, category: 'pantry', note: 'USDA dried' },
  'canned black bean':{ days: 365, category: 'pantry', openedDays: 4, note: 'USDA' },
  'kidney bean':      { days: 365, category: 'pantry', note: 'USDA dried' },
  'canned kidney bean':{ days: 365, category: 'pantry', openedDays: 4, note: 'USDA' },
  'white bean':       { days: 365, category: 'pantry', note: 'USDA dried' },
  'cannellini bean':  { days: 365, category: 'pantry', note: 'USDA' },
  'navy bean':        { days: 365, category: 'pantry', note: 'USDA' },
  'pinto bean':       { days: 365, category: 'pantry', note: 'USDA' },
  'red lentil':       { days: 365, category: 'pantry', note: 'USDA' },
  'green lentil':     { days: 365, category: 'pantry', note: 'USDA' },
  'black lentil':     { days: 365, category: 'pantry', note: 'USDA' },
  'beluga lentil':    { days: 365, category: 'pantry', note: 'USDA' },
  lentil:             { days: 365, category: 'pantry', note: 'USDA' },
  'fava bean':        { days: 365, category: 'pantry', note: 'USDA dried' },
  edamame:            { days: 240, category: 'frozen', note: 'USDA frozen' },
  'split pea':        { days: 365, category: 'pantry', note: 'USDA' },
  'mung bean':        { days: 365, category: 'pantry', note: 'USDA' },

  // ─── CANNED / JARRED ───────────────────────────────────────────────────
  'canned tomato':    { days: 365, category: 'pantry', openedDays: 5, note: 'USDA 1y sealed; opened fridge 5-7d' },
  'tomato paste':     { days: 365, category: 'pantry', openedDays: 5, note: 'USDA' },
  'tomato sauce':     { days: 365, category: 'pantry', openedDays: 5, note: 'USDA opened 5-7d' },
  'pasta sauce':      { days: 365, category: 'pantry', openedDays: 5, note: 'USDA' },
  'canned tuna':      { days: 365, category: 'pantry', openedDays: 2, note: 'USDA 3-5y cap 365; opened 1-2d' },
  'canned salmon':    { days: 365, category: 'pantry', openedDays: 2, note: 'USDA' },
  'canned sardine':   { days: 365, category: 'pantry', openedDays: 2, note: 'USDA' },
  'canned anchovy':   { days: 365, category: 'pantry', openedDays: 21, note: 'USDA oil-packed lasts' },
  'canned corn':      { days: 365, category: 'pantry', openedDays: 4, note: 'USDA' },
  'canned peas':      { days: 365, category: 'pantry', openedDays: 4, note: 'USDA' },
  'canned soup':      { days: 365, category: 'pantry', openedDays: 4, note: 'USDA' },
  olives:             { days: 365, category: 'pantry', openedDays: 21, note: 'MFG jarred sealed; opened fridge 3wk' },
  'green olives':     { days: 365, category: 'pantry', openedDays: 21, note: 'MFG' },
  'kalamata olives':  { days: 365, category: 'pantry', openedDays: 21, note: 'MFG' },
  pickles:            { days: 365, category: 'pantry', openedDays: 90, note: 'MFG opened fridge 3mo' },
  'pickled jalapeno': { days: 365, category: 'pantry', openedDays: 90, note: 'MFG' },
  sauerkraut:         { days: 180, category: 'pantry', openedDays: 60, note: 'MFG opened 1-2mo' },
  kimchi:             { days: 90,  category: 'pantry', openedDays: 60, note: 'MFG fermented 3mo opened' },
  jam:                { days: 365, category: 'pantry', openedDays: 180, note: 'USDA sealed 1y; opened fridge 6mo' },
  jelly:              { days: 365, category: 'pantry', openedDays: 180, note: 'USDA' },
  marmalade:          { days: 365, category: 'pantry', openedDays: 180, note: 'USDA' },
  preserves:          { days: 365, category: 'pantry', openedDays: 180, note: 'USDA' },
  honey:              { days: 365, category: 'pantry', note: 'USDA indefinite; cap 365' },
  'peanut butter':    { days: 365, category: 'pantry', openedDays: 90, note: 'USDA sealed 1y; opened 2-3mo' },
  'almond butter':    { days: 240, category: 'pantry', openedDays: 90, note: 'MFG; shorter than PB' },
  'cashew butter':    { days: 240, category: 'pantry', openedDays: 90, note: 'MFG' },
  tahini:             { days: 365, category: 'pantry', openedDays: 180, note: 'MFG opened fridge 6mo' },
  nutella:            { days: 365, category: 'pantry', openedDays: 60, note: 'MFG opened 2mo unrefrigerated' },
  'hazelnut spread':  { days: 365, category: 'pantry', openedDays: 60, note: 'MFG' },
  applesauce:         { days: 365, category: 'pantry', openedDays: 10, note: 'MFG opened fridge 7-10d' },
  'canned peach':     { days: 365, category: 'pantry', openedDays: 5, note: 'USDA' },
  'canned pineapple': { days: 365, category: 'pantry', openedDays: 5, note: 'USDA' },
  'canned pumpkin':   { days: 365, category: 'pantry', openedDays: 5, note: 'USDA' },
  'coconut milk can': { days: 365, category: 'pantry', openedDays: 5, note: 'MFG opened 4-6d' },

  // ─── OILS / VINEGAR / CONDIMENTS ───────────────────────────────────────
  'olive oil':        { days: 365, category: 'pantry', openedDays: 180, note: 'USDA sealed 2y cap; opened 6mo before rancid' },
  'extra virgin olive oil': { days: 365, category: 'pantry', openedDays: 180, note: 'USDA' },
  'sunflower oil':    { days: 365, category: 'pantry', openedDays: 180, note: 'MFG' },
  'vegetable oil':    { days: 365, category: 'pantry', openedDays: 180, note: 'MFG' },
  'canola oil':       { days: 365, category: 'pantry', openedDays: 180, note: 'MFG' },
  'sesame oil':       { days: 365, category: 'pantry', openedDays: 180, note: 'MFG; fridge once opened ideal' },
  'coconut oil':      { days: 365, category: 'pantry', openedDays: 180, note: 'MFG sealed 2-3y; opened 6mo' },
  'avocado oil':      { days: 365, category: 'pantry', openedDays: 180, note: 'MFG' },
  'peanut oil':       { days: 365, category: 'pantry', openedDays: 180, note: 'MFG' },
  'walnut oil':       { days: 180, category: 'pantry', openedDays: 60, note: 'MFG; rancids faster' },
  'truffle oil':      { days: 180, category: 'pantry', openedDays: 90, note: 'MFG' },
  'balsamic vinegar': { days: 365, category: 'pantry', openedDays: 365, note: 'MFG very stable opened' },
  'apple cider vinegar': { days: 365, category: 'pantry', openedDays: 365, note: 'MFG' },
  'white vinegar':    { days: 365, category: 'pantry', openedDays: 365, note: 'MFG indefinite; cap' },
  'red wine vinegar': { days: 365, category: 'pantry', openedDays: 365, note: 'MFG' },
  'rice vinegar':     { days: 365, category: 'pantry', openedDays: 365, note: 'MFG' },
  'soy sauce':        { days: 365, category: 'pantry', openedDays: 180, note: 'MFG opened 6mo fridge' },
  'tamari':           { days: 365, category: 'pantry', openedDays: 180, note: 'MFG' },
  ketchup:            { days: 365, category: 'pantry', openedDays: 180, note: 'USDA opened fridge 6mo' },
  mustard:            { days: 365, category: 'pantry', openedDays: 365, note: 'USDA opened fridge 1y' },
  'dijon mustard':    { days: 365, category: 'pantry', openedDays: 365, note: 'USDA' },
  mayonnaise:         { days: 90,  category: 'pantry', openedDays: 60, note: 'USDA opened fridge 2mo' },
  sriracha:           { days: 730, category: 'pantry', openedDays: 365, note: 'MFG sealed 2y; opened 1y' },
  'hot sauce':        { days: 730, category: 'pantry', openedDays: 365, note: 'MFG' },
  'tabasco':          { days: 1095, category: 'pantry', openedDays: 365, note: 'MFG 5y sealed; opened ~1y' },
  salsa:              { days: 60,  category: 'pantry', openedDays: 14, note: 'USDA jar opened 2wk fridge' },
  'bbq sauce':        { days: 365, category: 'pantry', openedDays: 120, note: 'MFG opened fridge 4mo' },
  ranch:              { days: 60,  category: 'pantry', openedDays: 30, note: 'MFG refrigerated' },
  'salad dressing':   { days: 365, category: 'pantry', openedDays: 90, note: 'MFG opened fridge 1-3mo' },
  'worcestershire':   { days: 365, category: 'pantry', openedDays: 365, note: 'MFG very stable' },
  'fish sauce':       { days: 1095, category: 'pantry', openedDays: 365, note: 'MFG salt-cured 3y; opened 1y' },
  'oyster sauce':     { days: 730, category: 'pantry', openedDays: 180, note: 'MFG' },
  'hoisin sauce':     { days: 730, category: 'pantry', openedDays: 180, note: 'MFG' },
  miso:               { days: 365, category: 'pantry', openedDays: 365, note: 'MFG opened fridge 1y' },
  gochujang:          { days: 365, category: 'pantry', openedDays: 180, note: 'MFG' },
  harissa:            { days: 365, category: 'pantry', openedDays: 60, note: 'MFG' },
  pesto:              { days: 60,  category: 'pantry', openedDays: 7, note: 'MFG jar fridge; opened 1wk' },
  'maple syrup':      { days: 365, category: 'pantry', openedDays: 365, note: 'USDA fridge opened 1y+' },
  'agave syrup':      { days: 365, category: 'pantry', openedDays: 365, note: 'MFG' },
  molasses:           { days: 365, category: 'pantry', openedDays: 180, note: 'MFG opened 6mo' },
  'corn syrup':       { days: 365, category: 'pantry', openedDays: 180, note: 'MFG' },

  // ─── SPICES / DRIED HERBS ──────────────────────────────────────────────
  salt:               { days: 365, category: 'pantry', note: 'USDA indefinite; cap' },
  'sea salt':         { days: 365, category: 'pantry', note: 'USDA' },
  'kosher salt':      { days: 365, category: 'pantry', note: 'USDA' },
  pepper:             { days: 365, category: 'pantry', note: 'USDA whole 3-4y; cap' },
  'black pepper':     { days: 365, category: 'pantry', note: 'USDA' },
  'white pepper':     { days: 365, category: 'pantry', note: 'USDA' },
  paprika:            { days: 365, category: 'pantry', note: 'USDA ground 2-3y; cap' },
  'smoked paprika':   { days: 365, category: 'pantry', note: 'USDA' },
  cumin:              { days: 365, category: 'pantry', note: 'USDA ground 2-3y' },
  'dried oregano':    { days: 365, category: 'pantry', note: 'USDA dried herb 1-3y' },
  'dried basil':      { days: 365, category: 'pantry', note: 'USDA' },
  'dried thyme':      { days: 365, category: 'pantry', note: 'USDA' },
  'dried rosemary':   { days: 365, category: 'pantry', note: 'USDA' },
  'dried sage':       { days: 365, category: 'pantry', note: 'USDA' },
  'bay leaves':       { days: 365, category: 'pantry', note: 'USDA' },
  cinnamon:           { days: 365, category: 'pantry', note: 'USDA ground 2-3y' },
  'cinnamon stick':   { days: 365, category: 'pantry', note: 'USDA whole spice 3-4y; cap' },
  cardamom:           { days: 365, category: 'pantry', note: 'USDA' },
  clove:              { days: 365, category: 'pantry', note: 'USDA' },
  nutmeg:             { days: 365, category: 'pantry', note: 'USDA' },
  'ground ginger':    { days: 365, category: 'pantry', note: 'USDA' },
  'garlic powder':    { days: 365, category: 'pantry', note: 'USDA 2-3y; cap' },
  'onion powder':     { days: 365, category: 'pantry', note: 'USDA' },
  turmeric:           { days: 365, category: 'pantry', note: 'USDA' },
  'chili powder':     { days: 365, category: 'pantry', note: 'USDA' },
  cayenne:            { days: 365, category: 'pantry', note: 'USDA' },
  sumac:              { days: 365, category: 'pantry', note: 'USDA / TR staple' },
  zaatar:             { days: 365, category: 'pantry', note: 'USDA blend' },
  'red pepper flakes':{ days: 365, category: 'pantry', note: 'USDA' },
  'curry powder':     { days: 365, category: 'pantry', note: 'USDA' },
  'garam masala':     { days: 365, category: 'pantry', note: 'USDA' },
  saffron:            { days: 365, category: 'pantry', note: 'USDA threads stable 2y' },
  vanilla:            { days: 365, category: 'pantry', note: 'USDA extract indefinite; cap' },
  'vanilla extract':  { days: 365, category: 'pantry', note: 'USDA' },
  'vanilla bean':     { days: 365, category: 'pantry', note: 'USDA' },
  fenugreek:          { days: 365, category: 'pantry', note: 'USDA' },
  caraway:            { days: 365, category: 'pantry', note: 'USDA' },
  'fennel seed':      { days: 365, category: 'pantry', note: 'USDA' },
  'mustard seed':     { days: 365, category: 'pantry', note: 'USDA' },
  'star anise':       { days: 365, category: 'pantry', note: 'USDA' },
  allspice:           { days: 365, category: 'pantry', note: 'USDA' },

  // ─── SWEETENERS / BAKING ───────────────────────────────────────────────
  sugar:              { days: 365, category: 'pantry', note: 'USDA indefinite; cap' },
  'white sugar':      { days: 365, category: 'pantry', note: 'USDA' },
  'brown sugar':      { days: 365, category: 'pantry', note: 'USDA' },
  'powdered sugar':   { days: 365, category: 'pantry', note: 'USDA' },
  'coconut sugar':    { days: 365, category: 'pantry', note: 'MFG' },
  stevia:             { days: 365, category: 'pantry', note: 'MFG' },
  erythritol:         { days: 365, category: 'pantry', note: 'MFG' },
  flour:              { days: 365, category: 'pantry', note: 'USDA AP 1y' },
  'all purpose flour':{ days: 365, category: 'pantry', note: 'USDA' },
  'whole wheat flour':{ days: 180, category: 'pantry', note: 'USDA; bran oil 6mo' },
  'almond flour':     { days: 180, category: 'pantry', openedDays: 90, note: 'MFG; fridge once opened' },
  'coconut flour':    { days: 365, category: 'pantry', note: 'MFG' },
  'rice flour':       { days: 365, category: 'pantry', note: 'MFG' },
  cornmeal:           { days: 365, category: 'pantry', note: 'USDA' },
  cornstarch:         { days: 365, category: 'pantry', note: 'USDA indefinite' },
  'baking powder':    { days: 180, category: 'pantry', note: 'USDA loses potency 6mo' },
  'baking soda':      { days: 365, category: 'pantry', note: 'USDA 1-2y; cap' },
  yeast:              { days: 120, category: 'pantry', openedDays: 90, note: 'MFG sealed 4mo; opened fridge' },
  'active dry yeast': { days: 120, category: 'pantry', openedDays: 90, note: 'MFG' },
  cocoa:              { days: 365, category: 'pantry', note: 'USDA 2-3y; cap' },
  'cocoa powder':     { days: 365, category: 'pantry', note: 'USDA' },
  'chocolate chips':  { days: 365, category: 'pantry', note: 'MFG' },

  // ─── SNACKS ────────────────────────────────────────────────────────────
  chocolate:          { days: 365, category: 'pantry', note: 'USDA dark 1-2y; conservative' },
  'dark chocolate':   { days: 365, category: 'pantry', note: 'USDA' },
  'milk chocolate':   { days: 240, category: 'pantry', note: 'USDA shorter than dark' },
  'white chocolate':  { days: 180, category: 'pantry', note: 'USDA shortest of three' },
  cookies:            { days: 60,  category: 'pantry', openedDays: 14, note: 'MFG sealed 2mo' },
  biscuits:           { days: 60,  category: 'pantry', openedDays: 14, note: 'MFG' },
  chips:              { days: 60,  category: 'pantry', openedDays: 7, note: 'MFG sealed 2mo; opened 1wk' },
  'potato chips':     { days: 60,  category: 'pantry', openedDays: 7, note: 'MFG' },
  'tortilla chips':   { days: 60,  category: 'pantry', openedDays: 14, note: 'MFG' },
  'pita chips':       { days: 60,  category: 'pantry', openedDays: 14, note: 'MFG' },
  pretzels:           { days: 90,  category: 'pantry', openedDays: 14, note: 'MFG' },
  popcorn:            { days: 90,  category: 'pantry', openedDays: 14, note: 'MFG popped 1-2wk' },
  'popcorn kernels':  { days: 365, category: 'pantry', note: 'MFG raw 1-2y' },
  'granola bar':      { days: 180, category: 'pantry', note: 'MFG sealed 6mo' },
  'energy bar':       { days: 180, category: 'pantry', note: 'MFG' },
  'protein bar':      { days: 180, category: 'pantry', note: 'MFG' },
  almond:             { days: 365, category: 'pantry', openedDays: 180, note: 'USDA 1y sealed pantry; fridge 6mo opened' },
  walnut:             { days: 180, category: 'pantry', openedDays: 90, note: 'USDA high oil; shorter' },
  cashew:             { days: 180, category: 'pantry', openedDays: 90, note: 'USDA' },
  pistachio:          { days: 180, category: 'pantry', openedDays: 90, note: 'USDA' },
  peanut:             { days: 365, category: 'pantry', openedDays: 180, note: 'USDA shelled' },
  hazelnut:           { days: 180, category: 'pantry', openedDays: 90, note: 'USDA' },
  'pine nut':         { days: 90,  category: 'pantry', openedDays: 60, note: 'USDA highest oil; shortest' },
  'macadamia nut':    { days: 180, category: 'pantry', openedDays: 90, note: 'USDA' },
  'brazil nut':       { days: 180, category: 'pantry', openedDays: 90, note: 'USDA' },
  pecan:              { days: 180, category: 'pantry', openedDays: 90, note: 'USDA' },
  'mixed nuts':       { days: 180, category: 'pantry', openedDays: 90, note: 'USDA' },
  trailmix:           { days: 180, category: 'pantry', openedDays: 30, note: 'MFG' },
  'dried fruit':      { days: 180, category: 'pantry', note: 'MFG' },

  // ─── DRINKS ────────────────────────────────────────────────────────────
  'bottled water':    { days: 365, category: 'beverage', openedDays: 5, note: 'FDA indefinite; cap' },
  'sparkling water':  { days: 365, category: 'beverage', openedDays: 3, note: 'MFG goes flat' },
  'coffee bean':      { days: 180, category: 'beverage', openedDays: 21, note: 'USDA whole bean 6mo; opened 2-3wk' },
  'whole bean coffee':{ days: 180, category: 'beverage', openedDays: 21, note: 'USDA' },
  'ground coffee':    { days: 90,  category: 'beverage', openedDays: 14, note: 'USDA opened 1-2wk fresh' },
  'instant coffee':   { days: 365, category: 'beverage', openedDays: 90, note: 'USDA opened 3mo' },
  coffee:             { days: 90,  category: 'beverage', openedDays: 14, note: 'USDA' },
  espresso:           { days: 180, category: 'beverage', openedDays: 21, note: 'USDA' },
  'tea bag':          { days: 730, category: 'beverage', openedDays: 365, note: 'USDA sealed 2y; opened 1y' },
  'loose tea':        { days: 365, category: 'beverage', openedDays: 180, note: 'USDA' },
  'black tea':        { days: 730, category: 'beverage', openedDays: 365, note: 'USDA' },
  'green tea':        { days: 365, category: 'beverage', openedDays: 180, note: 'USDA; fades faster' },
  'herbal tea':       { days: 365, category: 'beverage', openedDays: 180, note: 'USDA' },
  matcha:             { days: 365, category: 'beverage', openedDays: 60, note: 'MFG sealed 1y; opened 2mo fridge' },
  chai:               { days: 730, category: 'beverage', openedDays: 365, note: 'USDA' },
  'orange juice':     { days: 7,   category: 'beverage', openedDays: 7, note: 'USDA fresh opened 7-10d' },
  'apple juice':      { days: 7,   category: 'beverage', openedDays: 7, note: 'USDA' },
  'pomegranate juice':{ days: 7,   category: 'beverage', openedDays: 5, note: 'MFG' },
  'cranberry juice':  { days: 14,  category: 'beverage', openedDays: 14, note: 'MFG' },
  lemonade:           { days: 7,   category: 'beverage', openedDays: 5, note: 'MFG' },
  soda:               { days: 270, category: 'beverage', openedDays: 3, note: 'MFG sealed 9mo; opened flat 2-3d' },
  cola:               { days: 270, category: 'beverage', openedDays: 3, note: 'MFG' },
  'energy drink':     { days: 365, category: 'beverage', openedDays: 2, note: 'MFG' },
  'sports drink':     { days: 365, category: 'beverage', openedDays: 3, note: 'MFG' },
  beer:               { days: 180, category: 'beverage', openedDays: 1, note: 'MFG sealed 6mo; opened 1d flat' },
  'craft beer':       { days: 90,  category: 'beverage', openedDays: 1, note: 'MFG IPA short' },
  wine:               { days: 365, category: 'beverage', openedDays: 5, note: 'CONV sealed cellared; opened fridge 3-5d' },
  'red wine':         { days: 365, category: 'beverage', openedDays: 5, note: 'CONV' },
  'white wine':       { days: 365, category: 'beverage', openedDays: 5, note: 'CONV' },
  'rose wine':        { days: 365, category: 'beverage', openedDays: 5, note: 'CONV' },
  'sparkling wine':   { days: 365, category: 'beverage', openedDays: 3, note: 'CONV' },
  champagne:          { days: 365, category: 'beverage', openedDays: 3, note: 'CONV' },
  vodka:              { days: 365, category: 'beverage', openedDays: 365, note: 'CONV spirits indefinite' },
  whiskey:            { days: 365, category: 'beverage', openedDays: 365, note: 'CONV' },
  rum:                { days: 365, category: 'beverage', openedDays: 365, note: 'CONV' },
  gin:                { days: 365, category: 'beverage', openedDays: 365, note: 'CONV' },
  tequila:            { days: 365, category: 'beverage', openedDays: 365, note: 'CONV' },
  raki:               { days: 365, category: 'beverage', openedDays: 365, note: 'CONV TR anise spirit' },
  'kombucha':         { days: 60,  category: 'beverage', openedDays: 7, note: 'MFG fridge sealed 2mo; opened 1wk' },
  'protein shake':    { days: 14,  category: 'beverage', openedDays: 2, note: 'MFG' },

  // ─── FROZEN ────────────────────────────────────────────────────────────
  'frozen veggies':   { days: 240, category: 'frozen', note: 'FSG 8mo' },
  'frozen peas':      { days: 240, category: 'frozen', note: 'FSG' },
  'frozen corn':      { days: 240, category: 'frozen', note: 'FSG' },
  'frozen spinach':   { days: 240, category: 'frozen', note: 'FSG' },
  'frozen broccoli':  { days: 240, category: 'frozen', note: 'FSG' },
  'frozen fruit':     { days: 240, category: 'frozen', note: 'FSG 8-12mo' },
  'frozen berries':   { days: 240, category: 'frozen', note: 'FSG' },
  'frozen mango':     { days: 240, category: 'frozen', note: 'FSG' },
  'frozen pizza':     { days: 180, category: 'frozen', note: 'FSG 6-8mo' },
  'ice cream':        { days: 60,  category: 'frozen', openedDays: 21, note: 'FSG sealed 2mo; opened 3wk best quality' },
  sorbet:             { days: 60,  category: 'frozen', openedDays: 21, note: 'FSG' },
  popsicle:           { days: 60,  category: 'frozen', openedDays: 30, note: 'FSG' },
  'frozen fish':      { days: 180, category: 'frozen', note: 'FSG fatty 2-3mo; lean 6mo; mid' },
  'frozen shrimp':    { days: 180, category: 'frozen', note: 'FSG' },
  'frozen chicken':   { days: 270, category: 'frozen', note: 'FSG 9mo' },
  'chicken nuggets':  { days: 90,  category: 'frozen', note: 'FSG cooked 1-3mo' },
  'frozen meat':      { days: 120, category: 'frozen', note: 'FSG ground 3-4mo' },
  'frozen meatballs': { days: 90,  category: 'frozen', note: 'FSG' },
  'frozen dumplings': { days: 180, category: 'frozen', note: 'MFG' },
  'frozen waffles':   { days: 180, category: 'frozen', note: 'MFG' },
  'frozen pastry':    { days: 180, category: 'frozen', note: 'MFG' },

  // ─── BAKERY / DESSERTS ─────────────────────────────────────────────────
  cake:               { days: 4,   category: 'bakery', note: 'USDA frosted 3-4d fridge' },
  cheesecake:         { days: 5,   category: 'bakery', note: 'USDA 5-7d' },
  donut:              { days: 2,   category: 'bakery', note: 'CONV stales fast' },
  pastry:             { days: 3,   category: 'bakery', note: 'CONV' },
  croissant:          { days: 2,   category: 'bakery', note: 'CONV' },
  baklava:            { days: 7,   category: 'bakery', note: 'CONV sugar-syrup preservation' },
  cupcake:            { days: 3,   category: 'bakery', note: 'CONV' },
  muffin:             { days: 4,   category: 'bakery', note: 'CONV' },
  brownie:            { days: 4,   category: 'bakery', note: 'CONV' },
  'pie':              { days: 4,   category: 'bakery', note: 'USDA fruit pie 3-4d' },
  'fruit tart':       { days: 3,   category: 'bakery', note: 'CONV' },

  // ─── CLEANING ──────────────────────────────────────────────────────────
  'dish soap':        { days: 365, category: 'cleaning', note: 'EWG ~1-2y; cap 365' },
  'laundry detergent':{ days: 365, category: 'cleaning', openedDays: 270, note: 'EWG sealed 9-12mo; opened 6-9mo loses potency' },
  'laundry pods':     { days: 365, category: 'cleaning', note: 'MFG' },
  'fabric softener':  { days: 365, category: 'cleaning', openedDays: 270, note: 'MFG' },
  bleach:             { days: 180, category: 'cleaning', openedDays: 180, note: 'EWG potency halves at 6mo' },
  'all purpose cleaner': { days: 730, category: 'cleaning', note: 'EWG 2y' },
  'glass cleaner':    { days: 730, category: 'cleaning', note: 'EWG' },
  'bathroom cleaner': { days: 730, category: 'cleaning', note: 'EWG' },
  'oven cleaner':     { days: 730, category: 'cleaning', note: 'EWG' },
  'drain cleaner':    { days: 730, category: 'cleaning', note: 'EWG' },
  'toilet cleaner':   { days: 730, category: 'cleaning', note: 'EWG' },
  'floor cleaner':    { days: 730, category: 'cleaning', note: 'EWG' },
  'wood polish':      { days: 730, category: 'cleaning', note: 'EWG' },
  'stainless cleaner':{ days: 730, category: 'cleaning', note: 'EWG' },
  sponge:             { days: 14,  category: 'cleaning', note: 'CDC replace 1-2wk hygiene' },
  'dishwasher tabs':  { days: 365, category: 'cleaning', note: 'MFG ~15mo; cap' },
  'dishwasher rinse aid':{ days: 365, category: 'cleaning', note: 'MFG' },
  'mop refill':       { days: 90,  category: 'cleaning', note: 'CONV monthly replace cycle' },
  'trash bags':       { days: 365, category: 'cleaning', note: 'CONV per roll' },
  'paper towels':     { days: 30,  category: 'cleaning', note: 'CONV per roll typical use' },
  'toilet paper':     { days: 14,  category: 'cleaning', note: 'CONV per roll typical' },
  'paper napkins':    { days: 60,  category: 'cleaning', note: 'CONV per pack' },
  'cleaning gloves':  { days: 90,  category: 'cleaning', note: 'CONV replacement cycle' },
  'rubber gloves':    { days: 90,  category: 'cleaning', note: 'CONV' },
  'broom':            { days: 365, category: 'cleaning', note: 'CONV' },
  'mop':              { days: 365, category: 'cleaning', note: 'CONV' },
  'vacuum bag':       { days: 90,  category: 'cleaning', note: 'CONV' },
  'air freshener':    { days: 60,  category: 'cleaning', note: 'CONV' },
  'lint roller':      { days: 60,  category: 'cleaning', note: 'CONV per roll' },
  'baking soda cleaner': { days: 365, category: 'cleaning', note: 'EWG' },
  'rubbing alcohol':  { days: 730, category: 'cleaning', note: 'EWG' },

  // ─── PERSONAL CARE ─────────────────────────────────────────────────────
  shampoo:            { days: 1095, category: 'personal_care', openedDays: 365, note: 'EWG sealed 3y; opened 1y' },
  conditioner:        { days: 1095, category: 'personal_care', openedDays: 365, note: 'EWG' },
  'dry shampoo':      { days: 730, category: 'personal_care', openedDays: 365, note: 'EWG' },
  'body wash':        { days: 1095, category: 'personal_care', openedDays: 365, note: 'EWG' },
  'bar soap':         { days: 1095, category: 'personal_care', note: 'EWG; unopened cures' },
  'hand soap':        { days: 1095, category: 'personal_care', openedDays: 365, note: 'EWG' },
  'face wash':        { days: 730, category: 'personal_care', openedDays: 180, note: 'EWG opened 6mo' },
  cleanser:           { days: 730, category: 'personal_care', openedDays: 180, note: 'EWG' },
  moisturizer:        { days: 730, category: 'personal_care', openedDays: 365, note: 'EWG opened 1y' },
  'face cream':       { days: 730, category: 'personal_care', openedDays: 365, note: 'EWG' },
  'eye cream':        { days: 365, category: 'personal_care', openedDays: 180, note: 'EWG' },
  serum:              { days: 365, category: 'personal_care', openedDays: 180, note: 'EWG vitamin C oxidizes' },
  sunscreen:          { days: 1095, category: 'personal_care', openedDays: 365, note: 'FDA 3y from manufacture; opened 1y conservative' },
  lotion:             { days: 1095, category: 'personal_care', openedDays: 365, note: 'EWG' },
  'body lotion':      { days: 1095, category: 'personal_care', openedDays: 365, note: 'EWG' },
  'hand cream':       { days: 1095, category: 'personal_care', openedDays: 365, note: 'EWG' },
  toothpaste:         { days: 730, category: 'personal_care', openedDays: 365, note: 'FDA expiration ~2y' },
  mouthwash:          { days: 730, category: 'personal_care', openedDays: 365, note: 'FDA' },
  'dental floss':     { days: 365, category: 'personal_care', note: 'CONV' },
  toothbrush:         { days: 90,  category: 'personal_care', note: 'ADA replace every 3-4mo' },
  'electric toothbrush head': { days: 90, category: 'personal_care', note: 'ADA' },
  deodorant:          { days: 730, category: 'personal_care', openedDays: 365, note: 'EWG' },
  antiperspirant:     { days: 730, category: 'personal_care', openedDays: 365, note: 'EWG' },
  razor:              { days: 21,  category: 'personal_care', note: 'CONV cartridge replace ~3wk daily use' },
  'razor cartridge':  { days: 21,  category: 'personal_care', note: 'CONV' },
  'shaving cream':    { days: 730, category: 'personal_care', openedDays: 365, note: 'EWG' },
  'shaving gel':      { days: 730, category: 'personal_care', openedDays: 365, note: 'EWG' },
  'aftershave':       { days: 1095, category: 'personal_care', openedDays: 365, note: 'EWG' },
  tampons:            { days: 1825, category: 'personal_care', note: 'FDA 5y' },
  pads:               { days: 1825, category: 'personal_care', note: 'FDA 5y' },
  'panty liners':     { days: 1825, category: 'personal_care', note: 'FDA 5y' },
  liners:             { days: 1825, category: 'personal_care', note: 'FDA' },
  'menstrual cup':    { days: 1825, category: 'personal_care', note: 'MFG silicone 5-10y; cap 5y' },
  diapers:            { days: 730, category: 'personal_care', note: 'MFG sealed 2y' },
  'baby wipes':       { days: 730, category: 'personal_care', openedDays: 30, note: 'MFG opened 1mo before drying' },
  'lip balm':         { days: 365, category: 'personal_care', openedDays: 365, note: 'EWG' },
  'lip stick':        { days: 730, category: 'personal_care', openedDays: 365, note: 'EWG' },
  'nail polish':      { days: 730, category: 'personal_care', openedDays: 365, note: 'EWG opened 1-2y' },
  'nail polish remover':{ days: 1095, category: 'personal_care', note: 'EWG' },
  'q-tips':           { days: 1825, category: 'personal_care', note: 'CONV very stable' },
  'cotton balls':     { days: 1825, category: 'personal_care', note: 'CONV' },
  'cotton pads':      { days: 1825, category: 'personal_care', note: 'CONV' },
  mascara:            { days: 90,  category: 'personal_care', openedDays: 90, note: 'EWG 3mo opened (bacterial)' },
  eyeliner:           { days: 365, category: 'personal_care', openedDays: 180, note: 'EWG' },
  foundation:         { days: 730, category: 'personal_care', openedDays: 365, note: 'EWG opened 1y' },
  concealer:          { days: 730, category: 'personal_care', openedDays: 365, note: 'EWG' },
  perfume:            { days: 1095, category: 'personal_care', openedDays: 730, note: 'EWG 3y sealed; 2y opened' },
  cologne:            { days: 1095, category: 'personal_care', openedDays: 730, note: 'EWG' },
  contacts:           { days: 365, category: 'personal_care', note: 'FDA daily-use cycle' },
  'contact solution': { days: 730, category: 'personal_care', openedDays: 90, note: 'FDA opened 90d max' },

  // ─── OTC / WELLNESS ────────────────────────────────────────────────────
  'vitamin c':        { days: 730, category: 'wellness', note: 'CC 2y typical' },
  'vitamin d':        { days: 730, category: 'wellness', note: 'CC' },
  'vitamin b12':      { days: 730, category: 'wellness', note: 'CC' },
  'vitamin e':        { days: 730, category: 'wellness', note: 'CC' },
  'vitamin k':        { days: 730, category: 'wellness', note: 'CC' },
  multivitamin:       { days: 730, category: 'wellness', note: 'CC' },
  magnesium:          { days: 730, category: 'wellness', note: 'CC' },
  iron:               { days: 730, category: 'wellness', note: 'CC' },
  calcium:            { days: 730, category: 'wellness', note: 'CC' },
  zinc:               { days: 730, category: 'wellness', note: 'CC' },
  'omega 3':          { days: 365, category: 'wellness', openedDays: 180, note: 'CC fish oil rancids' },
  'fish oil':         { days: 365, category: 'wellness', openedDays: 180, note: 'CC' },
  probiotic:          { days: 365, category: 'wellness', openedDays: 180, note: 'MFG potency drops; fridge ideal' },
  melatonin:          { days: 730, category: 'wellness', note: 'CC' },
  ibuprofen:          { days: 1095, category: 'wellness', note: 'FDA 3y typical' },
  paracetamol:        { days: 1095, category: 'wellness', note: 'FDA' },
  acetaminophen:      { days: 1095, category: 'wellness', note: 'FDA' },
  advil:              { days: 1095, category: 'wellness', note: 'FDA' },
  tylenol:            { days: 1095, category: 'wellness', note: 'FDA' },
  aspirin:            { days: 1095, category: 'wellness', note: 'FDA' },
  naproxen:           { days: 1095, category: 'wellness', note: 'FDA' },
  'allergy meds':     { days: 730, category: 'wellness', note: 'FDA' },
  zyrtec:             { days: 730, category: 'wellness', note: 'FDA' },
  claritin:           { days: 730, category: 'wellness', note: 'FDA' },
  benadryl:           { days: 730, category: 'wellness', note: 'FDA' },
  'cold medicine':    { days: 730, category: 'wellness', note: 'FDA' },
  'cough syrup':      { days: 365, category: 'wellness', openedDays: 180, note: 'FDA opened 6mo' },
  'hand sanitizer':   { days: 1095, category: 'wellness', openedDays: 730, note: 'FDA 2-3y; opened 2y' },
  'first aid bandage':{ days: 1825, category: 'wellness', note: 'CONV very stable sealed' },
  'antiseptic':       { days: 1095, category: 'wellness', note: 'FDA' },
  'allergy spray':    { days: 730, category: 'wellness', openedDays: 180, note: 'FDA' },
  'eye drops':        { days: 365, category: 'wellness', openedDays: 28, note: 'FDA opened 28d' },

  // ─── PET ───────────────────────────────────────────────────────────────
  'dry kibble':       { days: 365, category: 'pet', openedDays: 42, note: 'AAFCO sealed 1y; opened 6wk before oxidation' },
  'cat kibble':       { days: 365, category: 'pet', openedDays: 42, note: 'AAFCO' },
  'dog kibble':       { days: 365, category: 'pet', openedDays: 42, note: 'AAFCO' },
  'wet food can':     { days: 730, category: 'pet', openedDays: 5, note: 'AAFCO sealed 2y; opened fridge 5-7d' },
  'cat food can':     { days: 730, category: 'pet', openedDays: 5, note: 'AAFCO' },
  'dog food can':     { days: 730, category: 'pet', openedDays: 5, note: 'AAFCO' },
  'pet treats':       { days: 180, category: 'pet', openedDays: 60, note: 'MFG' },
  'dog treats':       { days: 180, category: 'pet', openedDays: 60, note: 'MFG' },
  'cat treats':       { days: 180, category: 'pet', openedDays: 60, note: 'MFG' },
  catnip:             { days: 365, category: 'pet', note: 'MFG dried herb' },
  'cat litter':       { days: 365, category: 'pet', note: 'MFG per bag; typical use cycle' },
  'litter pellets':   { days: 365, category: 'pet', note: 'MFG' },
  'pee pads':         { days: 365, category: 'pet', note: 'MFG per pack' },
  'pet shampoo':      { days: 1095, category: 'pet', openedDays: 365, note: 'MFG' },
  'flea treatment':   { days: 730, category: 'pet', note: 'MFG' },
  'tick treatment':   { days: 730, category: 'pet', note: 'MFG' },
  'pet vitamins':     { days: 730, category: 'pet', note: 'MFG' },
  hay:                { days: 180, category: 'pet', note: 'CONV per bale; dry storage' },
  'guinea pig food':  { days: 365, category: 'pet', openedDays: 60, note: 'MFG' },
  'rabbit food':      { days: 365, category: 'pet', openedDays: 60, note: 'MFG' },
  'fish food':        { days: 365, category: 'pet', openedDays: 90, note: 'MFG' },
  'bird seed':        { days: 365, category: 'pet', openedDays: 60, note: 'MFG' },
};

/**
 * SHELF_LIFE_MAP — flat canonical→days view, auto-derived from
 * SHELF_LIFE_DETAIL. Preserved as `Record<string, number>` for legacy
 * consumers (replenishment.ts) that key directly into this map.
 *
 * Do NOT add entries here directly — add to SHELF_LIFE_DETAIL above.
 */
export const SHELF_LIFE_MAP: Record<string, number> = Object.fromEntries(
  Object.entries(SHELF_LIFE_DETAIL).map(([k, v]) => [k, v.days]),
);

/**
 * ALIAS_MAP — non-English (TR/ES) and common-variant aliases mapped to the
 * canonical EN key in SHELF_LIFE_DETAIL. Layer 1 (Gemini) usually does the
 * canonicalization, but this map is the fallback for direct shelf-life
 * lookups by raw user text.
 *
 * Keys: lowercased, singular, exact phrase the user is likely to dump.
 * Values: canonical key existing in SHELF_LIFE_DETAIL.
 */
export const ALIAS_MAP: Record<string, string> = {
  // ─── Turkish ────────────────────────────────────────────────────────────
  'süt': 'milk', 'sut': 'milk', 'yoğurt': 'yogurt', 'yogurt': 'yogurt',
  'peynir': 'cheese', 'beyaz peynir': 'feta', 'kaşar': 'kasar', 'kasar': 'kasar',
  'tereyağı': 'butter', 'tereyagi': 'butter', 'krema': 'cream',
  'yumurta': 'egg', 'tavuk': 'chicken', 'kıyma': 'ground beef', 'kiyma': 'ground beef',
  'dana eti': 'beef', 'kuzu': 'lamb', 'balık': 'fish', 'balik': 'fish',
  'karides': 'shrimp', 'sucuk': 'sucuk', 'pastırma': 'pastirma', 'pastirma': 'pastirma',
  'jambon': 'ham', 'sosis': 'sausage',
  'domates': 'tomato', 'soğan': 'onion', 'sogan': 'onion',
  'sarımsak': 'garlic', 'sarimsak': 'garlic', 'patates': 'potato',
  'tatlı patates': 'sweet potato', 'tatli patates': 'sweet potato',
  'havuç': 'carrot', 'havuc': 'carrot', 'kereviz': 'celery',
  'salatalık': 'cucumber', 'salatalik': 'cucumber', 'kabak': 'zucchini',
  'patlıcan': 'eggplant', 'patlican': 'eggplant',
  'biber': 'bell pepper', 'kırmızı biber': 'red pepper', 'kirmizi biber': 'red pepper',
  'yeşil biber': 'green pepper', 'yesil biber': 'green pepper',
  'ıspanak': 'spinach', 'ispanak': 'spinach', 'marul': 'lettuce',
  'maydanoz': 'parsley', 'dereotu': 'dill', 'nane': 'mint', 'fesleğen': 'basil',
  'pırasa': 'leek', 'pirasa': 'leek', 'mantar': 'mushroom',
  'elma': 'apple', 'muz': 'banana', 'portakal': 'orange',
  'limon': 'lemon', 'misket limonu': 'lime',
  'çilek': 'strawberry', 'cilek': 'strawberry', 'yaban mersini': 'blueberry',
  'üzüm': 'grapes', 'uzum': 'grapes', 'karpuz': 'watermelon', 'kavun': 'melon',
  'şeftali': 'peach', 'seftali': 'peach', 'armut': 'pear', 'erik': 'plum',
  'kiraz': 'cherry', 'kayısı': 'apricot', 'kayisi': 'apricot',
  'incir': 'fig', 'hurma': 'date', 'avokado': 'avocado', 'nar': 'pomegranate',
  'ekmek': 'bread', 'makarna': 'pasta', 'pirinç': 'rice', 'pirinc': 'rice',
  'bulgur': 'bulgur', 'un': 'flour', 'yulaf': 'oats', 'mısır gevreği': 'cereal',
  'zeytinyağı': 'olive oil', 'zeytinyagi': 'olive oil',
  'ayçiçek yağı': 'sunflower oil', 'aycicek yagi': 'sunflower oil',
  'tuz': 'salt', 'karabiber': 'black pepper', 'kimyon': 'cumin',
  'kekik': 'dried thyme', 'tarçın': 'cinnamon', 'tarcin': 'cinnamon',
  'şeker': 'sugar', 'seker': 'sugar', 'bal': 'honey',
  'soya sosu': 'soy sauce', 'sirke': 'apple cider vinegar',
  'salça': 'tomato paste', 'salca': 'tomato paste',
  'ketçap': 'ketchup', 'ketcap': 'ketchup', 'hardal': 'mustard', 'mayonez': 'mayonnaise',
  'su': 'bottled water', 'kahve': 'coffee', 'çay': 'tea bag', 'cay': 'tea bag',
  'meyve suyu': 'orange juice', 'bira': 'beer', 'şarap': 'wine', 'sarap': 'wine',
  'rakı': 'raki', 'raki': 'raki',
  'cips': 'chips', 'kraker': 'crackers', 'çikolata': 'chocolate', 'cikolata': 'chocolate',
  'dondurma': 'ice cream', 'kek': 'cake', 'baklava': 'baklava', 'kurabiye': 'cookies',
  'şampuan': 'shampoo', 'sampuan': 'shampoo', 'saç kremi': 'conditioner',
  'sabun': 'bar soap', 'duş jeli': 'body wash', 'dus jeli': 'body wash',
  'diş macunu': 'toothpaste', 'dis macunu': 'toothpaste',
  'deterjan': 'laundry detergent', 'bulaşık deterjanı': 'dish soap',
  'tuvalet kağıdı': 'toilet paper', 'tuvalet kagidi': 'toilet paper',
  'kağıt havlu': 'paper towels', 'kagit havlu': 'paper towels',
  'çöp poşeti': 'trash bags', 'cop poseti': 'trash bags',
  'çamaşır suyu': 'bleach', 'camasir suyu': 'bleach',
  'ped': 'pads', 'tampon': 'tampons',
  'bebek bezi': 'diapers', 'ıslak mendil': 'baby wipes', 'islak mendil': 'baby wipes',
  'vitamin c': 'vitamin c', 'b12': 'vitamin b12',
  'kedi maması': 'cat kibble', 'kedi mamasi': 'cat kibble',
  'köpek maması': 'dog kibble', 'kopek mamasi': 'dog kibble',
  'kedi kumu': 'cat litter', 'saman': 'hay',
  'badem': 'almond', 'ceviz': 'walnut', 'fındık': 'hazelnut', 'findik': 'hazelnut',
  'fıstık': 'pistachio', 'fistik': 'pistachio', 'antep fıstığı': 'pistachio',
  'yer fıstığı': 'peanut', 'yer fistigi': 'peanut',
  'nohut': 'chickpea', 'mercimek': 'lentil', 'kırmızı mercimek': 'red lentil',
  'kuru fasulye': 'white bean', 'barbunya': 'kidney bean',

  // ─── Spanish ────────────────────────────────────────────────────────────
  'leche': 'milk', 'leche entera': 'whole milk', 'leche desnatada': 'skim milk',
  'leche de avena': 'oat milk', 'leche de almendras': 'almond milk',
  'leche de soya': 'soy milk', 'leche de soja': 'soy milk', 'leche de coco': 'coconut milk',
  'yogur': 'yogurt', 'queso': 'cheese',
  'queso feta': 'feta', 'queso mozzarella': 'mozzarella', 'parmesano': 'parmesan',
  'mantequilla': 'butter', 'manteca': 'butter', 'crema': 'cream', 'nata': 'cream',
  'huevo': 'egg', 'huevos': 'egg', 'pollo': 'chicken',
  'carne molida': 'ground beef', 'carne picada': 'ground beef',
  'carne de res': 'beef', 'res': 'beef', 'cordero': 'lamb', 'cerdo': 'pork',
  'pescado': 'fish', 'salmón': 'salmon', 'salmon': 'salmon', 'atún': 'tuna', 'atun': 'tuna',
  'camarón': 'shrimp', 'camaron': 'shrimp', 'gamba': 'shrimp',
  'jamón': 'ham', 'jamon': 'ham', 'jamón serrano': 'jamon',
  'tocino': 'bacon', 'salchicha': 'sausage', 'chorizo': 'chorizo',
  'tomate': 'tomato', 'jitomate': 'tomato', 'cebolla': 'onion',
  'cebolla morada': 'red onion', 'cebolla blanca': 'white onion',
  'cebolleta': 'spring onion', 'cebollín': 'scallion', 'cebollin': 'scallion',
  'ajo': 'garlic', 'papa': 'potato', 'patata': 'potato', 'batata': 'sweet potato',
  'camote': 'sweet potato', 'zanahoria': 'carrot', 'apio': 'celery',
  'pepino': 'cucumber', 'calabacín': 'zucchini', 'calabacin': 'zucchini',
  'calabaza': 'pumpkin', 'berenjena': 'eggplant',
  'pimiento': 'bell pepper', 'pimiento rojo': 'red pepper',
  'pimiento verde': 'green pepper', 'chile': 'chili', 'jalapeño': 'jalapeno',
  'espinaca': 'spinach', 'lechuga': 'lettuce',
  'cilantro': 'cilantro', 'perejil': 'parsley', 'eneldo': 'dill',
  'menta': 'mint', 'albahaca': 'basil',
  'puerro': 'leek', 'espárrago': 'asparagus', 'esparrago': 'asparagus',
  'champiñón': 'mushroom', 'champinon': 'mushroom', 'hongo': 'mushroom',
  'brócoli': 'broccoli', 'brocoli': 'broccoli', 'coliflor': 'cauliflower',
  'col': 'cabbage', 'repollo': 'cabbage', 'rúcula': 'arugula', 'rucula': 'arugula',
  'maíz': 'corn', 'maiz': 'corn', 'elote': 'corn',
  'remolacha': 'beet', 'rábano': 'radish', 'rabano': 'radish',
  'jengibre': 'ginger',
  'manzana': 'apple', 'plátano': 'banana', 'platano': 'banana', 'banano': 'banana',
  'naranja': 'orange', 'mandarina': 'mandarin', 'limón': 'lemon',
  'lima': 'lime', 'fresa': 'strawberry', 'frutilla': 'strawberry',
  'arándano': 'blueberry', 'arandano': 'blueberry',
  'frambuesa': 'raspberry', 'mora': 'blackberry',
  'uva': 'grapes', 'sandía': 'watermelon', 'sandia': 'watermelon',
  'melón': 'melon', 'melon': 'melon', 'durazno': 'peach',
  'melocotón': 'peach', 'melocoton': 'peach', 'pera': 'pear', 'ciruela': 'plum',
  'mango': 'mango', 'piña': 'pineapple', 'pina': 'pineapple', 'kiwi': 'kiwi',
  'aguacate': 'avocado', 'palta': 'avocado', 'granada': 'pomegranate',
  'higo': 'fig', 'dátil': 'date', 'datil': 'date', 'cereza': 'cherry',
  'damasco': 'apricot', 'albaricoque': 'apricot',
  'pan': 'bread', 'pan blanco': 'white bread', 'pan integral': 'whole wheat bread',
  'pasta': 'pasta', 'espagueti': 'spaghetti', 'arroz': 'rice',
  'harina': 'flour', 'avena': 'oats', 'cereal': 'cereal',
  'aceite': 'olive oil', 'aceite de oliva': 'olive oil',
  'aceite de girasol': 'sunflower oil', 'aceite vegetal': 'vegetable oil',
  'sal': 'salt', 'pimienta': 'black pepper', 'pimienta negra': 'black pepper',
  'comino': 'cumin', 'orégano': 'dried oregano', 'oregano': 'dried oregano',
  'canela': 'cinnamon', 'azúcar': 'sugar', 'azucar': 'sugar', 'miel': 'honey',
  'jarabe de arce': 'maple syrup', 'sirope de arce': 'maple syrup',
  'salsa de soya': 'soy sauce', 'salsa de soja': 'soy sauce',
  'vinagre': 'apple cider vinegar', 'vinagre balsámico': 'balsamic vinegar',
  'salsa de tomate': 'tomato sauce', 'pasta de tomate': 'tomato paste',
  'kétchup': 'ketchup', 'cátsup': 'ketchup', 'catsup': 'ketchup',
  'mostaza': 'mustard', 'mayonesa': 'mayonnaise',
  'salsa picante': 'hot sauce',
  'agua': 'bottled water', 'agua mineral': 'sparkling water',
  'café': 'coffee', 'cafe': 'coffee', 'té': 'tea bag', 'te': 'tea bag',
  'té verde': 'green tea', 'te verde': 'green tea',
  'té negro': 'black tea', 'jugo': 'orange juice', 'zumo': 'orange juice',
  'jugo de naranja': 'orange juice', 'jugo de manzana': 'apple juice',
  'refresco': 'soda', 'gaseosa': 'soda', 'cerveza': 'beer', 'vino': 'wine',
  'vino tinto': 'red wine', 'vino blanco': 'white wine',
  'papas fritas': 'chips', 'frituras': 'chips',
  'galleta': 'cookies', 'galletas': 'cookies', 'galletas saladas': 'crackers',
  'chocolate': 'chocolate', 'chocolate negro': 'dark chocolate',
  'chocolate con leche': 'milk chocolate',
  'helado': 'ice cream', 'pastel': 'cake', 'torta': 'cake', 'tarta': 'cake',
  'champú': 'shampoo', 'champu': 'shampoo', 'acondicionador': 'conditioner',
  'jabón': 'bar soap', 'jabon': 'bar soap',
  'gel de baño': 'body wash', 'gel de bano': 'body wash',
  'pasta de dientes': 'toothpaste', 'pasta dental': 'toothpaste',
  'enjuague bucal': 'mouthwash', 'desodorante': 'deodorant',
  'detergente': 'laundry detergent', 'lavavajillas': 'dish soap',
  'jabón para platos': 'dish soap', 'suavizante': 'fabric softener',
  'lejía': 'bleach', 'lejia': 'bleach', 'cloro': 'bleach',
  'papel higiénico': 'toilet paper', 'papel higienico': 'toilet paper',
  'papel toalla': 'paper towels', 'toallas de papel': 'paper towels',
  'bolsa de basura': 'trash bags', 'bolsas de basura': 'trash bags',
  'compresa': 'pads', 'toalla sanitaria': 'pads', 'protector diario': 'panty liners',
  'tampón': 'tampons', 'tampones': 'tampons',
  'pañal': 'diapers', 'panal': 'diapers', 'pañales': 'diapers',
  'toallitas húmedas': 'baby wipes', 'toallitas humedas': 'baby wipes',
  'vitamina c': 'vitamin c', 'vitamina d': 'vitamin d',
  'multivitamínico': 'multivitamin', 'multivitaminico': 'multivitamin',
  'comida para gato': 'cat kibble', 'comida para perro': 'dog kibble',
  'arena para gato': 'cat litter', 'heno': 'hay',
  'almendra': 'almond', 'nuez': 'walnut', 'avellana': 'hazelnut',
  'pistacho': 'pistachio', 'maní': 'peanut', 'mani': 'peanut', 'cacahuate': 'peanut',
  'cacahuete': 'peanut', 'garbanzo': 'chickpea', 'lenteja': 'lentil',
  'frijol negro': 'black bean', 'frijol rojo': 'kidney bean',
  'frijol blanco': 'white bean', 'judía': 'white bean', 'judia': 'white bean',
  'mantequilla de maní': 'peanut butter', 'crema de maní': 'peanut butter',
  'mantequilla de cacahuete': 'peanut butter',
  'aceitunas': 'olives', 'aceituna': 'olives', 'aceitunas verdes': 'green olives',
  'aceitunas negras': 'kalamata olives', 'encurtidos': 'pickles',
  'mermelada': 'jam',

  // ─── EN common variants / abbreviations the user might dump ────────────
  'milks': 'milk', 'eggs': 'egg', 'apples': 'apple', 'bananas': 'banana',
  'tomatoes': 'tomato', 'onions': 'onion', 'potatoes': 'potato',
  'carrots': 'carrot', 'cucumbers': 'cucumber', 'peppers': 'bell pepper',
  'mushrooms': 'mushroom', 'lemons': 'lemon', 'limes': 'lime',
  'oranges': 'orange', 'strawberries': 'strawberry', 'blueberries': 'blueberry',
  'raspberries': 'raspberry', 'blackberries': 'blackberry', 'cherries': 'cherry',
  'peaches': 'peach', 'pears': 'pear', 'plums': 'plum', 'apricots': 'apricot',
  'avocados': 'avocado', 'sweet potatoes': 'sweet potato',
  'almonds': 'almond', 'walnuts': 'walnut', 'pistachios': 'pistachio',
  'cashews': 'cashew', 'peanuts': 'peanut', 'hazelnuts': 'hazelnut',
  'olives': 'olives',
  'evoo': 'olive oil', 'extra virgin': 'olive oil',
  'pb': 'peanut butter', 'ab': 'almond butter',
  'tp': 'toilet paper', 'paper towel': 'paper towels',
  'tampax': 'tampons',
  'breast': 'chicken breast', 'thigh': 'chicken thigh',
  'mayo': 'mayonnaise',
  'ck': 'chicken', 'chx': 'chicken',
  'shroom': 'mushroom', 'shrooms': 'mushroom',
  'decaf': 'coffee', 'matcha tea': 'matcha',
};

/**
 * Look up shelf life in days for a raw or canonical name.
 *
 * Resolution order:
 *   1. Direct hit in SHELF_LIFE_DETAIL (canonical EN, lowercased).
 *   2. Alias hit via ALIAS_MAP → canonical → SHELF_LIFE_DETAIL.
 *   3. `undefined` (caller decides on fallback; replenishment.ts uses 14d).
 *
 * Case-insensitive on both the input and the canonical key.
 */
export function lookupShelfLife(name: string): number | undefined {
  if (typeof name !== 'string' || name.length === 0) return undefined;
  const norm = name.trim().toLowerCase();
  const direct = SHELF_LIFE_DETAIL[norm];
  if (direct) return direct.days;
  const canonical = ALIAS_MAP[norm];
  if (canonical && SHELF_LIFE_DETAIL[canonical]) {
    return SHELF_LIFE_DETAIL[canonical].days;
  }
  return undefined;
}

/**
 * Same as lookupShelfLife but returns the full entry (category, openedDays).
 */
export function lookupShelfLifeDetail(name: string): ShelfLifeEntry | undefined {
  if (typeof name !== 'string' || name.length === 0) return undefined;
  const norm = name.trim().toLowerCase();
  const direct = SHELF_LIFE_DETAIL[norm];
  if (direct) return direct;
  const canonical = ALIAS_MAP[norm];
  if (canonical) return SHELF_LIFE_DETAIL[canonical];
  return undefined;
}

// ─── CRITICAL_REMINDER whitelist (Plan B push-default gate) ─────────────────
//
// Locked product rule (Serra, 2026-05-30): Plan B — silent shopping-list add
// for all pantry items at predicted out; opt-in push only for items flagged
// `remind_me=true`. This whitelist defines the canonicals that DEFAULT to
// remind_me=true on insert. The frontend's pantry repo calls
// `isCriticalReminder(canonical)` when creating new pantry rows.
//
// Composition:
//   - the entire 'wellness' shelf-category (meds, vitamins, eye drops, etc.)
//   - the entire 'pet' shelf-category (food, treats, litter, etc.) — running
//     out of pet food is never a "silent add to list" event
//   - explicit personal_care subset (period products, baby supplies, contacts)
//
// We derive the wellness + pet defaults at module init by walking
// SHELF_LIFE_DETAIL so adding a new wellness/pet entry automatically becomes
// a critical reminder. The explicit set below covers the personal_care
// exceptions that aren't a whole-category default.

/**
 * Explicit additional canonicals that default to remind_me=true beyond the
 * wellness + pet categories. These are personal_care items where running
 * out has outsized impact (cycle products, baby supplies, contact lenses).
 */
export const CRITICAL_REMINDER_CANONICAL: ReadonlySet<string> = new Set<string>([
  // ── period products ─────────────────────────────────────────────────────
  'tampons',
  'pads',
  'panty liners',
  'liners',
  'menstrual cup',
  // ── baby supplies ───────────────────────────────────────────────────────
  'diapers',
  'baby wipes',
  'baby formula',
  // ── vision (contacts kept here even though personal_care, not wellness) ──
  'contact solution',
  'contact lens solution',
  'contact lenses',
  'contacts',
  // ── pet exceptions called out by the brief, kept explicit even though
  //    they ALSO match the 'pet' category default. Belt-and-braces for
  //    canonicals readers might check against this set directly. ──────────
  'pet medication',
  'flea treatment',
  'tick treatment',
  'cat litter',
  'dog food',
  'cat food',
  'puppy food',
  'kitten food',
]);

/**
 * Does this canonical default to remind_me=true?
 *
 * Resolution order (mirrors lookupShelfLifeDetail):
 *   1. Direct hit in SHELF_LIFE_DETAIL → check category + explicit set.
 *   2. Alias hit via ALIAS_MAP → resolve to canonical, then check.
 *   3. Explicit set hit on the raw lowercased name (covers names not yet
 *      in SHELF_LIFE_DETAIL — e.g. user-typed 'baby formula' before it
 *      lands in the dataset).
 *   4. false.
 *
 * Case-insensitive.
 */
export function isCriticalReminder(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  const norm = name.trim().toLowerCase();
  if (norm.length === 0) return false;

  const direct = SHELF_LIFE_DETAIL[norm];
  if (direct) {
    if (direct.category === 'wellness') return true;
    if (direct.category === 'pet') return true;
    if (CRITICAL_REMINDER_CANONICAL.has(norm)) return true;
    return false;
  }

  const canonical = ALIAS_MAP[norm];
  if (canonical) {
    const detail = SHELF_LIFE_DETAIL[canonical];
    if (detail) {
      if (detail.category === 'wellness') return true;
      if (detail.category === 'pet') return true;
    }
    if (CRITICAL_REMINDER_CANONICAL.has(canonical)) return true;
  }

  // Final fallback: explicit set hit on the raw name.
  return CRITICAL_REMINDER_CANONICAL.has(norm);
}

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
  // ── Mutation commands (2026-05-22) ─────────────────────────────────────
  // These set action=remove/check/move_to_pantry and intent=edit. The
  // model uses the CURRENT SHOPPING LIST / CURRENT PANTRY context block
  // appended at the end of the system prompt to disambiguate matches.

  // Plain remove from shopping.
  {
    input: 'remove pasta from the list',
    output: {
      intent: 'edit',
      language: 'en',
      recipeSourceLabel: null,
      items: [
        { name: 'pasta', canonical: 'pasta', category: 'pantry', intent: 'edit', target: 'shopping', action: 'remove' },
      ],
    },
  },
  // Scratch X got some → remove from shopping + add to pantry.
  {
    input: 'scratch the bread, got some',
    output: {
      intent: 'edit',
      language: 'en',
      recipeSourceLabel: null,
      items: [
        { name: 'bread', canonical: 'bread', category: 'pantry', intent: 'edit', target: 'shopping', action: 'move_to_pantry', shelfLifeDays: 7 },
      ],
    },
  },
  // "Got everything except X" — enumerate shop list, mark all except X as
  // checked. The shopping context in the prompt provides the enumeration.
  {
    input: 'got everything except eggs',
    // Implicit context (would be appended by buildSystemPrompt):
    //   CURRENT SHOPPING LIST: milk, eggs, bread, pasta
    output: {
      intent: 'edit',
      language: 'en',
      recipeSourceLabel: null,
      items: [
        { name: 'milk',  canonical: 'milk',  category: 'dairy',  intent: 'edit', target: 'shopping', action: 'check' },
        { name: 'bread', canonical: 'bread', category: 'pantry', intent: 'edit', target: 'shopping', action: 'check' },
        { name: 'pasta', canonical: 'pasta', category: 'pantry', intent: 'edit', target: 'shopping', action: 'check' },
      ],
    },
  },
  // "Finished X" where X is in pantry → remove from pantry (consumed).
  {
    input: 'I finished the milk',
    // Implicit context: CURRENT PANTRY: milk, yogurt
    output: {
      intent: 'edit',
      language: 'en',
      recipeSourceLabel: null,
      items: [
        { name: 'milk', canonical: 'milk', category: 'dairy', intent: 'edit', target: 'pantry', action: 'remove' },
      ],
    },
  },
  // Spoiled — always pantry remove.
  {
    input: 'throw out the yogurt',
    output: {
      intent: 'edit',
      language: 'en',
      recipeSourceLabel: null,
      items: [
        { name: 'yogurt', canonical: 'yogurt', category: 'dairy', intent: 'edit', target: 'pantry', action: 'remove' },
      ],
    },
  },
  // Turkish — "listeden çıkar" remove from list.
  {
    input: 'pastayı listeden çıkar',
    output: {
      intent: 'edit',
      language: 'tr',
      recipeSourceLabel: null,
      items: [
        { name: 'pasta', canonical: 'pasta', category: 'pantry', intent: 'edit', target: 'shopping', action: 'remove' },
      ],
    },
  },
  // Spanish — "quita" remove from list.
  {
    input: 'quita la pasta de la lista',
    output: {
      intent: 'edit',
      language: 'es',
      recipeSourceLabel: null,
      items: [
        { name: 'pasta', canonical: 'pasta', category: 'pantry', intent: 'edit', target: 'shopping', action: 'remove' },
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

/**
 * Render the list-context block appended to the system prompt when the
 * caller passes the user's current lists. Returns an empty string when
 * there's no context — preserves the previous prompt verbatim for
 * existing Gemini cache rows.
 */
function renderListContext(context: GroceryListContext | undefined): string {
  if (!context) return '';
  const shop = (context.shoppingItems ?? [])
    .slice(0, LIST_CONTEXT_CAP)
    .map((i) => (i.canonical ?? i.name))
    .filter((s) => typeof s === 'string' && s.length > 0);
  const pantry = (context.pantryItems ?? [])
    .slice(0, LIST_CONTEXT_CAP)
    .map((i) => (i.canonical ?? i.name))
    .filter((s) => typeof s === 'string' && s.length > 0);
  if (shop.length === 0 && pantry.length === 0) return '';

  const parts: string[] = ['', 'LIST CONTEXT (use this to disambiguate mutation commands):'];
  if (shop.length > 0) parts.push(`CURRENT SHOPPING LIST: ${shop.join(', ')}`);
  if (pantry.length > 0) parts.push(`CURRENT PANTRY: ${pantry.join(', ')}`);
  return parts.join('\n');
}

function buildSystemPrompt(context?: GroceryListContext): string {
  const canonicalSample = CANONICAL_ITEMS.slice(0, 30).join(', ');
  const acquireVerbs = INTENT_VERBS.acquire.slice(0, 8).join(', ');
  const pantryVerbs = INTENT_VERBS.pantry.slice(0, 8).join(', ');
  const contextBlock = renderListContext(context);

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

MUTATION COMMANDS — when the user wants to MODIFY an existing list (remove,
check off, throw out, mark as got), set the item's "action" field. Use the
LIST CONTEXT block below to identify which existing entry the command refers
to. When NO mutation verb is present, leave action="add" (or omit — "add" is
the default).

Set intent="edit" for the top-level fragment AND each item when ANY mutation
verb is detected.

Action values:
- "remove" — remove a single matching item from the target slice.
    Verbs: "remove", "delete", "take X off the list", "scratch X" (alone,
    no possession), "no need for X", "drop X from the list".
    TR: "çıkar", "sil", "listeden çıkar", "kaldır", "iptal".
    ES: "quita", "elimina", "borra", "saca", "saca de la lista".
    target = the slice currently holding the item (shopping or pantry per
    the LIST CONTEXT). When unsure, prefer shopping.

- "move_to_pantry" — combined remove-from-shopping + add-to-pantry. Triggered
    by "scratch X, got some" / "actually I have X already" / "X aldım zaten"
    / "ya tengo X". target="shopping" (the slice we're removing from).

- "check" — mark a single matching item as bought in shopping (the user
    completed the purchase). Triggered when the user lists what they
    already bought. The big multi-item case is "got everything except X" /
    "got all but X" / "all except X" / "menos X" / "excepto X" / "X hariç" —
    for these, enumerate the CURRENT SHOPPING LIST and emit one
    action="check" item per entry EXCEPT X.
    target always = "shopping".

- "remove" from pantry — triggered by "I finished X" / "ran out of X" /
    "used up X" / "threw out X" / "X bitti" / "X bozuldu" / "se acabó X" /
    "se echó a perder X", ONLY when X currently appears in CURRENT PANTRY.
    If X is NOT in pantry then "I finished X" is a DEPLETION signal — emit
    a normal action="add" item with target="shopping" (buy more), not a
    remove. This is the one case where the LIST CONTEXT changes the action.
    target="pantry" for the remove case; target="shopping" for the
    depletion/add case.

- "throw out X" / "X bozuldu" / "se echó a perder X" → always action="remove"
    target="pantry" (spoilage — context doesn't matter; user is telling us
    they discarded it).

DISAMBIGUATION RULES:
- Prefer exact canonical match over substring. "remove pasta" with shopping
  [whole wheat pasta, rice] → match "whole wheat pasta" (canonical="pasta").
- When LIST CONTEXT is empty or absent, still emit the mutation with action
  set — downstream applier uses fuzzy matching as a fallback.
- When you emit a mutation, do NOT also emit a duplicate add. One verb =
  one item (except the "everything except X" case which fans out).

BACKWARD COMPAT: a brain-dump with NO mutation verbs should classify
exactly as it did before mutation support — action="add" (or omitted),
intent in {acquire, plan, pantry, unknown}, never "edit".
${contextBlock}

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
          enum: ['acquire', 'plan', 'pantry', 'unknown', 'edit'],
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
              intent:           { type: 'string', enum: ['acquire', 'plan', 'pantry', 'unknown', 'edit'] },
              target:           { type: 'string', enum: ['shopping', 'pantry'] },
              action:           {
                type: 'string',
                enum: ['add', 'remove', 'check', 'move_to_pantry'],
                description: 'Mutation to apply. Defaults to "add" when omitted.',
              },
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

export const groceryConfig: ModuleConfig<GroceryClassification, GroceryListContext> = {
  moduleName: 'grocery',
  canonicalItems: CANONICAL_ITEMS,
  intentVerbs: INTENT_VERBS,
  categories: CATEGORIES,
  shelfLifeMap: SHELF_LIFE_MAP,
  examples: FEW_SHOT_EXAMPLES,
  buildSystemPrompt,
  buildFunctionSchema,
};
