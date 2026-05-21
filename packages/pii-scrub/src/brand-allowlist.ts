/**
 * Brand allowlist — names that must NEVER be scrubbed.
 *
 * Purpose: shopping pattern learning (grocery module + future modules) depends
 * on real brand signals. Scrubbing "Migros" or "Coca-Cola" destroys the
 * research value of purchase + consumption data.
 *
 * Matching is case-insensitive. Add new brands freely; the set is checked
 * BEFORE any PII category match fires, so an allowlisted brand is always
 * preserved regardless of which scrub layer would have caught it.
 *
 * Scope: retail / grocery / electronics / food + beverage brands most
 * likely to appear in the Turkish + Spanish + English markets Ollie targets.
 */

// Stored lowercase; isBrand() normalises input.
const BRAND_ENTRIES: readonly string[] = [
  // ── Turkish retail + grocery chains ────────────────────────────────────────
  'migros', 'a101', 'bim', 'şok', 'carrefour', 'carrefoursa', 'metro',
  'teknosa', 'mediamarkt', 'vatan', 'hepsiburada', 'trendyol', 'getir',
  'yemeksepeti', 'banabi', 'morhipo', 'zara', 'lcwaikiki', 'koton',
  'boyner', 'vakko', 'mudo', 'defacto',

  // ── Global grocery / CPG brands ────────────────────────────────────────────
  'nestle', 'nestlé', 'unilever', 'procter', 'kraft', 'heinz', 'mondelez',
  'kellogg', 'general mills', 'pepsico', 'cocacola', 'coca-cola', 'pepsi',
  // Coca + Cola listed individually so hyphenated "Coca-Cola" survives the
  // word-boundary tokenizer that splits on hyphens.
  'coca', 'cola',
  'fanta', 'sprite', 'schweppes', 'lipton', 'nescafe', 'nespresso',
  'starbucks', 'mcdonalds', "mcdonald's", 'burger king', 'kfc', 'subway',
  'dominos', "domino's", 'pringles', 'lays', "lay's", 'doritos', 'cheetos',
  'oreo', 'nutella', 'ferrero', 'lindt', 'toblerone', 'haribo',
  'campbells', "campbell's", 'heineken', 'budweiser', 'corona',

  // ── Turkish CPG + food brands ───────────────────────────────────────────────
  'ülker', 'ulker', 'eti', 'sütaş', 'sutas', 'pınar', 'pinar',
  'dimes', 'tamek', 'kent', 'algida', 'magnum', 'cornetto', 'calippo',
  'yudum', 'berrak', 'erikli', 'hamidiye', 'uludağ', 'uludag',

  // ── Electronics / tech ─────────────────────────────────────────────────────
  'apple', 'samsung', 'google', 'microsoft', 'amazon', 'meta',
  'huawei', 'xiaomi', 'oppo', 'oneplus', 'sony', 'lg', 'philips',
  'bosch', 'siemens', 'arçelik', 'arcelik', 'vestel', 'beko',
  'lenovo', 'dell', 'hp', 'asus', 'acer',

  // ── Streaming / apps (appear in finance + habits modules) ──────────────────
  'spotify', 'netflix', 'youtube', 'disney', 'hbo', 'apple tv',
  'amazon prime', 'twitch', 'tiktok', 'instagram', 'whatsapp',
  'telegram', 'discord', 'slack', 'zoom', 'notion', 'figma',

  // ── Pharma / supplement brands (medical module — keep brand, scrub condition)
  'parol', 'nurofen', 'advil', 'tylenol', 'aspirin', 'bayer',
  'pfizer', 'novartis', 'roche', 'abbott', 'centrum', 'ensure',

  // ── Fashion / beauty ────────────────────────────────────────────────────────
  'nike', 'adidas', 'puma', 'reebok', 'new balance', 'converse',
  'h&m', 'mango', 'massimo dutti', 'pull&bear', 'bershka', 'stradivarius',
  'loreal', "l'oreal", 'maybelline', 'lancome', 'clinique',

  // ── Finance / banking brands (money module) ─────────────────────────────────
  'visa', 'mastercard', 'paypal', 'iban', 'swift',
  'garanti', 'akbank', 'yapı kredi', 'yapikredi', 'isbank', 'is bankasi',
  'ziraat', 'halkbank', 'vakifbank', 'enpara',

  // ── Pet brands (pets module) ────────────────────────────────────────────────
  'royal canin', 'purina', 'whiskas', 'pedigree', 'hills', 'eukanuba',

  // ── Health / fitness brands ─────────────────────────────────────────────────
  'fitbit', 'garmin', 'polar', 'suunto', 'oura', 'whoop',
];

const BRAND_SET: ReadonlySet<string> = new Set(BRAND_ENTRIES.map((b) => b.toLowerCase()));

/**
 * Returns true when `word` is an allowlisted brand name.
 * Case-insensitive. The word should be trimmed before calling.
 */
export function isBrand(word: string): boolean {
  return BRAND_SET.has(word.toLowerCase());
}

/** Exposed for diagnostics + tests. */
export const BRAND_COUNT = BRAND_SET.size;
