/**
 * ask/copy — turns an AskResult into the sentence Ollie says, in English or Dutch.
 * Fixed templates filled with computed values: the words are as exact as the numbers,
 * and no model writes them.
 */
import type { AskResult, MoneyTotal } from './engine';
import type { AskLang, NamedPeriod } from './query';

const LOCALE: Record<AskLang, string> = { en: 'en-GB', nl: 'nl-NL' };

const PERIOD: Record<AskLang, Record<NamedPeriod, string>> = {
  en: {
    today: 'today',
    this_week: 'this week',
    last_week: 'last week',
    this_month: 'this month',
    last_month: 'last month',
  },
  nl: {
    today: 'vandaag',
    this_week: 'deze week',
    last_week: 'vorige week',
    this_month: 'deze maand',
    last_month: 'vorige maand',
  },
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function number(value: number, lang: AskLang, fractionDigits = 0): string {
  return new Intl.NumberFormat(LOCALE[lang], {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function money(t: MoneyTotal, lang: AskLang): string {
  if (!t.currency) return number(t.total, lang, 2);
  try {
    return new Intl.NumberFormat(LOCALE[lang], { style: 'currency', currency: t.currency }).format(t.total);
  } catch {
    // A currency code Intl does not know: show it as written.
    return `${number(t.total, lang, 2)} ${t.currency}`;
  }
}

/** "a, b and c" / "a, b en c". (Intl.ListFormat is not in this project's TypeScript lib.) */
function joinList(parts: readonly string[], lang: AskLang): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} ${lang === 'nl' ? 'en' : 'and'} ${parts.at(-1) ?? ''}`;
}

function when(at: number, lang: AskLang, now: number): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(LOCALE[lang], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

/** A stored due date (YYYY-MM-DD) as "25 September" / "25 september". */
function dueDay(due: string, lang: AskLang): string {
  const [y, m, d] = due.split('-').map(Number);
  if (!y || !m || !d) return due;
  return new Intl.DateTimeFormat(LOCALE[lang], { day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
}

const times = (n: number, lang: AskLang) =>
  lang === 'nl' ? `${number(n, lang)} keer` : n === 1 ? 'once' : `${number(n, lang)} times`;

/** Example questions, in the asker's language, for the fallback. */
export const EXAMPLES: Record<AskLang, readonly [string, string]> = {
  en: ['how much did I spend this week?', 'when did I last take my meds?'],
  nl: ['hoeveel heb ik deze week uitgegeven?', 'wanneer heb ik mijn medicijnen voor het laatst genomen?'],
};

export function renderAnswer(result: AskResult, lang: AskLang, now: number = Date.now()): string {
  const nl = lang === 'nl';
  switch (result.kind) {
    case 'money': {
      const period = PERIOD[lang][result.period];
      if (result.count === 0) {
        return nl ? `${capitalise(period)} heb ik geen uitgaven van je.` : `I have no spending from you ${period}.`;
      }
      const totals = joinList(result.totals.map((t) => money(t, lang)), lang);
      const payments = nl
        ? `${number(result.count, lang)} ${result.count === 1 ? 'betaling' : 'betalingen'}`
        : `${number(result.count, lang)} ${result.count === 1 ? 'payment' : 'payments'}`;
      return nl
        ? `${capitalise(period)} heb je ${totals} uitgegeven (${payments}).`
        : `${capitalise(period)} you spent ${totals} (${payments}).`;
    }
    case 'quantity': {
      const period = PERIOD[lang][result.period];
      if (result.count === 0) {
        return nl ? `${capitalise(period)} heb ik daar niets over.` : `I have nothing on that ${period}.`;
      }
      if (result.unit === 'ml') {
        return nl
          ? `${capitalise(period)} heb je ${number(result.total, lang)} ml water gedronken (${times(result.count, lang)}).`
          : `${capitalise(period)} you drank ${number(result.total, lang)} ml of water (${times(result.count, lang)}).`;
      }
      const average = number(result.total / result.count, lang, 1);
      const nights = number(result.count, lang);
      return nl
        ? `${capitalise(period)} heb je ${number(result.total, lang, 1)} uur geslapen in ${nights} ${result.count === 1 ? 'nacht' : 'nachten'}, gemiddeld ${average} uur per nacht.`
        : `${capitalise(period)} you slept ${number(result.total, lang, 1)} hours over ${nights} ${result.count === 1 ? 'night' : 'nights'}, ${average} hours a night on average.`;
    }
    case 'last':
      if (result.at === null) return nl ? 'Daar heb ik nog niets over.' : "I don't have a record of that yet.";
      return nl ? `De laatste keer was ${when(result.at, lang, now)}.` : `The last time was ${when(result.at, lang, now)}.`;
    case 'count': {
      const period = PERIOD[lang][result.period];
      return `${capitalise(period)}: ${times(result.n, lang)}.`;
    }
    case 'list': {
      if (result.items.length === 0) return nl ? 'Daar staat nu niets op.' : 'Nothing there right now.';
      const lines = result.items.map((i) => `• ${i.label}${i.due ? ` (${dueDay(i.due, lang)})` : ''}`);
      return [nl ? 'Dit heb ik:' : "Here's what I have:", ...lines].join('\n');
    }
    case 'fallback': {
      const [a, b] = EXAMPLES[lang];
      return nl
        ? `Die vraag kan ik nog niet beantwoorden. Je kunt bijvoorbeeld vragen: “${a}” of “${b}”`
        : `I can't answer that one yet. You can ask things like “${a}” or “${b}”`;
    }
  }
}

/**
 * The big number on the answer card (Serra, 28 Sep 2026: kept for money and sleep/water), or
 * null when the answer has no single headline figure.
 */
export function headline(result: AskResult, lang: AskLang): string | null {
  if (result.kind === 'money' && result.count > 0 && result.totals.length === 1) {
    return money(result.totals[0], lang);
  }
  if (result.kind === 'quantity' && result.count > 0) {
    return result.unit === 'ml'
      ? `${number(result.total, lang)} ml`
      : `${number(result.total, lang, 1)} ${lang === 'nl' ? 'uur' : 'hours'}`;
  }
  return null;
}

/** The reply to a question in a language v1 does not answer. English and Dutch both, so it reads either way. */
export const OTHER_LANGUAGE_REPLY =
  "I can answer questions in English or Dutch for now. / Ik beantwoord vragen voorlopig in het Engels of Nederlands.";

/** The quiet line under the first answer Ollie ever gives. */
export const COMPUTED_NOTE: Record<AskLang, string> = {
  en: 'Worked out on your phone from what you told me.',
  nl: 'Uitgerekend op je telefoon, uit wat je me vertelde.',
};
