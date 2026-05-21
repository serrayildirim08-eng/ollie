/**
 * @ollie/logic/dissection · fallback-route
 *
 * Keyword-based router. Direct port of fallbackRoute() from void-app.html
 * (~line 3482). Pure: no I/O, no globals, no wall-clock reads.
 */

import type { Action, AnswerRoute, ModuleName, Route } from './types';

// ─── keyword map (EN + TR) ───────────────────────────────────────────────────

// NOTE — no `reminders` entry. Reminder semantics are handled UPSTREAM in
// apps/web/src/hooks/useApplyBrainDump.ts: parseReminder() runs before the
// keyword router and, on a hit, schedules the reminder via
// reminderScheduler.add() (which writes the reminders store slice + emits
// `void:reminder:scheduled` for the iOS local-notification bridge). If we
// also routed `reminders` here, dispatchAction's default fallthrough would
// write the same text into `reminders.items` — a slice no UI module reads,
// so the entry would silently vanish (the "phantom reminders" bug). Time-
// only phrases the parser misses ("tomorrow morning") harmlessly fall
// through to dump.items via the catch-all at the bottom of fallbackRoute.
const KEYWORD_MAP: Record<string, readonly string[]> = {
  grocery: [
    'egg','milk','bread','coffee','buy','grocery','food','cook','recipe','snack','fruit','vegetable','meat','cheese','rice','pasta','oil','sugar','flour','tea','juice','cereal','yogurt','butter','chicken','fish','beef','tomato','onion','garlic','potato','banana','apple','toilet paper','paper towel','soap','shampoo','detergent','sponge',
    'yumurta','süt','ekmek','kahve','aldım','alacağım','ihtiyaç','market','yemek','pişir','sebze','meyve','peynir','pirinç','yoğurt','tereyağ','tavuk','domates','soğan','sarımsak','patates','muz','elma','çay','makarna','tuvalet kağıdı','şampuan','sabun','deterjan',
  ],
  pets: [
    'guinea pig','hay','pellet','cage','vet','pet',
    'kedi','köpek','balık','kuş','hayvan','mama','veteriner','kafes','saman',
  ],
  finance: [
    'rent','bill','money','pay','salary','budget','savings','subscription','netflix','spotify','debt','loan','bank','tax','insurance',
    'kira','fatura','para','öde','ödedim','maaş','bütçe','birikim','abonelik','borç','kredi','banka','vergi','sigorta','harcadım',
  ],
  habits: [
    'workout','exercise','meditate','clean','organize','read','journal','yoga','stretch','laundry','dishes','vacuum','mop','bathroom','kitchen','tidy','make bed','brush teeth','skincare',
    'spor yap','egzersiz','meditasyon','temizlik','temizle','düzenle','okudum','esneme','çamaşır','bulaşık','süpür','banyo','mutfak','toparla','diş fırçala',
  ],
  sleep: [
    'sleep','tired','insomnia','nap','bed','wake','dream','melatonin',
    'uyku','yorgun','uykusuz','uyudum','uyan','kestirdim','rüya',
  ],
  cycle: [
    'period','menstrual','cycle','cramp','pms','ovulation',
    'adet','regl','kramp','ovulasyon',
  ],
  work: [
    'meeting','deadline','project','client','presentation','report','boss','coworker','task','focus',
    'toplantı','proje','müşteri','sunum','rapor','patron','iş arkadaşı','görev','odaklan',
  ],
  goals: [
    'goal','dream','plan','milestone','achieve','aspire',
    'hedef','hayal','başar',
  ],
  admin: [
    'appointment','doctor','dentist','renew','passport','license','plumber','repair','electrician',
    'randevu','doktor','diş hekimi','yenile','pasaport','ehliyet','tesisatçı','tamir','elektrikçi',
  ],
  astrology: [
    'horoscope','zodiac','mercury','birth chart','moon','star sign',
    'burç','merkür','doğum haritası','yükselen',
  ],
  body: [
    'water intake','supplement','posture','steps','walk','hydrate',
    'su iç','takviye','vitamin','yürüyüş','adım','duruş',
  ],
  health: [
    'sprain','injury','injured','sick','illness','flu','cold','fever','pain','hurt','fracture','broken','wound','bruise','headache','migraine','nausea','sore','ache','swollen','recovery','healing','symptom','medication','antibiotic','doctor visit','urgent care','emergency','surgery','stitches','bandage','cast','crutch','physical therapy','pt','rest day','flare up','chronic','allergy','allergic',
    'burkulma','yaralı','hasta','hastalık','grip','soğuk algınlığı','ateş','ağrı','acıyor','kırık','yara','baş ağrısı','migren','bulantı','ilaç','antibiyotik','alerji',
  ],
};

