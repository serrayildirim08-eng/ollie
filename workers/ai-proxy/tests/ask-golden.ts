/**
 * Ask Ollie · golden set. Each entry: a message as a person would type it, and what the router
 * must make of it. Grows with every mistake found in dogfooding.
 *
 * `filter` lists only what MUST be there (values compared case-insensitively; "[NAME]" matches a
 * scrubbed name). A question whose v1 answer is the fallback expects `shape: null`.
 */
export interface AskGolden {
  readonly id: string;
  readonly text: string;
  readonly lang: 'en' | 'nl';
  readonly expect:
    | { readonly kind: 'log' }
    | {
        readonly kind: 'question';
        readonly shape: 'how_much' | 'when_last' | 'how_many' | 'list' | null;
        readonly area?: string;
        readonly period?: string | null;
        readonly filter?: Record<string, string>;
      };
}

const q = (
  id: string,
  lang: 'en' | 'nl',
  text: string,
  shape: 'how_much' | 'when_last' | 'how_many' | 'list' | null,
  area?: string,
  period?: string | null,
  filter?: Record<string, string>,
): AskGolden => ({ id, lang, text, expect: { kind: 'question', shape, area, period, filter } });
const log = (id: string, lang: 'en' | 'nl', text: string): AskGolden => ({ id, lang, text, expect: { kind: 'log' } });

