/**
 * Ask Ollie · answer engine against a real in-memory SQLite with every module's real schema.
 * The expected answers are computed by hand from the rows seeded below.
 */
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const db = new DatabaseSync(':memory:');

// A function declaration, so the hoisted vi.mock calls can use it; `db` is only read when a query runs.
function storageMock() {
  return {
    sql: {
      async execute(query: string, params: unknown[] = []) {
        db.prepare(query).run(...(params as never[]));
        return { rowsAffected: 0 };
      },
      async select<T>(query: string, params: unknown[] = []): Promise<T[]> {
        return db.prepare(query).all(...(params as never[])) as T[];
      },
    },
    async addColumnIfMissing(table: string, column: string, definition: string) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    },
  };
}
vi.mock('../storage', () => storageMock());
vi.mock('../storage/sqlite', () => storageMock());
vi.mock('../../storage', () => storageMock());
vi.mock('../../storage/sqlite', () => storageMock());

import { migrateAdmin } from '../modules/admin/migrate';
import { migrateBody } from '../modules/body/migrate';
import { migrateChores } from '../modules/chores/migrate';
import { migrateCycle } from '../modules/cycle/migrate';
import { migrateFinance } from '../modules/finance/migrate';
import { migrateGoals } from '../modules/goals/migrate';
import { migrateGrocery } from '../modules/grocery/migrate';
import { migrateHabits } from '../modules/habits/migrate';
import { migrateMedication } from '../modules/medication/migrate';
import { migrateMood } from '../modules/mood/migrate';
import { migratePets } from '../modules/pets/migrate';
import { migrateSleep } from '../modules/sleep/migrate';
import { migrateWork } from '../modules/work/migrate';
import { OTHER_LANGUAGE_REPLY, renderAnswer } from './copy';
import { replyTo } from './reply';
import { answer } from './engine';
import { resolveScrubbedNames } from './names';
import { parseAskQuery, type AskQuery } from './query';

// Wednesday 23 September 2026, 10:00 local. This week = Mon 21 – Sun 27 Sep.
const NOW = new Date(2026, 8, 23, 10, 0).getTime();
const at = (day: number, hour = 12, month = 8) => new Date(2026, month, day, hour, 0).getTime();
let n = 0;
const id = () => `id-${String((n += 1))}`;
const run = (query: string, ...params: unknown[]) => db.prepare(query).run(...(params as never[]));

