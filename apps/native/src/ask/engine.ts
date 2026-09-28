/**
 * ask/engine — answers an AskQuery from the phone's own data. Plain code, no AI:
 * the numbers, dates and lists here are exact, and nothing leaves the phone.
 *
 * One entry per (area, shape) that v1 answers. Anything else is the fallback,
 * never a guess. Free-text filters match stored names loosely (case-insensitive,
 * substring), because people say "albert heijn" for "Albert Heijn Centrum".
 */
import { sql } from '../storage';
import { dayKey, resolvePeriod, type Range } from './period';
import type { AskFilter, AskQuery, Area, NamedPeriod, Shape } from './query';

export interface MoneyTotal {
  readonly currency: string | null;
  readonly total: number;
}

export interface ListItem {
  readonly label: string;
  readonly due?: string | null;
}

export type AskResult =
  | { readonly kind: 'money'; readonly totals: readonly MoneyTotal[]; readonly count: number; readonly period: NamedPeriod }
  | { readonly kind: 'quantity'; readonly unit: 'ml' | 'hours'; readonly total: number; readonly count: number; readonly period: NamedPeriod }
  | { readonly kind: 'last'; readonly at: number | null }
  | { readonly kind: 'count'; readonly n: number; readonly period: NamedPeriod }
  | { readonly kind: 'list'; readonly items: readonly ListItem[] }
  | { readonly kind: 'fallback' };

const FALLBACK: AskResult = { kind: 'fallback' };

/** Totals and counts need a span of time; a question without one means this month. */
const DEFAULT_PERIOD: NamedPeriod = 'this_month';

const like = (text: string) => `%${text.toLowerCase()}%`;

interface Ctx {
  readonly q: AskQuery;
  readonly period: NamedPeriod;
  readonly range: Range;
  readonly now: number;
}

type Handler = (ctx: Ctx) => Promise<AskResult>;

const one = async <T extends Record<string, unknown>>(query: string, params: unknown[]) =>
  (await sql.select<T>(query, params))[0];

const lastAt = async (query: string, params: unknown[]): Promise<AskResult> => {
  const row = await one<{ at: number | null }>(query, params);
  return { kind: 'last', at: row?.at ?? null };
};

const countIn = async (ctx: Ctx, query: string, params: unknown[]): Promise<AskResult> => {
  const row = await one<{ n: number }>(query, params);
  return { kind: 'count', n: Number(row?.n ?? 0), period: ctx.period };
};

const listOf = async (query: string, params: unknown[] = []): Promise<AskResult> => {
  const rows = await sql.select<{ label: string; due?: string | null }>(query, params);
  return { kind: 'list', items: rows.map((r) => ({ label: r.label, due: r.due ?? null })) };
};

/** The text a question names, whichever filter field the AI put it in. */
const named = (f: AskFilter): string | undefined => f.item ?? f.merchant ?? f.category ?? f.person ?? f.pet;

// ─── money ────────────────────────────────────────────────────────────────