export const ASK_GOLDEN: readonly AskGolden[] = [
  // ─── money ───
  q('fin-much-en-1', 'en', 'how much did I spend this week?', 'how_much', 'finance', 'this_week'),
  q('fin-much-en-2', 'en', 'what did I spend at Albert Heijn this month', 'how_much', 'finance', 'this_month', { merchant: 'albert heijn' }),
  q('fin-much-nl-1', 'nl', 'hoeveel heb ik deze week uitgegeven?', 'how_much', 'finance', 'this_week'),
  q('fin-much-nl-2', 'nl', 'hoeveel heb ik vorige maand bij de Jumbo uitgegeven?', 'how_much', 'finance', 'last_month', { merchant: 'jumbo' }),
  q('fin-last-en', 'en', 'when did I last pay rent?', 'when_last', 'finance'),
  q('fin-last-nl', 'nl', 'wanneer heb ik voor het laatst huur betaald?', 'when_last', 'finance'),
  q('fin-many-en', 'en', 'how many times did I go to Albert Heijn last week?', 'how_many', 'finance', 'last_week', { merchant: 'albert heijn' }),
  q('fin-many-nl', 'nl', 'hoe vaak ben ik deze maand naar de Jumbo geweest?', 'how_many', 'finance', 'this_month', { merchant: 'jumbo' }),
  q('fin-list-en', 'en', 'which subscriptions and bills do I have?', 'list', 'finance'),
  q('fin-list-nl', 'nl', 'welke abonnementen heb ik?', 'list', 'finance'),

  // ─── errands and work ───
  q('adm-list-en', 'en', "what's due this week?", 'list', undefined, 'this_week'),
  q('adm-list-nl', 'nl', 'wat moet ik deze week nog doen?', 'list', undefined, 'this_week'),
  q('work-last-en', 'en', 'when did I last meet Ana?', 'when_last', 'work', null, { person: '[NAME]' }),
  q('work-last-nl', 'nl', 'wanneer had ik voor het laatst een meeting met Ana?', 'when_last', 'work', null, { person: '[NAME]' }),
  q('work-list-en', 'en', 'what work tasks do I have today?', 'list', 'work', 'today'),

  // ─── food ───
  q('gro-list-en', 'en', "what's on my shopping list?", 'list', 'grocery'),
  q('gro-list-nl', 'nl', 'wat staat er op mijn boodschappenlijst?', 'list', 'grocery'),
  q('gro-low-en', 'en', 'what am I running low on in the kitchen?', 'list', 'grocery', null, { status: 'low' }),
  q('gro-low-nl', 'nl', 'wat is er bijna op in de keuken?', 'list', 'grocery', null, { status: 'low' }),
  q('gro-last-en', 'en', 'when did I last cook pasta?', 'when_last', 'grocery', null, { item: 'pasta' }),
  q('gro-last-nl', 'nl', 'wanneer heb ik voor het laatst pasta gekookt?', 'when_last', 'grocery', null, { item: 'pasta' }),

  // ─── body ───
  q('body-much-en', 'en', 'how much water did I drink today?', 'how_much', 'body', 'today'),
  q('body-much-nl', 'nl', 'hoeveel water heb ik vandaag gedronken?', 'how_much', 'body', 'today'),
  q('body-last-en', 'en', 'when did I last have a headache?', 'when_last', 'body'),
  q('body-last-nl', 'nl', 'wanneer had ik voor het laatst hoofdpijn?', 'when_last', 'body'),
  q('body-many-en', 'en', 'how many walks did I take this week?', 'how_many', 'body', 'this_week'),
  q('body-many-nl', 'nl', 'hoe vaak heb ik deze week gewandeld?', 'how_many', 'body', 'this_week'),

  // ─── medication ───
  q('med-last-en', 'en', 'when did I last take my meds?', 'when_last', 'medication'),
  q('med-last-nl', 'nl', 'wanneer heb ik mijn medicijnen voor het laatst genomen?', 'when_last', 'medication'),
  q('med-many-en', 'en', 'how many doses did I miss this month?', 'how_many', 'medication', 'this_month', { status: 'missed' }),
  q('med-many-nl', 'nl', 'hoeveel doses heb ik deze maand gemist?', 'how_many', 'medication', 'this_month', { status: 'missed' }),
  q('med-list-en', 'en', 'which meds am I running low on?', 'list', 'medication'),

  // ─── sleep ───
  q('slp-much-en', 'en', 'how much did I sleep this week?', 'how_much', 'sleep', 'this_week'),
  q('slp-much-nl', 'nl', 'hoeveel heb ik deze week geslapen?', 'how_much', 'sleep', 'this_week'),
  q('slp-last-en', 'en', 'when did I last sleep badly?', 'when_last', 'sleep', null, { status: 'bad' }),
  q('slp-many-en', 'en', 'how many bad nights did I have last week?', 'how_many', 'sleep', 'last_week', { status: 'bad' }),
  q('slp-many-nl', 'nl', 'hoeveel slechte nachten had ik vorige week?', 'how_many', 'sleep', 'last_week', { status: 'bad' }),

  // ─── mood ───
  q('mood-last-en', 'en', 'when did I last feel good?', 'when_last', 'mood', null, { status: 'good' }),
  q('mood-many-en', 'en', 'how many low days did I have this month?', 'how_many', 'mood', 'this_month', { status: 'bad' }),
  q('mood-many-nl', 'nl', 'hoeveel slechte dagen had ik deze maand?', 'how_many', 'mood', 'this_month', { status: 'bad' }),

  // ─── cycle, home, pets, habits, goals ───
  q('cyc-last-en', 'en', 'when did my last period start?', 'when_last', 'cycle'),
  q('cyc-last-nl', 'nl', 'wanneer begon mijn laatste menstruatie?', 'when_last', 'cycle'),
  q('chr-last-en', 'en', 'when did I last clean the bathroom?', 'when_last', 'chores', null, { item: 'bathroom' }),
  q('chr-list-nl', 'nl', 'welke klusjes staan er nog open?', 'list', 'chores'),
  q('pet-last-en', 'en', 'when was Luna last at the vet?', 'when_last', 'pets', null, { pet: '[NAME]' }),
  q('pet-last-nl', 'nl', 'wanneer was Luna voor het laatst bij de dierenarts?', 'when_last', 'pets', null, { pet: '[NAME]' }),
  q('hab-many-en', 'en', 'how many times did I run this month?', 'how_many', 'habits', 'this_month', { item: 'run' }),
  q('hab-last-nl', 'nl', 'wanneer heb ik voor het laatst hardgelopen?', 'when_last', 'habits'),
  q('goal-list-en', 'en', 'what are my goals?', 'list', 'goals'),
  q('goal-list-nl', 'nl', 'wat zijn mijn doelen?', 'list', 'goals'),

  // ─── questions v1 cannot answer: must be questions, with no query ───
  q('none-en-1', 'en', 'am I sleeping enough?', null),
  q('none-en-2', 'en', 'why am I always tired?', null),
  q('none-nl-1', 'nl', 'slaap ik genoeg?', null),
  q('none-nl-2', 'nl', 'waarom ben ik altijd moe?', null),

  // ─── logs that look like questions, and plain logs ───
  log('log-en-1', 'en', 'drank 2 glasses of water'),
  log('log-en-2', 'en', 'paid 40 for gas at Shell'),
  log('log-en-3', 'en', 'can you remind me to call mom tomorrow at 3?'),
  log('log-en-4', 'en', 'remind me to pay rent on the 1st'),
  log('log-en-5', 'en', 'slept badly, woke up at 4'),
  log('log-en-6', 'en', 'took my meds'),
  log('log-en-7', 'en', 'need milk and bread'),
  log('log-en-8', 'en', 'how about I clean the bathroom on saturday'),
  log('log-nl-1', 'nl', 'twee glazen water gedronken'),
  log('log-nl-2', 'nl', '40 euro getankt bij Shell'),
  log('log-nl-3', 'nl', 'kun je me morgen om 3 uur eraan herinneren mama te bellen?'),
  log('log-nl-4', 'nl', 'slecht geslapen, om 4 uur wakker'),
  log('log-nl-5', 'nl', 'medicijnen genomen'),
  log('log-nl-6', 'nl', 'melk en brood nodig'),
];