beforeAll(async () => {
  for (const migrate of [
    migrateAdmin, migrateBody, migrateChores, migrateCycle, migrateFinance, migrateGoals, migrateGrocery,
    migrateHabits, migrateMedication, migrateMood, migratePets, migrateSleep, migrateWork,
  ]) {
    await migrate();
  }

  const spend = (amount: number, merchant: string, when: number, currency = 'EUR', category: string | null = null) =>
    run('INSERT INTO finance_transactions (id, amount, currency, merchant, category, occurred_at) VALUES (?, ?, ?, ?, ?, ?)',
      id(), amount, currency, merchant, category, when);
  spend(64.2, 'Albert Heijn Centrum', at(21));
  spend(40, 'Shell', at(22));
  spend(12.5, 'albert heijn', at(23, 9));
  spend(900, 'Rent', at(1));          // this month, not this week
  spend(30, 'Albert Heijn', at(14));  // last week
  run('INSERT INTO finance_bills (id, merchant, amount, currency, cadence, added_at) VALUES (?, ?, ?, ?, ?, ?)', id(), 'Eneco', 80, 'EUR', 'monthly', at(1));
  run('INSERT INTO finance_subscriptions (id, name, amount, currency, cadence, added_at) VALUES (?, ?, ?, ?, ?, ?)', id(), 'Netflix', 13.99, 'EUR', 'monthly', at(2));

  const bodyEvent = (kind: string, data: object, when: number) =>
    run('INSERT INTO body_events (id, kind, data, logged_at) VALUES (?, ?, ?, ?)', id(), kind, JSON.stringify(data), when);
  bodyEvent('water', { amountMl: 250 }, at(23, 8));
  bodyEvent('water', { amountMl: 500 }, at(23, 9));
  bodyEvent('water', { amountMl: 250 }, at(22, 9));   // yesterday
  bodyEvent('symptom', { label: 'headache', severity: 3 }, at(20, 15));
  bodyEvent('symptom', { label: 'headache' }, at(22, 16));
  bodyEvent('movement', { type: 'walk', duration_min: 30 }, at(21, 18));
  bodyEvent('movement', { type: 'walk' }, at(22, 18));
  bodyEvent('movement', { type: 'walk' }, at(15, 18)); // last week

  const night = (hours: number, quality: number, when: number) =>
    run('INSERT INTO sleep_events (id, kind, data, occurred_at) VALUES (?, ?, ?, ?)', id(), 'sleep', JSON.stringify({ hours, quality }), when);
  night(7, 4, at(21, 7));
  night(5.5, 2, at(22, 7));
  night(8, 5, at(23, 7));

  const moodLog = (valence: string, label: string, when: number) =>
    run('INSERT INTO mood_events (id, kind, data, logged_at) VALUES (?, ?, ?, ?)', id(), 'mood', JSON.stringify({ label, valence }), when);
  moodLog('neg', 'flat', at(21, 9));
  moodLog('neg', 'tired', at(21, 20)); // same day: one low day
  moodLog('pos', 'good', at(22, 10));
  moodLog('neg', 'low', at(23, 8));

  run("INSERT INTO medications_registry (id, name, created_at) VALUES ('med-1', 'Sertraline', ?)", at(1));
  run('INSERT INTO medications_events (id, med_id, kind, data, logged_at) VALUES (?, ?, ?, ?, ?)', id(), 'med-1', 'dose', '{}', at(22, 8));
  run('INSERT INTO medications_events (id, med_id, kind, data, logged_at) VALUES (?, ?, ?, ?, ?)', id(), 'med-1', 'dose', '{}', at(23, 8));
  run('INSERT INTO medications_events (id, med_id, kind, data, logged_at) VALUES (?, ?, ?, ?, ?)', id(), 'med-1', 'missed', '{}', at(21, 8));
  run('INSERT INTO medication_cabinet (id, name, low_flag, created_at) VALUES (?, ?, 1, ?)', id(), 'Inhaler', at(1));
  run('INSERT INTO medication_cabinet (id, name, low_flag, created_at) VALUES (?, ?, 0, ?)', id(), 'Ibuprofen', at(1));

  run('INSERT INTO cycle_events (id, kind, data, occurred_at) VALUES (?, ?, ?, ?)', id(), 'period_start', '{}', at(3));
  run('INSERT INTO cycle_events (id, kind, data, occurred_at) VALUES (?, ?, ?, ?)', id(), 'period_end', '{}', at(8));

  run('INSERT INTO pets_events (id, pet_name, kind, data, logged_at) VALUES (?, ?, ?, ?, ?)', id(), 'Luna', 'vet', '{}', at(10));
  run('INSERT INTO pets_events (id, pet_name, kind, data, logged_at) VALUES (?, ?, ?, ?, ?)', id(), 'Luna', 'feed', '{}', at(23, 7));
  run('INSERT INTO pets_events (id, pet_name, kind, data, logged_at) VALUES (?, ?, ?, ?, ?)', id(), 'Max', 'vet', '{}', at(18));

  run('INSERT INTO admin_tasks (id, kind, text, data, done, due_date, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)', id(), 'task', 'call the dentist', '{}', '2026-09-25', at(20));
  run('INSERT INTO admin_tasks (id, kind, text, data, done, due_date, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)', id(), 'task', 'renew passport', '{}', null, at(20));
  run('INSERT INTO admin_tasks (id, kind, text, data, done, due_date, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)', id(), 'task', 'pay fine', '{}', '2026-09-24', at(20));
  run('INSERT INTO work_tasks (id, text, project, kind, due_date, done, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)', id(), 'send the deck', null, 'task', '2026-09-22', at(20));
  run('INSERT INTO work_events (id, kind, data, logged_at) VALUES (?, ?, ?, ?)', id(), 'meeting', JSON.stringify({ with: 'Ana' }), at(18, 14));

  run('INSERT INTO grocery_shopping (id, name, quantity, unit, added_at) VALUES (?, ?, ?, ?, ?)', id(), 'milk', null, null, at(22));
  run('INSERT INTO grocery_shopping (id, name, quantity, unit, added_at) VALUES (?, ?, ?, ?, ?)', id(), 'bread', null, null, at(23));
  run('INSERT INTO grocery_pantry (id, name, added_at, low_flag) VALUES (?, ?, ?, 1)', id(), 'eggs', at(10));
  run('INSERT INTO grocery_cook_history (id, recipe_name, ingredients, cooked_at_ms) VALUES (?, ?, ?, ?)', id(), 'Pasta pesto', '[]', at(19, 19));

  run('INSERT INTO chores (id, name, kind, done, created_at) VALUES (?, ?, ?, 0, ?)', id(), 'clean the bathroom', 'one_off', at(20));
  run('INSERT INTO chore_completion (id, name, completed_at) VALUES (?, ?, ?)', id(), 'laundry', at(20, 11));

  run("INSERT INTO habits_registry (id, name, created_at) VALUES ('hab-1', 'run', ?)", at(1));
  for (const day of [2, 9, 16, 21]) run('INSERT INTO habits_completions (id, habit_id, completed_at) VALUES (?, ?, ?)', id(), 'hab-1', at(day, 7));
  run('INSERT INTO goals_registry (id, name, created_at) VALUES (?, ?, ?)', id(), 'Save for a trip', at(1));
});

