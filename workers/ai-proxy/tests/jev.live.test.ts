/**
 * jev.live.test — the Ask Ollie golden set against TypeSafe's Jev (Workers AI `typesafe/jev`), for a
 * side-by-side with the Groq run (tests/ask.live.test.ts: 53/54, 0 mix-ups).
 *
 * Jev only picks from options; it cannot copy words out of the message. So it is judged on
 * kind / shape / area / period / status / lang, and text filters (merchant, item, pet, person) are
 * out of scope here: they would come from the phone's own records (apps/native/src/ask/names.ts).
 *
 * HOW TO RUN (uses the worker's AI binding through wrangler; needs AI Gateway credits)
 *   cd workers/ai-proxy && JEV_LIVE=1 pnpm exec vitest run tests/jev.live
 * It reports; it does not gate anything.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { asLocale, scrubPII } from '@ollie/pii-scrub';
import { ASK_GOLDEN, type AskGolden } from './ask-golden';

const QUESTIONS = {
  kind: {
    type: 'choice',
    instructions:
      'Is this message something to keep, remember, remind or do (a log, even with a question mark, like "can you remind me…"), or a question about what the person already told their assistant?',
    criteria: {
      log: 'A log: a statement, a purchase, a feeling, a to-do, or a request to remind or do something',
      question: 'A question asking for an amount, a last time, a count or a list of their own records',
      both: 'Holds a log AND a question, e.g. "paid 40 for gas, how much this week?"',
    },
  },
  shape: {
    type: 'choice',
    instructions: 'If it is a question: what kind of answer does it want?',
    criteria: {
      how_much: 'A total: money spent, water drunk, hours slept',
      when_last: 'The last time something happened',
      how_many: 'How many times something happened',
      list: 'What is on a list: tasks due, shopping list, subscriptions, goals, meds running low',
      none: 'Not a question, or a question of another kind (why, am I…enough, advice)',
    },
  },
  area: {
    type: 'choice',
    instructions: 'Which part of their life is it about? "[NAME]" is a hidden name; after "at", "to", "bij", "naar" it is usually a shop.',
    criteria: {
      finance: 'Money, spending, shops, bills, subscriptions, rent',
      admin: 'Errands, calls, appointments, paperwork, things due',
      work: 'Work tasks, meetings with people',
      grocery: 'Shopping list, pantry, running low in the kitchen, cooking a dish',
      body: 'Water, symptoms like headaches, walks, exercise, supplements',
      medication: 'Meds, doses, missed doses, meds running low',
      sleep: 'Sleep, nights',
      mood: 'Mood, energy, good or bad days',
      cycle: 'Period, menstruation',
      chores: 'Housework, cleaning',
      pets: 'Pets, vet, feeding',
      habits: 'Things done repeatedly: running, reading, meditating',
      goals: 'Goals',
      none: 'None of these',
    },
  },
  period: {
    type: 'choice',
    instructions: 'Which time span does the question name?',
    criteria: {
      today: 'Today',
      this_week: 'This week',
      last_week: 'Last week',
      this_month: 'This month',
      last_month: 'Last month',
      none: 'No time span named',
    },
  },
  status: {
    type: 'choice',
    instructions: 'Does the question ask about a particular state?',
    criteria: {
      missed: 'Missed (doses)',
      taken: 'Taken (doses)',
      bad: 'A bad, low or rough day or night',
      good: 'A good day, feeling good',
      low: 'Something running out or low in stock',
      open: 'Still open, not done',
      none: 'No particular state',
    },
  },
  lang: {
    type: 'choice',
    instructions: 'Which language is the message in?',
    criteria: { en: 'English', nl: 'Dutch', other: 'Another language' },
  },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ask(env: any, state: string): Promise<{ ms: number; r: any }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const t = Date.now();
      const r = await env.AI.run('typesafe/jev', { state, questions: QUESTIONS });
      return { ms: Date.now() - t, r };
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(2 ** attempt * 2000 + Math.random() * 1000);
    }
  }
  throw new Error('unreachable');
}

const pick = (answers: any, key: string): string | undefined => answers?.[key]?.choice;

function judge(g: AskGolden, a: any): { ok: boolean; mixUp: boolean } {
  const kind = pick(a, 'kind');
  if (g.expect.kind === 'log') return { ok: kind === 'log', mixUp: kind !== 'log' };
  if (kind === 'log') return { ok: false, mixUp: true };
  const e = g.expect;
  if (e.kind !== 'question') return { ok: false, mixUp: false };
  const shape = pick(a, 'shape');
  if (e.shape === null) return { ok: shape === 'none', mixUp: false };
  let ok = shape === e.shape && pick(a, 'lang') === g.lang;
  if (ok && e.area) ok = pick(a, 'area') === e.area;
  if (ok && e.period !== undefined) ok = (pick(a, 'period') === 'none' ? null : pick(a, 'period')) === e.period;
  if (ok && e.filter?.status) ok = pick(a, 'status') === e.filter.status;
  return { ok, mixUp: false };
}

describe.skipIf(process.env.JEV_LIVE !== '1')('Ask Ollie golden set on Jev', () => {
  it('reports accuracy, mix-ups, latency and cost', async () => {
const { env, dispose } = await getPlatformProxy({ configPath: './wrangler.toml' });
try {
  let understood = 0;
  let questions = 0;
  let inputTokens = 0;
  const mixUps: string[] = [];
  const misses: string[] = [];
  const latencies: number[] = [];
  for (const g of ASK_GOLDEN) {
    const { scrubbed } = scrubPII(g.text, asLocale(g.lang));
    const { ms, r } = await ask(env, scrubbed);
    latencies.push(ms);
    inputTokens += r.usage?.input_tokens ?? 0;
    const v = judge(g, r.answers);
    if (g.expect.kind === 'question') {
      questions += 1;
      if (v.ok) understood += 1;
    }
    if (v.mixUp) mixUps.push(g.id);
    if (!v.ok) {
      const got = Object.fromEntries(Object.keys(QUESTIONS).map((k) => [k, pick(r.answers, k)]));
      misses.push(`  MISS ${g.id}: got ${JSON.stringify(got)}`);
    }
  }
  latencies.sort((x, y) => x - y);
  const p = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))];
  process.stdout.write(
    `\nJEV GOLDEN: ${understood}/${questions} questions understood, ${mixUps.length} log/question mix-ups` +
      `\nlatency p50 ${p(0.5)} ms, p90 ${p(0.9)} ms (includes the dev proxy hop)` +
      `\ninput tokens ${inputTokens} (~$${((inputTokens / 1e6) * 0.042).toFixed(5)})\n` +
      misses.join('\n') + '\n',
  );
} finally {
  await dispose();
}
  }, 60 * 60 * 1000);
});
