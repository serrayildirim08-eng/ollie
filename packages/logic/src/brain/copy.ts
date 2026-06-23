/**
 * @ollie/logic · brain · "speak in your words" — copy generation (pure)
 *
 * Sprint 3. Replaces the hardcoded noticing sentences (e.g. the Sprint-1 milk
 * string "your milk's probably run low…") with AI-generated, situation-fitted
 * copy — in the user's APP language (EN / ES / TR), calm + neutral, one quiet
 * sentence that may offer to act but never nags or shames.
 *
 * Everything here is PURE + unit-testable:
 *   - {@link buildCopyPrompt}  the system + user prompt the AI is given.
 *   - {@link fallbackCopy}     a clean trilingual hardcoded sentence per
 *                              noticing kind, used whenever the AI is off /
 *                              errors. The surface must ALWAYS show something.
 *
 * The native side owns the actual AI fetch + the per-(noticing, day) cache; it
 * passes these facts in and falls back to {@link fallbackCopy} on any miss.
 */

// ─── app language (Serra-locked: EN + ES + TR ship) ──────────────────────────

/** The three shipping app languages for noticing copy. */
export type AppLang = 'en' | 'es' | 'tr';

/** All supported app languages, in display order. */
export const APP_LANGS: readonly AppLang[] = ['en', 'es', 'tr'] as const;

/** The default app language when none is stored. */
export const DEFAULT_LANG: AppLang = 'en';

/**
 * Coerce an arbitrary stored value to a supported {@link AppLang}, defaulting
 * to {@link DEFAULT_LANG}. Tolerant of region tags ('en-US' → 'en') + casing.
 */
export function resolveLang(value: unknown): AppLang {
  const raw = (value ?? '').toString().trim().toLowerCase();
  const base = raw.split(/[-_]/)[0];
  return (APP_LANGS as readonly string[]).includes(base) ? (base as AppLang) : DEFAULT_LANG;
}

// ─── the facts the AI (and the fallback) get ────────────────────────────────

/**
 * The "kind" of noticing — coarse enough to map to a clean fallback sentence
 * and to a tight tone instruction. Derived from the candidate's category /
 * module by {@link copyKindOf}. 'generic' is the always-safe catch-all.
 */
export type CopyKind =
  | 'replenish' // grocery run-out — the milk noticing. May offer to add to list.
  | 'deadline' // a deadline slipped / is near.
  | 'bill' // a bill looks due / late.
  | 'spoiled' // something in the kitchen probably turned.
  | 'sleep_debt' // hours of sleep deficit piled up — may offer to lighten today.
  | 'decision' // a recurring decision left open — may offer to bring to today.
  | 'caffeine' // late caffeine ↔ sleep insight (B — insight only, no action).
  // ── wave 2 (richer admin offers) ──
  | 'paperwork_piling' // several admin tasks haven't moved — offer to surface them.
  | 'chronic_deferral' // same task put off repeatedly — offer a smaller first step.
  | 'renewal_cluster' // 2+ renewals land the same month — offer to batch them.
  | 'task_archive' // a date-less task survived the whole reminder ladder — offer to archive.
  | 'generic';

/**
 * The situation facts handed to the AI + the fallback. Deliberately small +
 * serialisable so the native cache key can be derived from it and the worker
 * prompt stays tight. NO PII beyond an item name (a grocery item like "milk").
 */
export interface CopyFacts {
  /** Coarse kind, drives tone + fallback sentence. */
  kind: CopyKind;
  /** The item / subject, when there is one (e.g. 'milk', 'rent'). */
  item?: string | null;
  /** How many days past the relevant date, when known (run-out / due). */
  days?: number | null;
  /** Count of sibling items of the same kind (e.g. "milk and 2 others"). */
  otherCount?: number | null;
  /** The action this noticing can offer, if any — shapes the closing offer. */
  action?: CopyActionKind | null;
}