const q = (raw: object): AskQuery => {
  const parsed = parseAskQuery({ lang: 'en', ...raw });
  if (!parsed) throw new Error(`not a query: ${JSON.stringify(raw)}`);
  return parsed;
};
const say = async (raw: object) => renderAnswer(await answer(q(raw), NOW), q(raw).lang, NOW);

describe('money', () => {
  it('adds up this week, per currency, with the number of payments', async () => {
    expect(await answer(q({ shape: 'how_much', area: 'finance', period: 'this_week' }), NOW)).toEqual({
      kind: 'money',
      totals: [{ currency: 'EUR', total: 116.7 }],
      count: 3,
      period: 'this_week',
    });
  });

  it('narrows to a shop however it is written', async () => {
    const r = await answer(q({ shape: 'how_much', area: 'finance', period: 'this_week', filter: { merchant: 'ALBERT heijn' } }), NOW);
    expect(r).toMatchObject({ totals: [{ currency: 'EUR', total: 76.7 }], count: 2 });
  });

  it('takes a month when no period is named', async () => {
    const r = await answer(q({ shape: 'how_much', area: 'finance' }), NOW);
    expect(r).toMatchObject({ totals: [{ total: 1046.7 }], count: 5, period: 'this_month' });
  });

  it('knows when a payment last happened, and how often', async () => {
    expect(await answer(q({ shape: 'when_last', area: 'finance', filter: { item: 'rent' } }), NOW)).toEqual({ kind: 'last', at: at(1) });
    expect(await answer(q({ shape: 'how_many', area: 'finance', period: 'last_week', filter: { merchant: 'albert heijn' } }), NOW)).toEqual({
      kind: 'count',
      n: 1,
      period: 'last_week',
    });
  });

  it('lists bills and subscriptions', async () => {
    expect(await answer(q({ shape: 'list', area: 'finance' }), NOW)).toEqual({
      kind: 'list',
      items: [{ label: 'Eneco', due: null }, { label: 'Netflix', due: null }],
    });
  });
});

describe('body, sleep, mood', () => {
  it('water today', async () => {
    expect(await answer(q({ shape: 'how_much', area: 'body', period: 'today' }), NOW)).toEqual({
      kind: 'quantity', unit: 'ml', total: 750, count: 2, period: 'today',
    });
  });
  it('last headache, walks this week', async () => {
    expect(await answer(q({ shape: 'when_last', area: 'body', filter: { item: 'headache' } }), NOW)).toEqual({ kind: 'last', at: at(22, 16) });
    expect(await answer(q({ shape: 'how_many', area: 'body', period: 'this_week', filter: { item: 'walk' } }), NOW)).toMatchObject({ n: 2 });
  });
  it('sleep this week, the last bad night, bad nights', async () => {
    expect(await answer(q({ shape: 'how_much', area: 'sleep', period: 'this_week' }), NOW)).toEqual({
      kind: 'quantity', unit: 'hours', total: 20.5, count: 3, period: 'this_week',
    });
    expect(await answer(q({ shape: 'when_last', area: 'sleep', filter: { status: 'bad' } }), NOW)).toEqual({ kind: 'last', at: at(22, 7) });
    expect(await answer(q({ shape: 'how_many', area: 'sleep', period: 'this_week', filter: { status: 'bad' } }), NOW)).toMatchObject({ n: 1 });
  });
  it('low days count once per day', async () => {
    expect(await answer(q({ shape: 'how_many', area: 'mood', period: 'this_week', filter: { status: 'bad' } }), NOW)).toMatchObject({ n: 2 });
    expect(await answer(q({ shape: 'when_last', area: 'mood', filter: { status: 'good' } }), NOW)).toEqual({ kind: 'last', at: at(22, 10) });
  });
});