// Modules where the action is 'log' rather than 'add'.
const LOG_MODULES = new Set<string>(['sleep', 'astrology', 'dump']);

// ─── cycle symptom + product patterns ────────────────────────────────────────

interface CycleSymptomPattern {
  name: string;
  re: RegExp;
}

const CYCLE_SYMPTOM_PATTERNS: readonly CycleSymptomPattern[] = [
  { name: 'cramps',            re: /\bcramps?\b/ },
  { name: 'pms',               re: /\bpms\b/ },
  { name: 'bloating',          re: /\bbloat(ed|ing)?\b/ },
  { name: 'headache',          re: /\bheadache\b|\bmigraine\b/ },
  { name: 'back pain',         re: /\bback (pain|ache|sore|hurts?)\b|\blower back\b/ },
  { name: 'breast tenderness', re: /\bbreast (tender|sore|hurts?)\b|\bsore breasts?\b/ },
  { name: 'spotting',          re: /\bspotting\b|\bbreakthrough bleed/ },
  { name: 'cravings',          re: /\bcraving/ },
  { name: 'mood swings',       re: /\bmood (swing|swings)\b|\birritab/ },
  { name: 'brain fog',         re: /\bbrain fog\b|\bfoggy\b/ },
  { name: 'nausea',            re: /\bnausea\b|\bnauseous\b|\bqueasy\b/ },
  { name: 'fatigue',           re: /\bfatigue\b|\bexhausted\b|\bdrained\b/ },
  { name: 'acne',              re: /\bacne\b|\bbreakout/ },
];

interface ProductPattern {
  label: string;
  type: string;
  re: RegExp;
}

const PRODUCT_PATTERNS: readonly ProductPattern[] = [
  { label: 'tampons',          type: 'tampon',           re: /\btampons?\b/ },
  { label: 'pads',             type: 'pad',              re: /\bpads?\b(?!\s*(?:heat|electric|note))/ },
  { label: 'liners',           type: 'liner',            re: /\bliners?\b|\bpanty[- ]?liner/ },
  { label: 'menstrual cup',    type: 'cup',              re: /\bmenstrual cup\b|\bdiva cup\b/ },
  { label: 'menstrual disc',   type: 'disc',             re: /\bmenstrual disc\b/ },
  { label: 'period underwear', type: 'period-underwear', re: /\bperiod (underwear|undies|pant(y|ies)|brief)/ },
];

// Cycle symptoms that are unambiguous enough to log without broader cycle context.
const CYCLE_UNAMBIGUOUS = new Set<string>(['cramps', 'pms', 'spotting', 'cravings', 'breast tenderness', 'mood swings']);

// ─── emotion words → always also log to dump ─────────────────────────────────

const EMOTION_WORDS = [
  'feel','feeling','horrible','terrible','sad','angry','anxious','stressed',
  'overwhelmed','depressed','happy','excited','worried','frustrated',
  'exhausted','meh','ugh','hate','love','miss','scared','lonely','bored',
] as const;

// ─── main export ─────────────────────────────────────────────────────────────

