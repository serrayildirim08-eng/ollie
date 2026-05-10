/**
 * @ollie/logic · F1-F7 pattern detectors
 *
 * Mirrors tools/finance_patterns.js behavior. Pure entry point:
 * detectPatterns(state). Swallows per-detector errors so one bad
 * record never breaks the pipeline.
 *
 * Sources:
 * F1 Atalay & Meloy 2011 (retail therapy)
 * F2 Reid & Reid 2007 (telephobia)
 * F3 Altgassen 2014 (time-based prospective memory)
 * F4 Hupfeld 2019 (ADHD hyperfocus)
 * F5 BLS gig economy volatility
 * F6 Barkley 2012 (ADHD working memory)
 * F7 Steel 2007 (procrastination meta-review)
 */

import type {
  FinanceRecord,
  DumpEntry,
  ResearchLoop,
  PatternCard,
  FinanceSource,
  DetectPatternsState,
} from './types';
import { DAY_MS } from './math';

const HOUR_MS = 3_600_000;

const LOW_MOOD_RE =
  /\b(sad|exhausted|tired|drained|empty|numb|burned\s*out|burnt\s*out|overwhelmed|anxious|stressed|low|down|depressed|hopeless)\b/i;

const RESEARCH_LOOP_RE =
  /\b(?:trying to decide|still researching|looking into|deciding (?:on|between|whether)|can't decide|cannot decide|debating (?:whether|between|on)|been (?:researching|reading|comparing)|comparing options|which (?:one )?should i)\b/i;

export { RESEARCH_LOOP_RE };

const F_SOURCES: Record<string, FinanceSource> = {
  F1: { citation: 'Atalay & Meloy 2011, retail therapy',           url: 'https://doi.org/10.1002/mar.20404' },
  F2: { citation: 'Reid & Reid 2007, telephobia',                  url: 'https://doi.org/10.1089/cpb.2007.9936' },
  F3: { citation: 'Altgassen 2014, time-based prospective memory', url: 'https://doi.org/10.1016/j.jecp.2014.05.005' },
  F4: { citation: 'Hupfeld 2019, ADHD hyperfocus',                 url: 'https://doi.org/10.1007/s12402-018-0272-y' },
  F5: { citation: 'BLS gig economy volatility',                    url: 'https://www.bls.gov/opub/mlr/2018/article/electronically-mediated-work.htm' },
  F6: { citation: 'Barkley 2012, ADHD working memory',             url: 'https://www.guilford.com/books/Executive-Functions/Russell-Barkley/9781462514212' },
  F7: { citation: 'Steel 2007, procrastination meta-review',       url: 'https://doi.org/10.1037/0033-2909.133.1.65' },
};

function tokenize(text: string): string[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  const STOP = new Set([
    'the','a','an','of','and','or','to','for','in','on','at','with','my','your','this','that',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union > 0 ? inter / union : 0;
}

const RL_STOP = new Set([
  'about','today','tomorrow','still','thing','really','though','again',
  'between','whether','should','would','could','myself','option','options',
  'looking','researching','deciding','comparing','reading','debating',
]);

function extractResearchTopic(text: string): string | null {
  if (typeof text !== 'string') return null;
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const toks = cleaned.split(/\s+/).filter((t) => t && t.length >= 4 && !RL_STOP.has(t));
  if (!toks.length) return null;
  return toks[toks.length - 1];
}

export function detectPatterns(state: DetectPatternsState): PatternCard[] {
  const s = state ?? ({} as DetectPatternsState);
  const now = typeof s.now === 'number' ? s.now : 0;
  const records: FinanceRecord[] = Array.isArray(s.records) ? s.records : [];
  const dumps: DumpEntry[] = Array.isArray(s.dumps) ? s.dumps : [];
  const researchLoopsIn: ResearchLoop[] = Array.isArray(s.research_loops)
    ? s.research_loops
    : [];
  const out: PatternCard[] = [];

  // F1 — Doom-buying
  try {
    const lowMoodDumps = dumps.filter(
      (d) => d && typeof d.ts === 'number' && typeof d.text === 'string' && LOW_MOOD_RE.test(d.text),
    );
    const txns = records.filter(
      (r) => r?.direction === 'out' && r.kind !== 'bill' && r.kind !== 'sub' && typeof r.event_date === 'string',
    );
    if (lowMoodDumps.length > 0 && txns.length > 0) {
      const latestDump = [...lowMoodDumps].sort((a, b) => b.ts - a.ts)[0];
      for (const r of txns) {
        const rTs = Date.parse(r.event_date + 'T12:00:00Z');
        if (!Number.isFinite(rTs)) continue;
        if (Math.abs(latestDump.ts - rTs) > DAY_MS) continue;
        if (now - rTs < 72 * HOUR_MS) continue;
        const desc = (r.merchant ?? r.notes ?? 'thing').toString().trim().toLowerCase();
        out.push({
          pattern: 'doom-buying',
          record_id: r.id,
          copy: 'the ' + desc + " you bought — was it the dopamine, the thing, or the relief? no wrong answer.",
          copy_es: 'el ' + desc + ' que compraste — ¿fue la dopamina, la cosa o el alivio? no hay respuesta mal.',
          source: F_SOURCES.F1,
        });
        break;
      }
    }
  } catch { /* swallow */ }

  // F4 — Hyperfocus burst
  try {
    const cats = new Map<string, Array<{ id: string | undefined; at: number }>>();
    for (const r of records) {
      if (!r || r.direction !== 'out' || !r.category || typeof r.event_date !== 'string') continue;
      const at = Date.parse(r.event_date + 'T12:00:00Z');
      if (!Number.isFinite(at)) continue;
      const cat = String(r.category).trim().toLowerCase();
      if (!cat) continue;
      if (!cats.has(cat)) cats.set(cat, []);
      cats.get(cat)!.push({ id: r.id, at });
    }
    const WIN = 48 * HOUR_MS;
    const SETTLE = 6 * HOUR_MS;
    for (const [cat, arr] of cats) {
      if (arr.length < 3) continue;
      arr.sort((a, b) => a.at - b.at);
      for (let i = 0; i + 2 < arr.length; i++) {
        let j = i + 1;
        while (j < arr.length && arr[j].at - arr[i].at <= WIN) j++;
        if (j - i >= 3 && now - arr[j - 1].at >= SETTLE) {
          out.push({
            pattern: 'hyperfocus-burst',
            category: cat,
            ids: arr.slice(i, j).map((p) => p.id).filter((id): id is string => Boolean(id)),
            burst_count: j - i,
            copy: 'the ' + cat + " dive — sustainable interest or hyperfocus visit? both are fine, just naming the wave.",
            copy_es: 'el clavado en ' + cat + ' — ¿interés sostenido o visita de hiperfoco? ambas valen, solo nombramos la ola.',
            source: F_SOURCES.F4,
          });
          break;
        }
      }
    }
  } catch { /* */ }

  // F5 — Gig volatility
  try {
    const incomes = records.filter(
      (r) => r?.direction === 'in' && typeof r.amount === 'number' && typeof r.event_date === 'string',
    );
    if (incomes.length >= 2) {
      const byMonth = new Map<string, number>();
      for (const r of incomes) {
        const mk = r.event_date.slice(0, 7);
        byMonth.set(mk, (byMonth.get(mk) ?? 0) + (r.amount ?? 0));
      }
      const totals = Array.from(byMonth.values());
      if (totals.length >= 2) {
        const floor = Math.min(...totals);
        const ceiling = Math.max(...totals);
        const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
        if (avg > 0) {
          const vp = ((ceiling - floor) / avg) * 100;
          if (vp > 40) {
            out.push({
              pattern: 'gig-volatility',
              floor: Math.round(floor),
              ceiling: Math.round(ceiling),
              variance_pct: Math.round(vp),
              months_observed: totals.length,
              copy:
                'your floor month was ' + Math.round(floor) + ', ceiling ' + Math.round(ceiling) +
                '. plan against the floor, not the average. variance is structural in gig work, not a personal failing.',
              copy_es:
                'tu mes piso fue ' + Math.round(floor) + ', el techo ' + Math.round(ceiling) +
                '. planifica contra el piso, no contra la media. la varianza es estructural en el trabajo gig, no carencia personal.',
              source: F_SOURCES.F5,
            });
          }
        }
      }
    }
  } catch { /* */ }

  // F6 — Duplicate purchase
  try {
    const txns = records.filter(
      (r) =>
        r?.direction === 'out' &&
        r.kind === 'txn' &&
        typeof r.event_date === 'string' &&
        (r.merchant || r.notes),
    );
    if (txns.length >= 2) {
      const sorted = [...txns].sort((a, b) =>
        (b.event_date ?? '').localeCompare(a.event_date ?? ''),
      );
      const latest = sorted[0];
      const latestAt = Date.parse(latest.event_date + 'T12:00:00Z');
      const latestText = (latest.merchant ?? latest.notes ?? '').toString();
      const aTok = tokenize(latestText);
      if (aTok.length > 0 && Number.isFinite(latestAt)) {
        let best: { p: FinanceRecord; sim: number } | null = null;
        for (let i = 1; i < sorted.length; i++) {
          const p = sorted[i];
          const at = Date.parse(p.event_date + 'T12:00:00Z');
          if (!Number.isFinite(at) || latestAt - at > 90 * DAY_MS) continue;
          const sim = jaccard(aTok, tokenize((p.merchant ?? p.notes ?? '').toString()));
          if (sim > 0.7 && (!best || sim > best.sim)) best = { p, sim };
        }
        if (best) {
          const priorDate = best.p.event_date;
          out.push({
            pattern: 'duplicate-purchase',
            record_id: latest.id,
            prior_id: best.p.id,
            similarity: Math.round(best.sim * 100) / 100,
            copy:
              'you bought a similar thing on ' + priorDate +
              ". still need it? duplicate is not stupidity — working memory has limits.",
            copy_es:
              'compraste algo parecido el ' + priorDate +
              '. ¿lo sigues necesitando? duplicar no es torpeza — la memoria de trabajo tiene límites.',
            source: F_SOURCES.F6,
          });
        }
      }
    }
  } catch { /* */ }

  // F2 — Subscription cancel avoidance
  try {
    const GRACE_MS = 3 * DAY_MS;
    const subs = records.filter(
      (r) => r?.kind === 'sub' && r.sub_meta && typeof r.sub_meta.marked_to_cancel_at === 'number',
    );
    for (const s of subs) {
      const markedAt = s.sub_meta!.marked_to_cancel_at!;
      if (now - markedAt < GRACE_MS) continue;
      const days = Math.floor((now - markedAt) / DAY_MS);
      const name = (s.merchant ?? 'this subscription').toString().toLowerCase();
      out.push({
        pattern: 'subscription-cancel-avoidance',
        record_id: s.id,
        days_marked: days,
        copy: name + ' was marked to cancel ' + days + ' days ago. cancel is hard. the friction is structural, not lazy.',
        copy_es: name + ' fue marcado para cancelar hace ' + days + ' días. cancelar cuesta. la fricción es estructural, no pereza.',
        source: F_SOURCES.F2,
      });
    }
  } catch { /* */ }

  // F3 — Return abandonment
  try {
    const NEAR_MS = 7 * DAY_MS;
    const txnsWithReturn = records.filter(
      (r) =>
        r?.kind === 'txn' &&
        typeof r.returnable_until === 'number' &&
        r.return_status !== 'returned' &&
        r.return_status !== 'kept',
    );
    for (const r of txnsWithReturn) {
      const deadline = r.returnable_until!;
      const msLeft = deadline - now;
      if (msLeft > NEAR_MS) continue;
      const desc = (r.merchant ?? r.notes ?? 'item').toString().toLowerCase();
      const daysLeft = Math.ceil(msLeft / DAY_MS);
      let cueCopy: string;
      let cueEs: string;
      if (msLeft < 0) {
        cueCopy = 'return window for ' + desc + ' has passed. the return system is hostile to adhd — name it, then move on.';
        cueEs = 'la ventana de devolución de ' + desc + ' ya pasó. el sistema de devoluciones está hecho contra el tdah — nómbralo y sigue.';
      } else if (daysLeft <= 1) {
        cueCopy = "last day to return " + desc + ". you didn't fail. the return system is hostile to adhd.";
        cueEs = 'último día para devolver ' + desc + '. no es que no llegues. el sistema de devoluciones está hecho contra el tdah.';
      } else if (daysLeft <= 2) {
        cueCopy = daysLeft + ' days to return ' + desc + '. label first, ship after.';
        cueEs = daysLeft + ' días para devolver ' + desc + '. primero la etiqueta, después el envío.';
      } else {
        cueCopy = daysLeft + ' days left to return ' + desc + '. step one: find the box.';
        cueEs = daysLeft + ' días para devolver ' + desc + '. paso uno: encuentra la caja.';
      }
      out.push({
        pattern: 'return-abandonment',
        record_id: r.id,
        days_left: daysLeft,
        copy: cueCopy,
        copy_es: cueEs,
        source: F_SOURCES.F3,
      });
    }
  } catch { /* */ }

  // F7 — Research paralysis
  try {
    const F7_MIN_MENTIONS = 5;
    const F7_MIN_SPAN_MS = 14 * DAY_MS;
    for (const loop of researchLoopsIn) {
      if (!loop || !Array.isArray(loop.mentions) || loop.mentions.length < F7_MIN_MENTIONS) continue;
      if (typeof loop.deadline_at === 'number' && now < loop.deadline_at) continue;
      if (typeof loop.parked_at === 'number') continue;
      const ats = loop.mentions
        .map((m) => (m && typeof m.at === 'number' ? m.at : 0))
        .filter((t) => t > 0);
      if (ats.length < F7_MIN_MENTIONS) continue;
      const span = Math.max(...ats) - Math.min(...ats);
      if (span < F7_MIN_SPAN_MS) continue;
      const product = (loop.product_key ?? loop.topic_key ?? 'this').toString().trim().toLowerCase();
      out.push({
        pattern: 'research-paralysis',
        loop_id: loop.id,
        mention_count: ats.length,
        copy:
          "you've been deciding on " + product +
          " for 2+ weeks. set a deadline or park it? both are valid. research mode is fine until it isn't finishing.",
        copy_es:
          'llevas decidiendo sobre ' + product +
          ' más de 2 semanas. ¿le pones plazo o lo aparcas? ambas valen. modo investigación está bien hasta que no termina.',
        source: F_SOURCES.F7,
      });
    }
  } catch { /* */ }

  return out;
}

export function tagResearchLoops(
  dumps: DumpEntry[],
  loops: ResearchLoop[],
  now: number,
): ResearchLoop[] {
  const t = now;
  const out = Array.isArray(loops) ? loops.slice() : [];
  if (!Array.isArray(dumps)) return out;
  for (const d of dumps) {
    if (!d || typeof d.text !== 'string' || typeof d.ts !== 'number') continue;
    if (!RESEARCH_LOOP_RE.test(d.text)) continue;
    const topic = extractResearchTopic(d.text);
    if (!topic) continue;
    let loop = out.find((l) => l && (l.topic_key === topic || l.product_key === topic));
    if (!loop) {
      loop = {
        id: 'rl-' + d.ts.toString(36) + '-' + Math.random().toString(36).slice(2, 6),
        topic_key: topic,
        product_key: topic,
        mentions: [],
        deadline_at: null,
        parked_at: null,
      };
      out.push(loop);
    }
    if (loop.mentions.some((m) => m?.dump_ts === d.ts)) continue;
    loop.mentions.push({ dump_ts: d.ts, at: d.ts });
    loop.last_mentioned_at = t;
    loop.count = loop.mentions.length;
  }
  return out;
}