/** What an offered action does — used to phrase the offer ("add to list?"). */
export type CopyActionKind =
  | 'add_to_grocery_list'
  | 'defer_tasks'
  | 'add_admin_task'
  | 'surface_decision'
  | 'surface_tasks'
  | 'break_down_task'
  | 'batch_block'
  | 'archive_task';

// ─── kind resolution ─────────────────────────────────────────────────────────

/**
 * Map a candidate's category / module onto a {@link CopyKind}. Mirrors the
 * defer-map's category vocabulary (select.ts) but coarser. Pure + total.
 */
export function copyKindOf(input: { category?: string | null; module?: string | null }): CopyKind {
  const cat = (input.category ?? '').toString().toLowerCase();
  const mod = (input.module ?? '').toString().toLowerCase();
  if (cat.includes('replenish')) return 'replenish';
  if (cat.includes('sleep-debt') || cat.includes('sleep_debt')) return 'sleep_debt';
  if (cat.includes('caffeine')) return 'caffeine';
  if (cat.includes('paperwork')) return 'paperwork_piling';
  if (cat.includes('chronic-deferral') || cat.includes('chronic_deferral')) return 'chronic_deferral';
  if (cat.includes('renewal-cluster') || cat.includes('renewal_cluster')) return 'renewal_cluster';
  if (cat.includes('task-archive') || cat.includes('task_archive')) return 'task_archive';
  if (cat.includes('decision')) return 'decision';
  if (cat.includes('spoiled')) return 'spoiled';
  if (cat.includes('bill') || cat.includes('late')) return 'bill';
  if (cat.includes('deadline') || cat.includes('overdue') || cat.includes('missed') || cat.includes('due')) {
    return 'deadline';
  }
  if (mod === 'grocery' && cat.includes('replenish')) return 'replenish';
  return 'generic';
}

// ─── the prompt ──────────────────────────────────────────────────────────────

const LANG_NAME: Record<AppLang, string> = {
  en: 'English',
  es: 'Spanish',
  tr: 'Turkish',
};

const ACTION_DESCRIPTION: Record<CopyActionKind, string> = {
  add_to_grocery_list: 'you can offer to add the item back onto the shopping list',
  defer_tasks: "you can offer to push today's non-urgent tasks to tomorrow",
  add_admin_task: 'you can offer to add it to the to-do list',
  surface_decision: 'you can offer to bring the decision to today',
  surface_tasks: "you can offer to bring these to today's focus",
  break_down_task: 'you can offer to break it into a smaller first step',
  batch_block: 'you can offer to batch them into one block',
  archive_task: 'you can ask whether to keep it or archive it',
};

/**
 * Build the system + user prompt for the brain-copy AI call. Pure: returns the
 * two strings; the native worker call wraps them. The system prompt hard-codes
 * Serra's locked VOICE (calm / neutral assistant, one sentence, may offer to
 * act, never nag / shame, honours no-streak / minimal) and the target language.
 */
export function buildCopyPrompt(facts: CopyFacts, lang: AppLang): { system: string; user: string } {
  const langName = LANG_NAME[lang] ?? LANG_NAME.en;
  const offer = facts.action ? ACTION_DESCRIPTION[facts.action] : null;

  const system = [
    `You write ONE short, calm, neutral sentence for a personal life-assistant.`,
    `Write it in ${langName}. Lowercase, plain, no emoji, no exclamation marks.`,
    `Voice: a quiet assistant stating a fact and, if there is an action, offering it once.`,
    `NOT warm-gushy, NOT jokey, NOT salesy, NOT cheerful. Never nag, never shame,`,
    `never mention streaks, never scold, never use urgency words like "must" or "now".`,
    `Translate any item / product name into ${langName} (e.g. milk / leche / süt).`,
    `EXCEPTION: keep brand names and proper nouns whose translation is unclear exactly as given.`,
    offer
      ? `If it helps, ${offer} — phrase it as a soft question (e.g. "want it back on the list?").`
      : `Do not invent an action; just note the situation in one calm sentence.`,
    `Output ONLY the sentence — no quotes, no preamble, no label.`,
  ].join('\n');

  const parts: string[] = [`situation: ${facts.kind}`];
  if (facts.item) parts.push(`item: ${facts.item}`);
  if (typeof facts.days === 'number' && Number.isFinite(facts.days)) {
    parts.push(`days past: ${Math.round(facts.days)}`);
  }
  if (typeof facts.otherCount === 'number' && facts.otherCount > 0) {
    parts.push(`other similar items: ${facts.otherCount}`);
  }
  if (facts.action) parts.push(`offered action: ${facts.action}`);

  const user = `Write the sentence for this situation:\n${parts.join('\n')}`;
  return { system, user };
}