function moneyWhere(ctx: Ctx, withPeriod: boolean): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (withPeriod) {
    clauses.push('occurred_at >= ? AND occurred_at < ?');
    params.push(ctx.range.from, ctx.range.to);
  }
  const f = ctx.q.filter;
  if (f.merchant ?? f.item) {
    clauses.push("LOWER(COALESCE(merchant, '')) LIKE ?");
    params.push(like((f.merchant ?? f.item) as string));
  }
  if (f.category) {
    clauses.push("LOWER(COALESCE(category, '')) LIKE ?");
    params.push(like(f.category));
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

const finance: Partial<Record<Shape, Handler>> = {
  async how_much(ctx) {
    const { where, params } = moneyWhere(ctx, true);
    const rows = await sql.select<{ currency: string | null; total: number; n: number }>(
      `SELECT currency, SUM(amount) AS total, COUNT(*) AS n FROM finance_transactions ${where}
       GROUP BY currency ORDER BY total DESC`,
      params,
    );
    return {
      kind: 'money',
      totals: rows.map((r) => ({ currency: r.currency, total: Number(r.total) })),
      count: rows.reduce((sum, r) => sum + Number(r.n), 0),
      period: ctx.period,
    };
  },
  async when_last(ctx) {
    if (!named(ctx.q.filter)) return FALLBACK;
    const { where, params } = moneyWhere(ctx, false);
    return lastAt(`SELECT MAX(occurred_at) AS at FROM finance_transactions ${where}`, params);
  },
  async how_many(ctx) {
    const { where, params } = moneyWhere(ctx, true);
    return countIn(ctx, `SELECT COUNT(*) AS n FROM finance_transactions ${where}`, params);
  },
  list: () =>
    listOf(
      `SELECT merchant AS label FROM finance_bills
       UNION ALL SELECT name AS label FROM finance_subscriptions
       ORDER BY label`,
    ),
};

// ─── body ─────────────────────────────────────────────────────────────────

// Symptoms and supplements keep their name as `label`, movement as `type`.
const BODY_LABEL = "LOWER(COALESCE(json_extract(data, '$.label'), json_extract(data, '$.type'), kind))";

const body: Partial<Record<Shape, Handler>> = {
  async how_much(ctx) {
    const row = await one<{ total: number | null; n: number }>(
      `SELECT SUM(json_extract(data, '$.amountMl')) AS total, COUNT(*) AS n FROM body_events
       WHERE kind = 'water' AND logged_at >= ? AND logged_at < ?`,
      [ctx.range.from, ctx.range.to],
    );
    return { kind: 'quantity', unit: 'ml', total: Number(row?.total ?? 0), count: Number(row?.n ?? 0), period: ctx.period };
  },
  async when_last(ctx) {
    const item = named(ctx.q.filter);
    if (!item) return FALLBACK;
    return lastAt(`SELECT MAX(logged_at) AS at FROM body_events WHERE ${BODY_LABEL} LIKE ?`, [like(item)]);
  },
  async how_many(ctx) {
    const item = named(ctx.q.filter);
    if (!item) return FALLBACK;
    return countIn(
      ctx,
      `SELECT COUNT(*) AS n FROM body_events WHERE ${BODY_LABEL} LIKE ? AND logged_at >= ? AND logged_at < ?`,
      [like(item), ctx.range.from, ctx.range.to],
    );
  },
};

// ─── sleep ────────────────────────────────────────────────────────────────

const SLEEP_QUALITY = "CAST(json_extract(data, '$.quality') AS INTEGER)";
const sleepCondition = (f: AskFilter): string =>
  f.status === 'bad' ? `AND ${SLEEP_QUALITY} <= 2` : f.status === 'good' ? `AND ${SLEEP_QUALITY} >= 4` : '';

const sleep: Partial<Record<Shape, Handler>> = {
  async how_much(ctx) {
    const row = await one<{ total: number | null; n: number }>(
      `SELECT SUM(json_extract(data, '$.hours')) AS total, COUNT(json_extract(data, '$.hours')) AS n
       FROM sleep_events WHERE kind = 'sleep' AND occurred_at >= ? AND occurred_at < ?`,
      [ctx.range.from, ctx.range.to],
    );
    return { kind: 'quantity', unit: 'hours', total: Number(row?.total ?? 0), count: Number(row?.n ?? 0), period: ctx.period };
  },
  when_last: (ctx) =>
    lastAt(`SELECT MAX(occurred_at) AS at FROM sleep_events WHERE kind = 'sleep' ${sleepCondition(ctx.q.filter)}`, []),
  how_many: (ctx) =>
    countIn(
      ctx,
      `SELECT COUNT(*) AS n FROM sleep_events WHERE kind = 'sleep' ${sleepCondition(ctx.q.filter)}
       AND occurred_at >= ? AND occurred_at < ?`,
      [ctx.range.from, ctx.range.to],
    ),
};

// ─── mood ─────────────────────────────────────────────────────────────────

const moodCondition = (f: AskFilter): { clause: string; params: unknown[] } => {
  if (f.status === 'good') return { clause: "AND json_extract(data, '$.valence') = 'pos'", params: [] };
  if (f.status === 'bad') return { clause: "AND json_extract(data, '$.valence') = 'neg'", params: [] };
  if (f.item) return { clause: "AND LOWER(COALESCE(json_extract(data, '$.label'), '')) LIKE ?", params: [like(f.item)] };
  return { clause: '', params: [] };
};

const mood: Partial<Record<Shape, Handler>> = {
  when_last(ctx) {
    const { clause, params } = moodCondition(ctx.q.filter);
    return lastAt(`SELECT MAX(logged_at) AS at FROM mood_events WHERE kind = 'mood' ${clause}`, params);
  },
  how_many(ctx) {
    // Days, not entries: "how many low days" counts a bad day once however often it was logged.
    const { clause, params } = moodCondition(ctx.q.filter);
    return countIn(
      ctx,
      `SELECT COUNT(DISTINCT date(logged_at / 1000, 'unixepoch', 'localtime')) AS n FROM mood_events
       WHERE kind = 'mood' ${clause} AND logged_at >= ? AND logged_at < ?`,
      [...params, ctx.range.from, ctx.range.to],
    );
  },
};

// ─── medication ───────────────────────────────────────────────────────────

function medWhere(f: AskFilter): { clause: string; params: unknown[] } {
  const kind = f.status === 'missed' ? 'missed' : 'dose';
  const item = f.item;
  if (!item) return { clause: 'e.kind = ?', params: [kind] };
  return { clause: 'e.kind = ? AND LOWER(r.name) LIKE ?', params: [kind, like(item)] };
}

const MED_FROM = 'FROM medications_events e LEFT JOIN medications_registry r ON r.id = e.med_id';

const medication: Partial<Record<Shape, Handler>> = {
  when_last(ctx) {
    const { clause, params } = medWhere(ctx.q.filter);
    return lastAt(`SELECT MAX(e.logged_at) AS at ${MED_FROM} WHERE ${clause}`, params);
  },
  how_many(ctx) {
    const { clause, params } = medWhere(ctx.q.filter);
    return countIn(ctx, `SELECT COUNT(*) AS n ${MED_FROM} WHERE ${clause} AND e.logged_at >= ? AND e.logged_at < ?`, [
      ...params,
      ctx.range.from,
      ctx.range.to,
    ]);
  },
  list: () => listOf('SELECT name AS label FROM medication_cabinet WHERE low_flag = 1 ORDER BY name'),
};

// ─── cycle, pets ──────────────────────────────────────────────────────────

const cycle: Partial<Record<Shape, Handler>> = {
  when_last: () => lastAt("SELECT MAX(occurred_at) AS at FROM cycle_events WHERE kind = 'period_start'", []),
};

/** "vet", "fed", "food" and the like, onto the kinds pets_events stores. */
function petKind(item: string | undefined): string | null {
  const t = (item ?? '').toLowerCase();
  if (/vet|dierenarts/.test(t)) return 'vet';
  if (/fe[de]|food|eten|gevoerd|voer/.test(t)) return 'feed';
  if (/supplement/.test(t)) return 'supplement';
  if (t) return 'care';
  return null;
}

function petWhere(f: AskFilter): { clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const kind = petKind(f.item);
  if (kind) {
    clauses.push('kind = ?');
    params.push(kind);
  }
  if (f.pet) {
    clauses.push('LOWER(pet_name) LIKE ?');
    params.push(like(f.pet));
  }
  return { clause: clauses.join(' AND '), params };
}

const pets: Partial<Record<Shape, Handler>> = {
  when_last(ctx) {
    const { clause, params } = petWhere(ctx.q.filter);
    if (!clause) return Promise.resolve(FALLBACK);
    return lastAt(`SELECT MAX(logged_at) AS at FROM pets_events WHERE ${clause}`, params);
  },
  how_many(ctx) {
    const { clause, params } = petWhere(ctx.q.filter);
    if (!clause) return Promise.resolve(FALLBACK);
    return countIn(ctx, `SELECT COUNT(*) AS n FROM pets_events WHERE ${clause} AND logged_at >= ? AND logged_at < ?`, [
      ...params,
      ctx.range.from,
      ctx.range.to,
    ]);
  },
};

// ─── tasks: errands (admin) and work ──────────────────────────────────────

/** Open tasks, soonest due first; with a period, only those due in it (and overdue ones for today). */
function openTasks(table: 'admin_tasks' | 'work_tasks'): Handler {
  return (ctx) => {
    if (!ctx.q.period) {
      return listOf(
        `SELECT text AS label, due_date AS due FROM ${table} WHERE done = 0
         ORDER BY due_date IS NULL, due_date, created_at`,
      );
    }
    const from = ctx.q.period === 'today' ? '0000-00-00' : dayKey(ctx.range.from);
    return listOf(
      `SELECT text AS label, due_date AS due FROM ${table}
       WHERE done = 0 AND due_date >= ? AND due_date <= ? ORDER BY due_date, created_at`,
      [from, dayKey(ctx.range.to - 1)],
    );
  };
}

const admin: Partial<Record<Shape, Handler>> = { list: openTasks('admin_tasks') };

const work: Partial<Record<Shape, Handler>> = {
  list: openTasks('work_tasks'),
  when_last(ctx) {
    const who = ctx.q.filter.person ?? ctx.q.filter.item;
    if (!who) return Promise.resolve(FALLBACK);
    return lastAt(
      `SELECT MAX(logged_at) AS at FROM work_events
       WHERE kind = 'meeting' AND LOWER(COALESCE(json_extract(data, '$.with'), '')) LIKE ?`,
      [like(who)],
    );
  },
};

// ─── home: groceries, chores; habits, goals ───────────────────────────────

const grocery: Partial<Record<Shape, Handler>> = {
  list: (ctx) =>
    ctx.q.filter.status === 'low'
      ? listOf('SELECT name AS label FROM grocery_pantry WHERE low_flag = 1 AND archived_at_ms IS NULL ORDER BY name')
      : listOf('SELECT name AS label FROM grocery_shopping ORDER BY added_at'),
  when_last(ctx) {
    const item = named(ctx.q.filter);
    if (!item) return Promise.resolve(FALLBACK);
    return lastAt('SELECT MAX(cooked_at_ms) AS at FROM grocery_cook_history WHERE LOWER(recipe_name) LIKE ?', [like(item)]);
  },
};

const chores: Partial<Record<Shape, Handler>> = {
  when_last(ctx) {
    const item = named(ctx.q.filter);
    if (!item) return Promise.resolve(FALLBACK);
    return lastAt('SELECT MAX(completed_at) AS at FROM chore_completion WHERE LOWER(name) LIKE ?', [like(item)]);
  },
  list: () => listOf('SELECT name AS label FROM chores WHERE done = 0 ORDER BY created_at'),
};

const HABIT_FROM = 'FROM habits_completions c JOIN habits_registry r ON r.id = c.habit_id';

const habits: Partial<Record<Shape, Handler>> = {
  when_last(ctx) {
    const item = named(ctx.q.filter);
    if (!item) return Promise.resolve(FALLBACK);
    return lastAt(`SELECT MAX(c.completed_at) AS at ${HABIT_FROM} WHERE LOWER(r.name) LIKE ?`, [like(item)]);
  },
  how_many(ctx) {
    const item = named(ctx.q.filter);
    if (!item) return Promise.resolve(FALLBACK);
    return countIn(ctx, `SELECT COUNT(*) AS n ${HABIT_FROM} WHERE LOWER(r.name) LIKE ? AND c.completed_at >= ? AND c.completed_at < ?`, [
      like(item),
      ctx.range.from,
      ctx.range.to,
    ]);
  },
};

const goals: Partial<Record<Shape, Handler>> = {
  list: () => listOf('SELECT name AS label FROM goals_registry ORDER BY created_at'),
};

const HANDLERS: Record<Area, Partial<Record<Shape, Handler>>> = {
  finance,
  admin,
  work,
  grocery,
  body,
  medication,
  sleep,
  mood,
  cycle,
  chores,
  pets,
  habits,
  goals,
};

/** Whether v1 has an answer for this area and shape at all. */
export const answers = (area: Area, shape: Shape): boolean => HANDLERS[area][shape] !== undefined;

export async function answer(q: AskQuery, now: number = Date.now()): Promise<AskResult> {
  const handler = HANDLERS[q.area][q.shape];
  if (!handler) return FALLBACK;
  const period = q.period ?? DEFAULT_PERIOD;
  return handler({ q, period, range: resolvePeriod(period, now), now });
}
