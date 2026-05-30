/**
 * Grocery · critical-reminder gate.
 *
 * Local mirror of the worker's `isCriticalReminder()`
 * (workers/ai-proxy/src/modules/grocery.config.ts). The frontend can't
 * import directly from the worker module (no shared package, would pull
 * the entire 1700-line config), and the worker /shelf-life/all endpoint
 * stores entries as objects but the apps/native ShelfLifeAllResponse type
 * declares them as numbers — so we don't rely on the cache for category
 * info either.
 *
 * Decision (2026-05-30, Plan B push gate locked by Serra):
 *   New pantry rows seed `remind_me=true` when this returns true; everything
 *   else stays silent shopping-list add only. Wellness + pet are the two
 *   whole-category defaults; the explicit set covers period products, baby
 *   supplies, and contacts (personal_care exceptions).
 *
 * Keep this list in lock-step with workers/ai-proxy/src/modules/grocery.config.ts
 * `SHELF_LIFE_DETAIL` wellness + pet entries. If you add a new wellness or
 * pet canonical there, mirror it here. A future sprint can extend the
 * /shelf-life/all wire to surface category and remove this duplication.
 */

/**
 * Frozen lookup set — canonicals that DEFAULT to remind_me=true on insert.
 *
 * Source: walked from workers/ai-proxy/src/modules/grocery.config.ts
 * SHELF_LIFE_DETAIL (commit 9d249a4) — every entry with
 * `category === 'wellness'` or `category === 'pet'`, plus the explicit
 * personal_care subset (period products + baby + contacts).
 */
const LOCAL_CRITICAL_REMINDER_SET: ReadonlySet<string> = new Set<string>([
  // ── wellness (OTC + supplements) ────────────────────────────────────────
  'vitamin c',
  'vitamin d',
  'vitamin b12',
  'vitamin e',
  'vitamin k',
  'multivitamin',
  'magnesium',
  'iron',
  'calcium',
  'zinc',
  'omega 3',
  'fish oil',
  'probiotic',
  'melatonin',
  'ibuprofen',
  'paracetamol',
  'acetaminophen',
  'advil',
  'tylenol',
  'aspirin',
  'naproxen',
  'allergy meds',
  'zyrtec',
  'claritin',
  'benadryl',
  'cold medicine',
  'cough syrup',
  'hand sanitizer',
  'first aid bandage',
  'antiseptic',
  'allergy spray',
  'eye drops',

  // ── pet ─────────────────────────────────────────────────────────────────
  'dry kibble',
  'cat kibble',
  'dog kibble',
  'wet food can',
  'cat food can',
  'dog food can',
  'pet treats',
  'dog treats',
  'cat treats',
  'catnip',
  'cat litter',
  'litter pellets',
  'pee pads',
  'pet shampoo',
  'flea treatment',
  'tick treatment',
  'pet vitamins',
  'hay',
  'guinea pig food',
  'rabbit food',
  'fish food',
  'bird seed',

  // ── explicit personal_care subset (brief 2026-05-30) ────────────────────
  // period products
  'tampons',
  'pads',
  'panty liners',
  'liners',
  'menstrual cup',
  // baby supplies
  'diapers',
  'baby wipes',
  'baby formula',
  // vision
  'contact solution',
  'contact lens solution',
  'contact lenses',
  'contacts',
  // brief-callouts (also pet-category by canonical, but explicit guards)
  'pet medication',
  'dog food',
  'cat food',
  'puppy food',
  'kitten food',
]);

/**
 * Does a freshly inserted pantry row default to `remind_me=true`?
 *
 * Pass the canonical (or any name — we lowercase + trim defensively). If
 * the caller has only the raw name from the AI router, that's fine; the
 * set's keys are normalised lowercase already.
 *
 * Note: this does NOT walk aliases (e.g. 'tampon' → 'tampons'). The Layer-1
 * router canonicalises before reaching the pantry repo, so the canonical
 * is what hits this gate. The repo's `add({ name })` normalises whitespace
 * + case via `normaliseName`, which is consistent with the keys here.
 */
export function isCriticalReminderLocal(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  const norm = name.trim().toLowerCase();
  if (norm.length === 0) return false;
  return LOCAL_CRITICAL_REMINDER_SET.has(norm);
}

/** Test-only escape hatch — exposes the underlying set for invariants. */
export function _getCriticalReminderSetForTests(): ReadonlySet<string> {
  return LOCAL_CRITICAL_REMINDER_SET;
}