describe('medication, cycle, pets', () => {
  it('last dose (not a missed one), missed doses, what is running low', async () => {
    expect(await answer(q({ shape: 'when_last', area: 'medication' }), NOW)).toEqual({ kind: 'last', at: at(23, 8) });
    expect(await answer(q({ shape: 'when_last', area: 'medication', filter: { item: 'sertraline' } }), NOW)).toEqual({ kind: 'last', at: at(23, 8) });
    expect(await answer(q({ shape: 'how_many', area: 'medication', period: 'this_week', filter: { status: 'missed' } }), NOW)).toMatchObject({ n: 1 });
    // The model sometimes adds item "dose": a general word, not a medication name.
    expect(await answer(q({ shape: 'how_many', area: 'medication', period: 'this_week', filter: { status: 'missed', item: 'dose' } }), NOW)).toMatchObject({ n: 1 });
    expect(await answer(q({ shape: 'list', area: 'medication' }), NOW)).toEqual({ kind: 'list', items: [{ label: 'Inhaler', due: null }] });
  });
  it('last period start', async () => {
    expect(await answer(q({ shape: 'when_last', area: 'cycle' }), NOW)).toEqual({ kind: 'last', at: at(3) });
  });
  it("one pet's vet visit, not another's", async () => {
    expect(await answer(q({ shape: 'when_last', area: 'pets', filter: { pet: 'luna', item: 'vet' } }), NOW)).toEqual({ kind: 'last', at: at(10) });
  });
});

describe('tasks and home', () => {
  it("what's due this week: open errands with a date in it, done ones left out", async () => {
    expect(await answer(q({ shape: 'list', area: 'admin', period: 'this_week' }), NOW)).toEqual({
      kind: 'list', items: [{ label: 'call the dentist', due: '2026-09-25' }],
    });
  });
  it("today includes what is overdue", async () => {
    expect(await answer(q({ shape: 'list', area: 'work', period: 'today' }), NOW)).toEqual({
      kind: 'list', items: [{ label: 'send the deck', due: '2026-09-22' }],
    });
  });
  it('every open errand, dated first, when no period is named', async () => {
    const r = await answer(q({ shape: 'list', area: 'admin' }), NOW);
    expect(r).toEqual({ kind: 'list', items: [{ label: 'call the dentist', due: '2026-09-25' }, { label: 'renew passport', due: null }] });
  });
  it('last meeting with someone', async () => {
    expect(await answer(q({ shape: 'when_last', area: 'work', filter: { person: 'ana' } }), NOW)).toEqual({ kind: 'last', at: at(18, 14) });
  });
  it('shopping list, running low, last cooked, open chores, habits, goals', async () => {
    expect(await answer(q({ shape: 'list', area: 'grocery' }), NOW)).toMatchObject({ items: [{ label: 'milk' }, { label: 'bread' }] });
    expect(await answer(q({ shape: 'list', area: 'grocery', filter: { status: 'low' } }), NOW)).toMatchObject({ items: [{ label: 'eggs' }] });
    expect(await answer(q({ shape: 'when_last', area: 'grocery', filter: { item: 'pasta' } }), NOW)).toEqual({ kind: 'last', at: at(19, 19) });
    expect(await answer(q({ shape: 'list', area: 'chores' }), NOW)).toMatchObject({ items: [{ label: 'clean the bathroom' }] });
    expect(await answer(q({ shape: 'when_last', area: 'chores', filter: { item: 'laundry' } }), NOW)).toEqual({ kind: 'last', at: at(20, 11) });
    expect(await answer(q({ shape: 'how_many', area: 'habits', period: 'this_month', filter: { item: 'run' } }), NOW)).toMatchObject({ n: 4 });
    expect(await answer(q({ shape: 'list', area: 'goals' }), NOW)).toMatchObject({ items: [{ label: 'Save for a trip' }] });
  });
});

describe('names the AI never saw', () => {
  it('puts back a scrubbed pet name from what was typed, then answers for that pet only', async () => {
    const scrubbed = q({ shape: 'when_last', area: 'pets', filter: { pet: '[NAME]', item: 'vet' } });
    const resolved = await resolveScrubbedNames(scrubbed, 'when was Luna last at the vet?');
    expect(resolved?.filter).toEqual({ pet: 'Luna', item: 'vet' });
    expect(await answer(resolved as AskQuery, NOW)).toEqual({ kind: 'last', at: at(10) });
  });
  it('puts back a person and a medication', async () => {
    expect((await resolveScrubbedNames(q({ shape: 'when_last', area: 'work', filter: { person: '[NAME]' } }), 'when did I last meet ana?'))?.filter).toEqual({ person: 'Ana' });
    expect((await resolveScrubbedNames(q({ shape: 'when_last', area: 'medication', filter: { item: '[MEDICATION]' } }), 'last sertraline?'))?.filter).toEqual({ item: 'Sertraline' });
  });
  it('gives up rather than guess when the name is not in the records', async () => {
    expect(await resolveScrubbedNames(q({ shape: 'when_last', area: 'pets', filter: { pet: '[NAME]' } }), 'when did Bella see the vet?')).toBeNull();
  });
  it('leaves an unscrubbed query as it is', async () => {
    const plain = q({ shape: 'how_much', area: 'finance', filter: { merchant: 'Shell' } });
    expect(await resolveScrubbedNames(plain, 'how much at shell?')).toEqual(plain);
  });
});