// ─── trilingual fallback table (CRITICAL — never blank, never an error) ──────
//
// Used whenever the AI is unavailable / offline / errors. Calm one-liners that
// honour the exact same voice. Keyed by kind × language. The replenish/milk
// kind is the Sprint-1 reference; Serra's locked example is the TR string.

type Phrase = (f: CopyFacts) => string;

const FALLBACK: Record<CopyKind, Record<AppLang, Phrase>> = {
  replenish: {
    en: (f) =>
      f.otherCount && f.otherCount > 0
        ? `you're probably out of ${itemOr(f, 'a few things')} and ${f.otherCount} other${f.otherCount === 1 ? '' : 's'}. want them back on the list?`
        : `you're probably out of ${itemOr(f, 'something')}. want it back on the list?`,
    es: (f) =>
      f.otherCount && f.otherCount > 0
        ? `seguramente se te acabó ${itemOr(f, 'algo')} y ${f.otherCount} cosa${f.otherCount === 1 ? '' : 's'} más. ¿los pongo en la lista?`
        : `seguramente se te acabó ${itemOr(f, 'algo')}. ¿lo pongo en la lista?`,
    tr: (f) =>
      f.otherCount && f.otherCount > 0
        ? `${itemOr(f, 'birkaç şey')} ve ${f.otherCount} şey daha büyük ihtimalle bitti. listene ekleyeyim mi?`
        : `${itemOr(f, 'bir şey')} büyük ihtimalle bitti. listene ekleyeyim mi?`,
  },
  deadline: {
    en: () => `a deadline slipped past — want to pick it back up?`,
    es: () => `se pasó una fecha límite — ¿quieres retomarla?`,
    tr: () => `bir son tarih geçmiş — geri almak ister misin?`,
  },
  bill: {
    en: () => `a recurring bill looks past its usual date — worth a look?`,
    es: () => `una factura recurrente pasó su fecha habitual — ¿le echamos un ojo?`,
    tr: () => `düzenli bir fatura her zamanki tarihini geçmiş gibi — bir bakalım mı?`,
  },
  spoiled: {
    en: () => `something in the kitchen probably turned — no rush, just a heads up.`,
    es: () => `algo en la cocina seguramente se echó a perder — sin prisa, solo un aviso.`,
    tr: () => `mutfakta bir şey büyük ihtimalle bozuldu — acelesi yok, sadece haber vereyim.`,
  },
  sleep_debt: {
    en: (f) =>
      typeof f.days === 'number' && f.days > 0
        ? `about ${Math.round(f.days)} hours of sleep debt have piled up — keep today lighter?`
        : `a little sleep debt has piled up — keep today lighter?`,
    es: (f) =>
      typeof f.days === 'number' && f.days > 0
        ? `se han acumulado unas ${Math.round(f.days)} horas de sueño — ¿hacemos hoy más ligero?`
        : `se ha acumulado algo de sueño — ¿hacemos hoy más ligero?`,
    tr: (f) =>
      typeof f.days === 'number' && f.days > 0
        ? `yaklaşık ${Math.round(f.days)} saatlik uyku borcu birikmiş — bugünü hafif tutalım mı?`
        : `biraz uyku borcu birikmiş — bugünü hafif tutalım mı?`,
  },
  decision: {
    en: () => `a decision has been open for a while — bring it to today?`,
    es: () => `una decisión lleva un tiempo pendiente — ¿la traemos a hoy?`,
    tr: () => `bir karar bir süredir açık duruyor — bugüne getirelim mi?`,
  },
  paperwork_piling: {
    en: (f) =>
      typeof f.otherCount === 'number' && f.otherCount > 0
        ? `${f.otherCount} admin things haven't moved in a while — bring them to today?`
        : `a few admin things haven't moved in a while — bring them to today?`,
    es: (f) =>
      typeof f.otherCount === 'number' && f.otherCount > 0
        ? `${f.otherCount} cosas administrativas llevan tiempo sin moverse — ¿las traemos a hoy?`
        : `algunas cosas administrativas llevan tiempo sin moverse — ¿las traemos a hoy?`,
    tr: (f) =>
      typeof f.otherCount === 'number' && f.otherCount > 0
        ? `${f.otherCount} idari iş bir süredir kıpırdamadı — bugüne getirelim mi?`
        : `birkaç idari iş bir süredir kıpırdamadı — bugüne getirelim mi?`,
  },
  chronic_deferral: {
    en: () => `you've put this off a few times — want to break it into a smaller first step?`,
    es: () => `lo has pospuesto varias veces — ¿lo dividimos en un primer paso más pequeño?`,
    tr: () => `bunu birkaç kez erteledin — daha küçük bir ilk adıma bölelim mi?`,
  },
  renewal_cluster: {
    en: () => `two renewals land around the same time — batch them one day?`,
    es: () => `dos renovaciones caen por las mismas fechas — ¿las juntamos un día?`,
    tr: () => `iki yenileme aynı zamana denk geliyor — bir günde toplayalım mı?`,
  },
  // Dateless ladder final tier: the task has gone un-acted for a month of
  // reminders. Ask once, calmly, whether it's still wanted or should archive.
  task_archive: {
    en: (f) => `"${itemOr(f, 'a task')}" has sat untouched for a while — still want it, or archive it?`,
    es: (f) => `"${itemOr(f, 'una tarea')}" lleva tiempo sin tocarse — ¿la quieres aún o la archivo?`,
    tr: (f) => `"${itemOr(f, 'bir görev')}" bir süredir el değmeden duruyor — hâlâ istiyor musun, yoksa arşivleyeyim mi?`,
  },
  // Insight-only (B): no offer, no action — just a calm observation. When the
  // detector carried its measured onset delay (in facts.days), name it.
  caffeine: {
    en: (f) =>
      typeof f.days === 'number' && f.days > 0
        ? `late caffeine tends to delay your sleep by about ${Math.round(f.days)} minutes.`
        : `late caffeine tends to delay your sleep a little.`,
    es: (f) =>
      typeof f.days === 'number' && f.days > 0
        ? `la cafeína tarde suele retrasar tu sueño unos ${Math.round(f.days)} minutos.`
        : `la cafeína tarde suele retrasar un poco tu sueño.`,
    tr: (f) =>
      typeof f.days === 'number' && f.days > 0
        ? `geç saatte kafein uykunu yaklaşık ${Math.round(f.days)} dakika geciktiriyor.`
        : `geç saatte kafein uykunu biraz geciktiriyor.`,
  },
  generic: {
    en: () => `something might be worth a glance.`,
    es: () => `quizá algo merezca un vistazo.`,
    tr: () => `bir şeye göz atmakta fayda olabilir.`,
  },
};

function itemOr(f: CopyFacts, dflt: string): string {
  const item = (f.item ?? '').toString().trim();
  return item || dflt;
}

/**
 * The clean, calm fallback sentence for a kind × language. ALWAYS returns a
 * non-empty string — the surface can never blank or error. Unknown kinds fall
 * through to 'generic'; unknown langs to {@link DEFAULT_LANG}.
 */
export function fallbackCopy(facts: CopyFacts, lang: AppLang): string {
  const byLang = FALLBACK[facts.kind] ?? FALLBACK.generic;
  const phrase = byLang[lang] ?? byLang[DEFAULT_LANG] ?? FALLBACK.generic[DEFAULT_LANG];
  return phrase(facts);
}