export function fallbackRoute(text: string): Route {
  const lower = text.toLowerCase().trim();

  // ── question detection ──────────────────────────────────────────────────
  const isQuestion =
    lower.endsWith('?') ||
    /^(when|what|where|how|why|do i|did i|is my|are my|have i|should i|can i|will i|am i)/.test(lower) ||
    /^(ne |nerede|nereye|nereden|nasıl|niye|neden|kim|kaç|hangi)\b/.test(lower) ||
    /\b(mı|mi|mu|mü)\?$/.test(lower);

  if (isQuestion) {
    const lookupModules: ModuleName[] = [];
    if (/bill|rent|money|pay|finance|subscription|salary|budget/.test(lower))      lookupModules.push('finance');
    if (/guinea|pet|hay|feed|cage/.test(lower))                                     lookupModules.push('pets');
    if (/grocery|food|buy|store|fridge|pantry|egg|milk|bread/.test(lower))         lookupModules.push('grocery');
    if (/habit|workout|exercise|meditat|clean|journal/.test(lower))                 lookupModules.push('habits');
    if (/sleep|tired|insomnia|nap|bed/.test(lower))                                 lookupModules.push('sleep');
    if (/period|cycle|cramp|pms/.test(lower))                                       lookupModules.push('cycle');
    if (/work|meeting|deadline|project|task/.test(lower))                           lookupModules.push('work');
    if (/goal|dream|plan|milestone/.test(lower))                                    lookupModules.push('goals');
    if (/doctor|dentist|appointment|renew|passport/.test(lower))                    lookupModules.push('admin');
    if (/water|supplement|posture|walk|step/.test(lower))                           lookupModules.push('body');
    const answer: AnswerRoute = {
      isAnswer: true,
      type: 'answer',
      text: 'checking...',
      lookupModules: lookupModules.length > 0 ? lookupModules : ['dump'],
    };
    return answer;
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  const hasEmotion = EMOTION_WORDS.some(w => lower.includes(w));
  const hasCycleContext =
    /\b(started|starting|got|began)\s+(my\s+)?period\b|\bperiod\s+(started|began|came|here)\b|\bcame on\b/i.test(lower) ||
    /\bperiod\s+(ended|done|over|stopped|finished)\b|\bstopped bleeding\b/i.test(lower) ||
    /\b(period|cycle|ovulation)\b/.test(lower);

  let daysAgo: number | undefined;
  const daysMatch = lower.match(/(\d+)\s*days?\s*ago/);
  if (daysMatch) {
    daysAgo = parseInt(daysMatch[1], 10);
  } else if (/\byesterday\b/.test(lower)) {
    daysAgo = 1;
  } else if (/\btoday\b|\bthis morning\b|\btonight\b/.test(lower)) {
    daysAgo = 0;
  }

  const clauses = lower
    .split(/[,.;]+|\s+and\s+|\s+also\s+|\s+plus\s+/)
    .map(c => c.trim())
    .filter(Boolean);

  const events: Action[] = [];
  const seen = new Set<string>();

  const pushEvent = (e: Omit<Action, 'daysAgo'>): void => {
    const k = `${e.module}:${e.action}:${e.data}`;
    if (seen.has(k)) return;
    seen.add(k);
    events.push({ ...e });
  };

  // ── clause-level cycle + product matching ────────────────────────────────
  for (const clause of clauses) {
    if (/\b(started|starting|got|began)\s+(my\s+)?period\b|\bperiod\s+(started|began|came|here)\b|\bcame on\b/.test(clause)) {
      pushEvent({ module: 'cycle', action: 'started', data: 'period started' });
    }
    if (/\bperiod\s+(ended|done|over|stopped|finished)\b|\bstopped bleeding\b/.test(clause)) {
      pushEvent({ module: 'cycle', action: 'ended', data: 'period ended' });
    }

    for (const p of CYCLE_SYMPTOM_PATTERNS) {
      if (!p.re.test(clause)) continue;
      if (!CYCLE_UNAMBIGUOUS.has(p.name) && !hasCycleContext) continue;
      pushEvent({ module: 'cycle', action: 'symptom', data: p.name });
    }

    for (const p of PRODUCT_PATTERNS) {
      if (!p.re.test(clause)) continue;
      const boughtHere = /\b(bought|picked up|grabbed|got a (box|pack)|restocked)\b/.test(clause);
      const needHere   = /\b(need|out of|running low|ran out|no more)\b/.test(clause);
      const tail = p.label.split(' ').slice(-1)[0];
      const cm = clause.match(new RegExp(`(\\d+)\\s*(?:super|regular|light|ultra|heavy)?\\s*${tail}`, 'i'));
      const count = cm ? parseInt(cm[1], 10) : (/\bbox\b|\bpack\b/.test(clause) ? 20 : 1);
      if (boughtHere) {
        // Bought period product: log to cycle productUse AND restock
        // the grocery pantry. Pantry uses module='grocery' action='log'
        // (see applyRoute) — different from action='add' which puts
        // it on the shopping list.
        pushEvent({ module: 'cycle', action: 'productUse', data: `${count} ${p.label}`, productType: p.type, productCount: count });
        pushEvent({ module: 'grocery', action: 'log', data: p.label });
      } else if (needHere) {
        pushEvent({ module: 'grocery', action: 'add', data: `${count > 1 ? `${count} ` : ''}${p.label}` });
      } else {
        pushEvent({ module: 'grocery', action: 'add', data: p.label });
      }
    }
  }

  // ── generic keyword matching (full-text, post-clause) ───────────────────
  const coveredByPattern = new Set(events.map(e => e.module));
  for (const [mod, keywords] of Object.entries(KEYWORD_MAP)) {
    if (mod === 'cycle') continue;
    if (mod === 'grocery' && coveredByPattern.has('grocery')) continue;
    if (!keywords.some(kw => lower.includes(kw))) continue;
    const action = LOG_MODULES.has(mod) ? 'log' : 'add';
    pushEvent({ module: mod as ModuleName, action, data: text });
  }

  // ── emotion fallback ─────────────────────────────────────────────────────
  if (hasEmotion && !events.some(e => e.module === 'dump')) {
    events.push({ module: 'dump', action: 'log', data: text });
  }

  // ── catch-all ────────────────────────────────────────────────────────────
  if (events.length === 0) {
    events.push({ module: 'dump', action: 'log', data: text });
  }

  // ── stamp daysAgo ────────────────────────────────────────────────────────
  if (daysAgo !== undefined) {
    for (const e of events) e.daysAgo = daysAgo;
  }

  return events;
}