describe('the honest fallback', () => {
  it('answers nothing it was not built for, and guesses nothing', async () => {
    expect(await answer(q({ shape: 'how_much', area: 'mood' }), NOW)).toEqual({ kind: 'fallback' });
    expect(await answer(q({ shape: 'when_last', area: 'body' }), NOW)).toEqual({ kind: 'fallback' });
  });
  it('says so when there is no record rather than making one up', async () => {
    expect(await answer(q({ shape: 'when_last', area: 'body', filter: { item: 'migraine' } }), NOW)).toEqual({ kind: 'last', at: null });
  });
});

describe('what Ollie says, in English and Dutch', () => {
  it('prints the answers', async () => {
    const asks: object[] = [
      { shape: 'how_much', area: 'finance', period: 'this_week' },
      { shape: 'how_much', area: 'finance', period: 'this_week', filter: { merchant: 'albert heijn' } },
      { shape: 'how_much', area: 'body', period: 'today' },
      { shape: 'how_much', area: 'sleep', period: 'this_week' },
      { shape: 'when_last', area: 'medication' },
      { shape: 'when_last', area: 'pets', filter: { pet: 'luna', item: 'vet' } },
      { shape: 'how_many', area: 'mood', period: 'this_week', filter: { status: 'bad' } },
      { shape: 'list', area: 'grocery' },
      { shape: 'list', area: 'admin', period: 'this_week' },
      { shape: 'when_last', area: 'body', filter: { item: 'migraine' } },
      { shape: 'how_much', area: 'mood' },
    ];
    const lines: string[] = [];
    for (const ask of asks) {
      lines.push(`EN  ${await say({ ...ask, lang: 'en' })}`);
      lines.push(`NL  ${await say({ ...ask, lang: 'nl' })}`);
    }
    process.stdout.write(`\n${lines.join('\n')}\n`);
    expect(lines.join('\n')).toContain('uitgegeven');
  });
});

describe('replyTo: what the home chat shows', () => {
  const question = (query: Record<string, unknown> | null, lang: 'en' | 'nl' | 'other' = 'en') => ({
    text: 'q',
    lang,
    query: query as never,
  });

  it('money: sentence plus the big number, computed from the phone', async () => {
    const reply = await replyTo(
      question({ shape: 'how_much', area: 'finance', filter: {}, period: 'this_week' }),
      'how much did I spend this week?',
      NOW,
    );
    expect(reply.text).toContain('This week you spent');
    expect(reply.headline).toMatch(/€/);
    expect(reply.examples).toEqual([]);
    expect(reply.computed).toBe(true);
  });

  it('a scrubbed pet name comes back from the typed text', async () => {
    const reply = await replyTo(
      question({ shape: 'when_last', area: 'pets', filter: { pet: '[NAME]', item: 'vet' }, period: null }, 'nl'),
      'wanneer was Luna voor het laatst bij de dierenarts?',
      NOW,
    );
    expect(reply.text).toMatch(/^De laatste keer was/);
    expect(reply.headline).toBeNull();
  });

  it('a name it cannot find, an off-contract query, or no query: the fallback with examples, never a guess', async () => {
    for (const q of [
      question({ shape: 'when_last', area: 'pets', filter: { pet: '[NAME]' }, period: null }),
      question({ shape: 'why', area: 'feelings', filter: {}, period: null }),
      question(null),
    ]) {
      const reply = await replyTo(q, 'when was Bella last at the vet?', NOW);
      expect(reply.text).toMatch(/^I can't answer that one yet/);
      expect(reply.examples).toHaveLength(2);
      expect(reply.computed).toBe(false);
    }
  });

  it('another language gets the polite English-or-Dutch reply', async () => {
    const reply = await replyTo(question({ shape: 'how_much', area: 'finance', filter: {}, period: null }, 'other'), 'bu hafta ne harcadım?', NOW);
    expect(reply.text).toBe(OTHER_LANGUAGE_REPLY);
  });
});
