/**
 * AdminModule — port of void AdminModule to ollie web app.
 *
 * Paper/ink palette (same as Work, Body). No frosted glass — admin is ceramic.
 * States covered: loading (useStoreSlice hydrates synchronously from store),
 * empty (editorial italic), error (deferred — orchestrator writes patterns),
 * happy path (full task list + pattern banners).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  detectPhoneTask,
  detectPaperworkSplit,
  detectFirehoseDump,
  detectDeferChain,
  detectTwoMinuteTask,
  detectRecurringPattern,
  scheduleRenewalCues,
  detectStaleBall,
  detectLast5Pct,
} from '@ollie/logic/admin';
import type {
  AdminTask,
  RenewalStage,
} from '@ollie/logic/admin';
import * as events from '@ollie/events';
import { useStoreSlice } from '../../store';
import { mkId } from '../../lib/mkId';
import { ModuleHelp } from '../../components/ModuleHelp';
import { SourcesLink } from '../../components/SourcesLink';

// ─── palette (paper/ink canonical, Serra-locked 2026-05-08) ──────────────────

const BG = '#F2EEE4';
const PAPER = '#F8F4EA';
const INK = '#14130F';
const MUTED = '#4B4740';
const FAINT = '#7C7770';
const HAIRLINE = 'rgba(20,19,15,0.10)';
const HAIRLINE_HI = 'rgba(20,19,15,0.28)';
const ACCENT = '#8A4B2C'; // umber — signals "action needed"

const LABEL: React.CSSProperties = {
  fontFamily: "'DM Mono',monospace",
  fontSize: 10,
  letterSpacing: '0.26em',
  color: MUTED,
  textTransform: 'uppercase',
  fontWeight: 500,
};

// ─── local types ──────────────────────────────────────────────────────────────

interface AdminItemRow extends AdminTask {
  // runtime fields appended in withDaysLeft memo
  _daysLeft: number | null;
  // legacy compat
  title?: string;
  due?: string | null;
  recur?: string;
  note?: string | null;
  status?: string;
  phone_assist?: boolean;
  ts?: number;
  action?: string;
}

interface RenewalCueEntry {
  stage: RenewalStage;
  days_left: number;
  copy: string;
}

interface StaleBallEntry {
  kind: string;
  days_overdue: number;
  copy: string;
}

interface Last5PctEntry {
  days_since_done: number;
  copy: string;
}

interface OpenLoopEntry {
  dump_id: string;
  copy: string;
}

interface PhoneTaskEntry {
  verb: string;
  text: string;
  ts: number;
}

interface PaperworkDumpEntry {
  copy: string;
  ts: number;
}

interface PaperworkTaskEntry {
  copy: string;
  ts: number;
}

interface FirehoseEntry {
  candidates: Array<{ token: string; checked: boolean }>;
  ts: number;
}

interface DeferChainEntry {
  defer_count: number;
  copy: string;
  expanded: boolean;
}

interface TwoMinEntry {
  count: number;
  batch: boolean;
  copy: string;
  ts: number;
}

interface RecurringCueEntry {
  category_or_label: string;
  predicted_next_ts: number | null;
  copy: string;
}

// Mirrors orchestrator/admin AdminPattern: every recompute entry carries a
// `signal` discriminator (e.g. 'admin_renewal_cue') plus per-signal fields.
// `signalKey()` in orchestrator/admin builds dedup keys as
// `signal[:task_id|:dump_id]` — idOf() below must stay identical so the
// store's `patterns_dismissed` map keys line up.
interface AdminPattern {
  signal?: string;
  copy?: string;
  copy_es?: string;
  task_id?: string;
  dump_id?: string;
  category_or_label?: string;
  cost_of_delay?: string;
  topic_key?: string;
  choice?: string;
  drift_count?: number;
  ref_count?: number;
  defer_count?: number;
  labels?: string[];
  sources?: Array<{ citation: string; url?: string }>;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function sanitize(s: string): string {
  const map: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[<>&"']/g, (c) => map[c] ?? c);
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase();
}

function relDays(n: number | null): string | null {
  if (n == null) return null;
  if (n < 0) return `${Math.abs(n)}d overdue`;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n <= 30) return `in ${n}d`;
  if (n <= 90) return `in ~${Math.round(n / 7)}wk`;
  if (n <= 365) return `in ~${Math.round(n / 30)}mo`;
  return `in ~${Math.round(n / 365)}yr`;
}

function cueCopy(label: string, stage: RenewalStage, daysLeft: number, verb: string): string {
  const lab = (label || 'renewal').trim() || 'renewal';
  const v = (verb || 'book the appointment').trim() || 'book the appointment';
  const dRound = Math.max(0, Math.ceil(daysLeft));
  if (stage === 'early') return `${lab} — ${dRound}d. start the paperwork now.`;
  if (stage === 'mid') return `${lab} — ${dRound}d. ${v} this week.`;
  if (stage === 'urgent') return `${lab} — ${dRound}d. ${v} today.`;
  if (stage === 'overdue') return `${lab} — expired ${Math.abs(Math.floor(daysLeft))}d ago. ${v}.`;
  return `${lab} — ${dRound}d.`;
}

function newId(): string {
  return mkId('ad');
}

const CATEGORIES: [string, string][] = [
  ['renewal', 'renewal'],
  ['appointment', 'appointment'],
  ['maintenance', 'maintenance'],
  ['financial', 'financial'],
  ['other', 'other'],
];

const RECURS: [string, string][] = [
  ['none', 'no'],
  ['month', 'monthly'],
  ['quarter', 'quarterly'],
  ['year', 'yearly'],
  ['2year', 'every 2 yrs'],
  ['5year', 'every 5 yrs'],
  ['10year', '10 yrs'],
];

const EMPTY_DRAFT = {
  title: '',
  category: 'renewal',
  due: '',
  recur: 'none',
  note: '',
  kind: 'task',
  expiry_date: '',
  ball_state: 'MINE',
  eta_date: '',
  duration_min: '',
};

// ─── phone-task cluster ──────────────────────────────────────────────────────
// Tasks tagged `phone_assist` (set when accepting a detected phone task, or
// when a deferred task is routed "phone") are grouped into one "calls to
// make" cluster. Pure selector — open, non-closed phone tasks only, oldest
// first so the longest-waiting call surfaces at the top.

export function selectPhoneTasks(items: AdminItemRow[] | null | undefined): AdminItemRow[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((it): it is AdminItemRow => {
      if (!it || it.phone_assist !== true) return false;
      if (!it.title && !it.label) return false;
      const st = it.state ?? (it.status === 'done' ? 'closed' : 'active');
      return st !== 'closed';
    })
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
}

// ─── AdminReflected · Sprint 5 · F5 ──────────────────────────────────────────
// Reads `admin.reflected` written by the cross-module router when, e.g.,
// `finance:reminder_set` fires. Surfaces reminders forwarded from other
// modules so the user sees one consolidated upcoming list. Dismissable.

interface AdminReflectedEntry {
  id: string;
  source_event?: string;
  source_module?: string;
  kind?: string;
  due_at: number;
  message?: string;
  ts: number;
}

function fmtDueAt(ts: number): string {
  const ms = ts - Date.now();
  if (ms < 0) return `${Math.abs(Math.floor(ms / 86_400_000))}d overdue`;
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days}d`;
  return `in ~${Math.round(days / 7)}wk`;
}

function AdminReflected() {
  const [reflected, setReflected] = useStoreSlice<AdminReflectedEntry[]>('admin', 'reflected', []);
  const [dismissed, setDismissed] = useStoreSlice<string[]>('admin', 'reflected_dismissed', []);
  const dset = new Set(dismissed ?? []);
  const list = (reflected ?? [])
    .filter((r) => r?.id && !dset.has(r.id))
    .sort((a, b) => a.due_at - b.due_at);
  if (list.length === 0) return null;
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ ...LABEL, paddingBottom: 10, borderBottom: `1px solid ${HAIRLINE}` }}>
        reflected here
      </div>
      {list.map((r) => (
        <div
          key={r.id}
          style={{
            padding: '14px 18px',
            background: PAPER,
            borderBottom: `1px solid ${HAIRLINE}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: "'Inter Tight', 'DM Sans', sans-serif", fontSize: 14, color: INK }}>
              {r.message || (r.kind ?? 'item')}
            </span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: FAINT }}>
              {r.source_module ?? 'elsewhere'} · {fmtDueAt(r.due_at)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDismissed([...(dismissed ?? []), r.id])}
            aria-label="dismiss reflected"
            style={{
              minHeight: 44,
              padding: '8px 12px',
              background: 'transparent',
              color: FAINT,
              border: `1px solid ${HAIRLINE}`,
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              borderRadius: 2,
            }}
          >
            dismiss
          </button>
        </div>
      ))}
    </section>
  );
}

// ─── AdminNoticed ─────────────────────────────────────────────────────────────

function AdminNoticed() {
  const [patterns] = useStoreSlice<AdminPattern[]>('admin', 'patterns', []);
  const [dismissed, setDismissed] = useStoreSlice<Record<string, number>>('admin', 'patterns_dismissed', {});

  const list = useMemo(() => (Array.isArray(patterns) ? patterns : []), [patterns]);

  // Stable per-pattern key. MUST match orchestrator/admin signalKey() exactly,
  // otherwise the patterns_dismissed map keyed here drifts from what recompute
  // produces. Falls back to the array index (passed in) only when a pattern
  // has no `signal` at all — so an identity-less entry can't collide with and
  // dismiss every other entry (the old bug: all keys collapsed to '?').
  const idOf = useCallback((p: AdminPattern, i: number): string => {
    if (!p.signal) return `?:${i}`;
    if (typeof p.task_id === 'string') return `${p.signal}:${p.task_id}`;
    if (typeof p.dump_id === 'string') return `${p.signal}:${p.dump_id}`;
    if (typeof p.category_or_label === 'string') return `${p.signal}:${p.category_or_label}`;
    return p.signal;
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissed({ ...(dismissed ?? {}), [id]: Date.now() });
  }, [dismissed, setDismissed]);

  // Resolve each pattern's id against its index in the *full* list, so the
  // fallback `?:i` key is stable as siblings get dismissed (filtering would
  // otherwise renumber survivors and re-key them).
  const visible = useMemo(
    () =>
      list
        .map((p, i) => ({ p, id: idOf(p, i) }))
        .filter(({ p, id }) => p && p.copy && !(dismissed && dismissed[id])),
    [list, dismissed, idOf],
  );

  const metaFor = (p: AdminPattern): string[] => {
    const bits: string[] = [];
    if (typeof p.drift_count === 'number') bits.push(`${p.drift_count} in a row`);
    if (typeof p.ref_count === 'number') bits.push(`${p.ref_count} ref${p.ref_count === 1 ? '' : 's'}`);
    if (typeof p.defer_count === 'number') bits.push(`deferred ${p.defer_count}×`);
    if (p.category_or_label) bits.push(p.category_or_label);
    if (p.topic_key) bits.push(p.topic_key);
    if (p.choice) bits.push(`choice: ${p.choice}`);
    if (Array.isArray(p.labels) && p.labels.length > 0) bits.push(p.labels.join(' · '));
    return bits;
  };

  return (
    <section style={{ marginTop: 64, paddingTop: 28, borderTop: `1px solid ${HAIRLINE}` }}>
      <div style={{ ...LABEL, paddingBottom: 20 }}>— noticed</div>
      {visible.length === 0 ? (
        <div style={{
          fontFamily: "'Inter Tight',sans-serif",
          fontSize: 15,
          color: MUTED,
          lineHeight: 1.55,
          fontStyle: 'italic',
        }}>
          nothing to mirror right now. add a renewal, schedule a thing, see what surfaces.
        </div>
      ) : (
        visible.map(({ p, id }) => {
          const meta = metaFor(p);
          const sourceUrls = Array.isArray(p.sources)
            ? p.sources.map((s) => s?.url).filter((u): u is string => typeof u === 'string')
            : [];
          return (
            <div key={id} style={{
              padding: '18px 20px',
              background: PAPER,
              borderLeft: `2px solid ${ACCENT}`,
              borderRadius: 2,
              marginBottom: 12,
              position: 'relative',
            }}>
              <button
                type="button"
                onClick={() => dismiss(id)}
                aria-label="dismiss"
                style={{
                  position: 'absolute', top: 10, right: 12,
                  background: 'transparent', border: 'none', color: FAINT,
                  fontFamily: "'DM Mono',monospace", fontSize: 14,
                  cursor: 'pointer', padding: '10px 8px', minHeight: 44, lineHeight: 1,
                }}
              >×</button>
              <div style={{
                fontFamily: "'DM Mono',monospace", fontSize: 9,
                letterSpacing: '0.24em', color: FAINT,
                textTransform: 'uppercase', paddingBottom: 8,
              }}>{(p.signal ?? '').replace(/^admin_/, '').replace(/_/g, ' ')}</div>
              <div style={{
                fontFamily: "'Inter Tight',sans-serif", fontSize: 16,
                color: INK, lineHeight: 1.55, paddingRight: 24,
              }}>{p.copy}</div>
              {p.cost_of_delay && (
                <div style={{
                  fontFamily: "'Inter Tight',sans-serif", fontSize: 13,
                  color: MUTED, lineHeight: 1.5, paddingTop: 8, fontStyle: 'italic',
                }}>"{p.cost_of_delay}"</div>
              )}
              {meta.length > 0 && (
                <div style={{
                  fontFamily: "'DM Mono',monospace", fontSize: 9,
                  letterSpacing: '0.22em', color: FAINT,
                  textTransform: 'uppercase', paddingTop: 10,
                  display: 'flex', gap: 10, flexWrap: 'wrap',
                }}>
                  {meta.map((m, idx) => (
                    <React.Fragment key={idx}>
                      {idx > 0 && <span>·</span>}
                      <span>{m}</span>
                    </React.Fragment>
                  ))}
                </div>
              )}
              {sourceUrls.length > 0 && (
                <div style={{ paddingTop: 8 }}>
                  <SourcesLink sources={sourceUrls} />
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

// ─── AdminModule ──────────────────────────────────────────────────────────────

interface AdminModuleProps {
  onBack: () => void;
}

export function AdminModule({ onBack }: AdminModuleProps) {
  const [items, setItems] = useStoreSlice<AdminItemRow[]>('admin', 'tasks', []);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [filter, setFilter] = useState<'active' | 'done' | 'all'>('active');

  // ── banner state (populated by events / direct detector calls on dump) ──
  const [renewalCues, setRenewalCues] = useState<Record<string, RenewalCueEntry>>({});
  const [staleBalls, setStaleBalls] = useState<Record<string, StaleBallEntry>>({});
  const [last5Pcts, setLast5Pcts] = useState<Record<string, Last5PctEntry>>({});
  const [openLoop, setOpenLoop] = useState<OpenLoopEntry | null>(null);
  const [openLoopDismissed, setOpenLoopDismissed] = useState(false);
  const [phoneTask, setPhoneTask] = useState<PhoneTaskEntry | null>(null);
  const [paperworkDump, setPaperworkDump] = useState<PaperworkDumpEntry | null>(null);
  const [paperworkTasks, setPaperworkTasks] = useState<Record<string, PaperworkTaskEntry>>({});
  const [firehose, setFirehose] = useState<FirehoseEntry | null>(null);
  const [deferChains, setDeferChains] = useState<Record<string, DeferChainEntry>>({});
  const [twoMin, setTwoMin] = useState<TwoMinEntry | null>(null);
  const [recurringCues, setRecurringCues] = useState<Record<string, RecurringCueEntry>>({});
  const [lastDumpText, setLastDumpText] = useState('');
  const [burstOpen, setBurstOpen] = useState(false);
  const [burstIdx, setBurstIdx] = useState(0);
  const [burstIds, setBurstIds] = useState<string[]>([]);

  // ── migrate legacy status field → canonical state ────────────────────────
  useEffect(() => {
    const list = items ?? [];
    if (!list.length) return;
    let dirty = false;
    const next = list.map((it) => {
      if (!it) return it;
      let n = { ...it };
      if (n.status === 'done' && !n.state) {
        n = { ...n, state: 'closed', closed_at: typeof n.done_at === 'number' ? n.done_at : (n.ts ?? Date.now()) };
        dirty = true;
      }
      if (typeof n.label !== 'string' && typeof n.title === 'string') {
        n = { ...n, label: n.title };
        dirty = true;
      }
      return n;
    });
    if (dirty) setItems(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ── event subscriptions ───────────────────────────────────────────────────
  // orchestrator/admin recompute emits these via @ollie/events (in-memory bus,
  // not window.dispatchEvent). The legacy window.VOID bus never existed in the
  // ollie web app, so this panel was silently dead before this wire-up.
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    try {
      unsubs.push(events.on('admin:renewal_cue', (raw) => {
        const p = raw as { task_id?: string; stage?: RenewalStage; days_left?: number };
        if (!p?.task_id) return;
        const cur = (items ?? []).find((x) => x?.id === p.task_id);
        const lab = (cur && (cur.label ?? cur.title)) ?? 'renewal';
        const verb = (cur as AdminTask & { action_verb?: string })?.action_verb ?? '';
        setRenewalCues((prev) => ({
          ...prev,
          [p.task_id!]: {
            stage: p.stage ?? 'early',
            days_left: p.days_left ?? 0,
            copy: cueCopy(lab, p.stage ?? 'early', p.days_left ?? 0, verb),
          },
        }));
      }));

      unsubs.push(events.on('admin:stale_ball', (raw) => {
        const p = raw as { task_id?: string; kind?: string; days_overdue?: number };
        if (!p?.task_id) return;
        const days = p.days_overdue ?? 0;
        const copy = p.kind === 'deadline_passed'
          ? `deadline passed ${days}d`
          : `they've had it ${days}d`;
        setStaleBalls((prev) => ({ ...prev, [p.task_id!]: { kind: p.kind ?? '', days_overdue: days, copy } }));
      }));

      unsubs.push(events.on('admin:last_5pct', (raw) => {
        const p = raw as { task_id?: string; days_since_done?: number };
        if (!p?.task_id) return;
        setLast5Pcts((prev) => ({
          ...prev,
          [p.task_id!]: { days_since_done: p.days_since_done ?? 0, copy: '95% done — close it?' },
        }));
      }));

      unsubs.push(events.on('admin:open_loop_missing', (raw) => {
        const p = raw as { dump_id?: string };
        if (!p?.dump_id) return;
        setOpenLoop({ dump_id: p.dump_id, copy: "you said 'i should…'. add a when+where+how?" });
      }));

      unsubs.push(events.on('void:braindump:submitted', (raw) => {
        try {
          const p = raw as { text?: string; raw?: string; idempotency_key?: string };
          if (!p) return;
          const text = p.raw ?? p.text ?? '';
          if (!text) return;
          setLastDumpText(text);
          const hit = detectPhoneTask(text);
          if (!hit) return;
          setPhoneTask({ verb: hit.verb, text, ts: Date.now() });
        } catch { /* non-fatal */ }
      }));

      unsubs.push(events.on('admin:paperwork_split', (raw) => {
        try {
          const p = raw as { dump_match?: boolean; task_id?: string };
          if (!p) return;
          const now = Date.now();
          if (p.dump_match) {
            let copy = 'paperwork dump detected. split into GATHER + FILL?';
            const hit = detectPaperworkSplit({ dump_text: lastDumpText }, { now });
            if (hit && !Array.isArray(hit) && hit.copy) copy = hit.copy;
            setPaperworkDump({ copy, ts: now });
            return;
          }
          if (p.task_id) {
            let copy = 'paperwork — split GATHER + FILL?';
            const hits = detectPaperworkSplit({ tasks: items ?? [] }, { now });
            if (Array.isArray(hits)) {
              const m = hits.find((h) => h && (h as { task_id?: string }).task_id === p.task_id);
              if (m && m.copy) copy = m.copy;
            }
            setPaperworkTasks((prev) => ({ ...prev, [p.task_id!]: { copy, ts: now } }));
          }
        } catch { /* non-fatal */ }
      }));

      unsubs.push(events.on('admin:firehose_dump', () => {
        try {
          const now = Date.now();
          const hit = detectFirehoseDump({ dump_text: lastDumpText }, { now });
          if (!hit || !Array.isArray(hit.candidate_items) || hit.candidate_items.length === 0) return;
          setFirehose({
            candidates: hit.candidate_items.map((tok) => ({ token: tok, checked: true })),
            ts: now,
          });
        } catch { /* non-fatal */ }
      }));

      unsubs.push(events.on('admin:defer_chain', (raw) => {
        try {
          const p = raw as { task_id?: string; defer_count?: number };
          if (!p?.task_id) return;
          const now = Date.now();
          let copy = `${p.task_id} deferred ${p.defer_count ?? 0} times. phone? form? confrontation?`;
          const hits = detectDeferChain({ tasks: items ?? [] }, { now });
          if (Array.isArray(hits)) {
            const m = hits.find((h) => h && (h as { task_id?: string }).task_id === p.task_id);
            if (m && m.copy) copy = m.copy;
          }
          setDeferChains((prev) => ({
            ...prev,
            [p.task_id!]: {
              defer_count: p.defer_count ?? 0,
              copy,
              expanded: prev[p.task_id!]?.expanded ?? false,
            },
          }));
        } catch { /* non-fatal */ }
      }));

      unsubs.push(events.on('admin:two_minute_tasks', (raw) => {
        try {
          const p = raw as { count?: number; batch?: boolean };
          if (!p) return;
          const now = Date.now();
          let copy = `${p.count ?? 0} micro-task${p.count === 1 ? '' : 's'} under 2min.`;
          const hit = detectTwoMinuteTask({ tasks: items ?? [] }, { now });
          if (hit && hit.copy) copy = hit.copy;
          setTwoMin({ count: p.count ?? 0, batch: !!p.batch, copy, ts: now });
        } catch { /* non-fatal */ }
      }));

      unsubs.push(events.on('admin:recurring_pattern', (raw) => {
        try {
          const p = raw as { category_or_label?: string; predicted_next_ts?: number };
          if (!p?.category_or_label) return;
          const now = Date.now();
          const lab = p.category_or_label;
          let copy = `last year you did ${lab} this month. ready?`;
          const hits = detectRecurringPattern({ tasks: items ?? [] }, { now });
          if (Array.isArray(hits)) {
            const m = hits.find((h) => h && (h as { category_or_label?: string }).category_or_label === lab);
            if (m && m.copy) copy = m.copy;
          }
          setRecurringCues((prev) => ({
            ...prev,
            [lab]: { category_or_label: lab, predicted_next_ts: p.predicted_next_ts ?? null, copy },
          }));
        } catch { /* non-fatal */ }
      }));
    } catch (e) {
      console.error('[AdminModule] event subscribe failed:', e);
    }

    return () => { unsubs.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } }); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── computed renewal cues from logic on mount / items change ────────────
  useEffect(() => {
    const now = Date.now();
    const cues = scheduleRenewalCues({ tasks: items ?? [] }, { now });
    if (!Array.isArray(cues)) return;
    setRenewalCues((prev) => {
      const next = { ...prev };
      for (const cue of cues) {
        if (!cue?.task_id) continue;
        const cur = (items ?? []).find((x) => x?.id === cue.task_id);
        const lab = (cur && (cur.label ?? cur.title)) ?? 'renewal';
        const verb = (cur as AdminTask & { action_verb?: string })?.action_verb ?? '';
        next[cue.task_id] = {
          stage: cue.stage,
          days_left: cue.days_left,
          copy: cueCopy(lab, cue.stage, cue.days_left, verb),
        };
      }
      return next;
    });

    const staleSigs = detectStaleBall({ tasks: items ?? [] }, { now });
    if (Array.isArray(staleSigs)) {
      setStaleBalls((prev) => {
        const next = { ...prev };
        for (const s of staleSigs) {
          if (!s?.task_id) continue;
          const days = s.days_overdue ?? 0;
          next[s.task_id] = {
            kind: s.kind,
            days_overdue: days,
            copy: s.kind === 'deadline_passed' ? `deadline passed ${days}d` : `they've had it ${days}d`,
          };
        }
        return next;
      });
    }

    const last5Sigs = detectLast5Pct({ tasks: items ?? [] }, { now });
    if (Array.isArray(last5Sigs)) {
      setLast5Pcts((prev) => {
        const next = { ...prev };
        for (const s of last5Sigs) {
          if (!s?.task_id) continue;
          next[s.task_id] = { days_since_done: s.days_since_done, copy: '95% done — close it?' };
        }
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ── save ─────────────────────────────────────────────────────────────────
  const save = useCallback(() => {
    const t = draft.title.trim();
    if (!t) return;
    const now = Date.now();
    const expiryTs = draft.kind === 'renewal' && draft.expiry_date
      ? new Date(draft.expiry_date + 'T00:00:00').getTime()
      : null;
    const etaTs = draft.ball_state === 'WAITING' && draft.eta_date
      ? new Date(draft.eta_date + 'T00:00:00').getTime()
      : null;
    const rawDur = parseFloat(draft.duration_min);
    const durMin = Number.isFinite(rawDur) && rawDur > 0 ? rawDur : null;
    const item: AdminItemRow = {
      id: newId(),
      title: sanitize(t),
      label: sanitize(t),
      category: draft.category,
      kind: draft.kind || 'task',
      due: (draft.kind === 'renewal' ? draft.expiry_date : draft.due) || null,
      expiry_ts: expiryTs ?? undefined,
      ball_state: (draft.ball_state as 'MINE' | 'THEIRS' | 'WAITING') || 'MINE',
      last_transition_at: now,
      eta_at: etaTs ?? undefined,
      recur: draft.recur || 'none',
      note: draft.note.trim() ? sanitize(draft.note) : null,
      duration_min: durMin ?? undefined,
      defer_count: 0,
      action: 'add',
      ts: now,
      status: 'active',
      state: 'active',
      _daysLeft: null,
    };
    setItems([...(items ?? []), item]);
    setDraft({ ...EMPTY_DRAFT });
    setAddOpen(false);
  }, [draft, items, setItems]);

  // ── markDone / closeLoop / del ────────────────────────────────────────────
  const markDone = useCallback((id: string) => {
    setItems((items ?? []).map((it) => {
      if (!it || it.id !== id) return it;
      if (it.recur && it.recur !== 'none' && it.due) {
        const d = new Date(it.due);
        if (!isNaN(d.getTime())) {
          if (it.recur === 'year') d.setFullYear(d.getFullYear() + 1);
          else if (it.recur === '2year') d.setFullYear(d.getFullYear() + 2);
          else if (it.recur === '5year') d.setFullYear(d.getFullYear() + 5);
          else if (it.recur === '10year') d.setFullYear(d.getFullYear() + 10);
          else if (it.recur === 'month') d.setMonth(d.getMonth() + 1);
          else if (it.recur === 'quarter') d.setMonth(d.getMonth() + 3);
          const newDue = d.toISOString().slice(0, 10);
          return { ...it, due: newDue, last_done_at: now() };
        }
      }
      return { ...it, status: 'done', state: 'done', done_at: now() };
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, setItems]);

  const closeLoop = useCallback((id: string) => {
    setItems((items ?? []).map((it) => {
      if (!it || it.id !== id) return it;
      return { ...it, status: 'done', state: 'closed', closed_at: now() };
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, setItems]);

  const del = useCallback((id: string) => {
    setItems((items ?? []).filter((it) => it && it.id !== id));
  }, [items, setItems]);

  // ── phone task ────────────────────────────────────────────────────────────
  const acceptPhoneTask = useCallback(() => {
    if (!phoneTask) return;
    const n = now();
    const item: AdminItemRow = {
      id: newId(),
      title: sanitize((phoneTask.text ?? '').slice(0, 200)),
      label: sanitize((phoneTask.text ?? '').slice(0, 200)),
      category: 'other',
      kind: 'task',
      due: null,
      ball_state: 'MINE',
      last_transition_at: n,
      recur: 'none',
      action: 'add',
      ts: n,
      status: 'active',
      state: 'active',
      phone_assist: true,
      _daysLeft: null,
    };
    setItems([...(items ?? []), item]);
    setPhoneTask(null);
  }, [phoneTask, items, setItems]);

  // ── paperwork split ───────────────────────────────────────────────────────
  const splitIntoGatherFill = useCallback((parentLabel: string, parentId: string | null) => {
    const n = now();
    const lab = (parentLabel || 'paperwork').trim() || 'paperwork';
    const mk = (suffix: string): AdminItemRow => ({
      id: newId(),
      title: sanitize(`${lab} · ${suffix}`),
      label: sanitize(`${lab} · ${suffix}`),
      category: 'other',
      kind: 'task',
      due: null,
      ball_state: 'MINE',
      last_transition_at: n,
      recur: 'none',
      duration_min: undefined,
      defer_count: 0,
      parent_task_id: parentId ?? undefined,
      stage: suffix,
      action: 'add',
      ts: n,
      status: 'active',
      state: 'active',
      _daysLeft: null,
    });
    setItems([...(items ?? []), mk('GATHER'), mk('FILL')]);
  }, [items, setItems]);

  const acceptPaperworkDump = useCallback(() => {
    const lab = (lastDumpText || 'paperwork').slice(0, 80).trim() || 'paperwork';
    splitIntoGatherFill(lab, null);
    setPaperworkDump(null);
  }, [lastDumpText, splitIntoGatherFill]);

  const acceptPaperworkTask = useCallback((taskId: string) => {
    const t = (items ?? []).find((x) => x && x.id === taskId);
    if (!t) return;
    splitIntoGatherFill(t.label ?? t.title ?? 'paperwork', taskId);
    setPaperworkTasks((prev) => { const n = { ...prev }; delete n[taskId]; return n; });
  }, [items, splitIntoGatherFill]);

  const dismissPaperworkTask = useCallback((taskId: string) => {
    setPaperworkTasks((prev) => { const n = { ...prev }; delete n[taskId]; return n; });
  }, []);

  // ── firehose ──────────────────────────────────────────────────────────────
  const toggleFirehose = useCallback((idx: number) => {
    if (!firehose) return;
    const next = firehose.candidates.map((c, i) => i === idx ? { ...c, checked: !c.checked } : c);
    setFirehose({ ...firehose, candidates: next });
  }, [firehose]);

  const addFirehoseSelected = useCallback(() => {
    if (!firehose) return;
    const picked = firehose.candidates.filter((c) => c.checked);
    if (picked.length === 0) { setFirehose(null); return; }
    const n = now();
    const made = picked.map((c): AdminItemRow => ({
      id: mkId('ad'),
      title: sanitize(c.token),
      label: sanitize(c.token),
      category: 'other',
      kind: 'task',
      due: null,
      ball_state: 'MINE',
      last_transition_at: n,
      recur: 'none',
      duration_min: undefined,
      defer_count: 0,
      action: 'add',
      ts: n,
      status: 'active',
      state: 'active',
      _daysLeft: null,
    }));
    setItems([...(items ?? []), ...made]);
    setFirehose(null);
  }, [firehose, items, setItems]);

  // ── defer ─────────────────────────────────────────────────────────────────
  const deferTask = useCallback((id: string) => {
    setItems((items ?? []).map((it) => {
      if (!it || it.id !== id) return it;
      const n = now();
      const nextCount = (typeof it.defer_count === 'number' ? it.defer_count : 0) + 1;
      let nextDue = it.due ?? null;
      let nextExpiryTs = it.expiry_ts;
      const nextEtaAt = typeof it.eta_at === 'number' ? it.eta_at + 7 * 86400000 : it.eta_at;
      if (it.due) {
        const d = new Date(it.due);
        if (!isNaN(d.getTime())) {
          d.setDate(d.getDate() + 7);
          nextDue = d.toISOString().slice(0, 10);
          if (it.kind === 'renewal') nextExpiryTs = new Date(nextDue + 'T00:00:00').getTime();
        }
      }
      return { ...it, defer_count: nextCount, last_deferred_at: n, last_transition_at: n, due: nextDue, expiry_ts: nextExpiryTs, eta_at: nextEtaAt };
    }));
  }, [items, setItems]);

  const expandDeferChain = useCallback((id: string) => {
    setDeferChains((prev) => {
      if (!prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], expanded: !prev[id].expanded } };
    });
  }, []);

  const deferRoot = useCallback((id: string, kind: 'phone' | 'form' | 'confrontation') => {
    setItems((items ?? []).map((it) => {
      if (!it || it.id !== id) return it;
      if (kind === 'phone') return { ...it, phone_assist: true };
      if (kind === 'form') return { ...it, kind: 'task' };
      if (kind === 'confrontation') return { ...it, category: 'confrontation' };
      return it;
    }));
    setDeferChains((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }, [items, setItems]);

  // ── A8 burst ──────────────────────────────────────────────────────────────
  const doNow = useCallback((id: string) => {
    setItems((items ?? []).map((it) => {
      if (!it || it.id !== id) return it;
      return { ...it, status: 'done', state: 'done', done_at: now() };
    }));
  }, [items, setItems]);

  const startBurst = useCallback(() => {
    const ids = (items ?? [])
      .filter((it) => it && (it.state ?? (it.status === 'done' ? 'closed' : 'active')) === 'active')
      .filter((it) => typeof it.duration_min === 'number' && it.duration_min <= 2)
      .map((it) => it.id);
    if (ids.length === 0) { setTwoMin(null); return; }
    setBurstIds(ids);
    setBurstIdx(0);
    setBurstOpen(true);
  }, [items]);

  const burstAdvance = useCallback(() => {
    const id = burstIds[burstIdx];
    if (id) {
      setItems((items ?? []).map((it) => {
        if (!it || it.id !== id) return it;
        return { ...it, status: 'done', state: 'done', done_at: now() };
      }));
    }
    const next = burstIdx + 1;
    if (next >= burstIds.length) {
      setBurstOpen(false);
      setBurstIdx(0);
      setBurstIds([]);
      setTwoMin(null);
    } else {
      setBurstIdx(next);
    }
  }, [burstIds, burstIdx, items, setItems]);

  const burstClose = useCallback(() => {
    setBurstOpen(false);
    setBurstIdx(0);
    setBurstIds([]);
  }, []);

  // ── A10 recurring ─────────────────────────────────────────────────────────
  const acceptRecurring = useCallback((key: string) => {
    const cue = recurringCues[key];
    if (!cue) return;
    const expIso = cue.predicted_next_ts
      ? new Date(cue.predicted_next_ts).toISOString().slice(0, 10)
      : '';
    setDraft((d) => ({ ...d, title: cue.category_or_label, kind: 'renewal', expiry_date: expIso, due: '' }));
    setAddOpen(true);
    setRecurringCues((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, [recurringCues]);

  const skipRecurring = useCallback((key: string) => {
    setRecurringCues((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  // ── derived list ──────────────────────────────────────────────────────────
  const withDaysLeft = useMemo((): AdminItemRow[] => {
    return (items ?? [])
      .filter((it) => it && it.title)
      .map((it) => {
        let daysLeft: number | null = null;
        if (it.due) {
          const d = new Date(it.due);
          if (!isNaN(d.getTime())) daysLeft = Math.ceil((d.getTime() - Date.now()) / 86400000);
        }
        return { ...it, _daysLeft: daysLeft };
      })
      .filter((it) => {
        const st = it.state ?? (it.status === 'done' ? 'closed' : 'active');
        if (filter === 'all') return true;
        if (filter === 'done') return st === 'closed';
        return st !== 'closed';
      })
      .sort((a, b) => {
        if (a._daysLeft == null && b._daysLeft == null) return 0;
        if (a._daysLeft == null) return 1;
        if (b._daysLeft == null) return -1;
        return a._daysLeft - b._daysLeft;
      });
  }, [items, filter]);

  const urgent = useMemo(() => withDaysLeft.filter((it) => {
    const st = it.state ?? (it.status === 'done' ? 'closed' : 'active');
    return it._daysLeft != null && it._daysLeft <= 14 && st !== 'closed';
  }), [withDaysLeft]);

  // Phone-task cluster — open `phone_assist` tasks grouped together.
  const phoneTasks = useMemo(() => selectPhoneTasks(items), [items]);

  // ── counts for filter tabs ────────────────────────────────────────────────
  const activeCount = useMemo(() =>
    (items ?? []).filter((it) => {
      if (!it) return false;
      const st = it.state ?? (it.status === 'done' ? 'closed' : 'active');
      return st !== 'closed';
    }).length,
  [items]);

  const doneCount = useMemo(() =>
    (items ?? []).filter((it) => {
      if (!it) return false;
      const st = it.state ?? (it.status === 'done' ? 'closed' : 'active');
      return st === 'closed';
    }).length,
  [items]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: '100vw',
      minHeight: '100vh',
      overflowX: 'hidden',
      background: BG,
      color: INK,
      fontFamily: "'Inter Tight','DM Sans',sans-serif",
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: 'clamp(32px, 5vw, 44px) clamp(24px, 5vw, 56px) 120px' }}>

        {/* ── breadcrumb header ──────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingBottom: 52,
          fontFamily: "'DM Mono',monospace",
          fontSize: 10,
          letterSpacing: '0.24em',
          color: MUTED,
          textTransform: 'uppercase',
        }}>
          <button
            type="button"
            onClick={onBack}
            style={{ background: 'none', border: 'none', color: MUTED, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', cursor: 'pointer' }}
          >
            ← dashboard
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span>ollie <span style={{ color: FAINT, margin: '0 10px' }}>/</span> <span style={{ color: INK }}>admin</span></span>
            <ModuleHelp moduleId="admin" />
          </div>
        </div>

        {/* ── title row ─────────────────────────────────────────────────── */}
        <div style={{
          paddingBottom: 20,
          borderBottom: `1px solid ${HAIRLINE}`,
          marginBottom: 32,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 14,
        }}>
          <div>
            <div style={{
              fontFamily: "'DM Serif Display',serif",
              fontSize: 'clamp(34px, 4vw, 46px)',
              color: INK,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}>
              admin.
            </div>
            <div style={{
              fontFamily: "'DM Serif Display',serif",
              fontStyle: 'italic',
              fontSize: 'clamp(16px, 1.5vw, 18px)',
              color: MUTED,
              paddingTop: 10,
            }}>
              the stuff you forget about. passport, lease, taxes, dentist.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            style={{
              padding: '12px 22px',
              background: addOpen ? INK : 'transparent',
              color: addOpen ? BG : INK,
              border: `1px solid ${addOpen ? INK : HAIRLINE_HI}`,
              fontFamily: "'DM Mono',monospace",
              fontSize: 10,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              borderRadius: 2,
            }}
          >{addOpen ? 'close' : '+ new'}</button>
        </div>

        {/* ── urgent banner ─────────────────────────────────────────────── */}
        {urgent.length > 0 && filter === 'active' && (
          <div style={{
            padding: '18px 24px',
            background: PAPER,
            borderLeft: `2px solid ${ACCENT}`,
            borderRadius: 2,
            marginBottom: 32,
          }}>
            <div style={{ ...LABEL, color: ACCENT, paddingBottom: 6, fontSize: 9 }}>due soon</div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 15, color: INK, lineHeight: 1.5 }}>
              {urgent.length} {urgent.length === 1 ? 'thing' : 'things'} due in the next 2 weeks.
            </div>
          </div>
        )}

        {/* ── A4 paperwork dump banner ──────────────────────────────────── */}
        {filter === 'active' && paperworkDump && (
          <div style={{ padding: '14px 20px', background: '#EDE7DC', borderLeft: `2px solid ${INK}`, borderRadius: 2, marginBottom: 12 }}>
            <div style={{ ...LABEL, paddingBottom: 6, fontSize: 9 }}>paperwork dump</div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, color: INK, lineHeight: 1.5, paddingBottom: 10 }}>
              {paperworkDump.copy}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={acceptPaperworkDump} style={btnPrimary}>split it</button>
              <button type="button" onClick={() => setPaperworkDump(null)} style={btnGhost}>keep as one</button>
            </div>
          </div>
        )}

        {/* ── A10 recurring pattern cues ────────────────────────────────── */}
        {filter === 'active' && Object.keys(recurringCues).map((k) => {
          const cue = recurringCues[k];
          if (!cue) return null;
          return (
            <div key={`rp-${k}`} style={{ padding: '14px 20px', background: '#EDE7DC', borderLeft: `2px solid ${MUTED}`, borderRadius: 2, marginBottom: 12 }}>
              <div style={{ ...LABEL, paddingBottom: 6, fontSize: 9 }}>recurring · annual</div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, color: INK, lineHeight: 1.5, paddingBottom: 10 }}>{cue.copy}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => acceptRecurring(k)} style={btnPrimary}>create task</button>
                <button type="button" onClick={() => skipRecurring(k)} style={btnGhost}>skip this year</button>
              </div>
            </div>
          );
        })}

        {/* ── A8 burst session banner ───────────────────────────────────── */}
        {filter === 'active' && twoMin?.batch && (
          <div style={{ padding: '14px 20px', background: '#EDE7DC', borderLeft: `2px solid ${ACCENT}`, borderRadius: 2, marginBottom: 12 }}>
            <div style={{ ...LABEL, color: ACCENT, paddingBottom: 6, fontSize: 9 }}>2-minute batch</div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, color: INK, lineHeight: 1.5, paddingBottom: 10 }}>
              {twoMin.count} micro-tasks under 2min each. burst session?
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={startBurst} style={btnPrimary}>start burst</button>
              <button type="button" onClick={() => setTwoMin(null)} style={btnGhost}>later</button>
            </div>
          </div>
        )}

        {/* ── renewal cue banners ───────────────────────────────────────── */}
        {filter === 'active' && Object.keys(renewalCues).map((taskId) => {
          const cue = renewalCues[taskId];
          if (!cue) return null;
          const t = (items ?? []).find((x) => x?.id === taskId);
          if (!t) return null;
          const st = t.state ?? (t.status === 'done' ? 'closed' : 'active');
          if (st === 'closed') return null;
          const stageColor = cue.stage === 'early' ? FAINT : cue.stage === 'mid' ? MUTED : INK;
          return (
            <div key={`rc-${taskId}`} style={{ padding: '14px 20px', background: PAPER, borderLeft: `2px solid ${stageColor}`, borderRadius: 2, marginBottom: 12 }}>
              <div style={{ ...LABEL, color: stageColor, paddingBottom: 6, fontSize: 9 }}>renewal · {cue.stage}</div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, color: INK, lineHeight: 1.5 }}>{cue.copy}</div>
            </div>
          );
        })}

        {/* ── open loop banner ──────────────────────────────────────────── */}
        {openLoop && !openLoopDismissed && (
          <div style={{ padding: '14px 20px', background: PAPER, borderLeft: `2px solid ${MUTED}`, borderRadius: 2, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div>
              <div style={{ ...LABEL, paddingBottom: 6, fontSize: 9 }}>open loop</div>
              <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, color: INK, lineHeight: 1.5 }}>{openLoop.copy}</div>
            </div>
            <button type="button" onClick={() => setOpenLoopDismissed(true)} aria-label="dismiss open loop" style={{ minHeight: 44, padding: '8px 12px', background: 'transparent', color: FAINT, border: 'none', fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' }}>×</button>
          </div>
        )}

        {/* ── phone task banner ─────────────────────────────────────────── */}
        {phoneTask && (
          <div style={{ padding: '14px 20px', background: PAPER, borderLeft: `2px solid ${INK}`, borderRadius: 2, marginBottom: 12 }}>
            <div style={{ ...LABEL, paddingBottom: 6, fontSize: 9 }}>phone task detected</div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, color: INK, lineHeight: 1.5, paddingBottom: 10 }}>want a script?</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={acceptPhoneTask} style={btnPrimary}>yes</button>
              <button type="button" onClick={() => setPhoneTask(null)} style={btnGhost}>skip</button>
            </div>
          </div>
        )}

        {/* ── phone-task cluster ─────────────────────────────────────────── */}
        {phoneTasks.length > 0 && (
          <section style={{ marginBottom: 32, padding: '20px 22px', background: PAPER, border: `1px solid ${HAIRLINE}`, borderRadius: 2 }}>
            <div style={{ ...LABEL, paddingBottom: 14, fontSize: 9 }}>
              calls to make <span style={{ color: FAINT, marginLeft: 6 }}>{phoneTasks.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {phoneTasks.map((it, i) => (
                <div
                  key={it.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 16,
                    padding: '12px 0',
                    borderTop: i === 0 ? 'none' : `1px solid ${HAIRLINE}`,
                  }}
                >
                  <div style={{
                    fontFamily: "'Inter Tight',sans-serif",
                    fontSize: 15,
                    fontWeight: 600,
                    color: INK,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.3,
                  }}>
                    {it.title ?? it.label}
                  </div>
                  <button
                    type="button"
                    onClick={() => markDone(it.id)}
                    style={{
                      minHeight: 44,
                      padding: '8px 12px',
                      background: 'transparent',
                      border: `1px solid ${HAIRLINE_HI}`,
                      color: MUTED,
                      fontFamily: "'DM Mono',monospace",
                      fontSize: 9,
                      letterSpacing: '0.2em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      borderRadius: 2,
                      flexShrink: 0,
                    }}
                  >
                    called
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── add form ──────────────────────────────────────────────────── */}
        {addOpen && (
          <div style={{ padding: 28, background: PAPER, border: `1px solid ${HAIRLINE}`, borderRadius: 2, marginBottom: 40 }}>
            <div style={{ ...LABEL, paddingBottom: 10 }}>what</div>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="e.g. renew passport"
              aria-label="task name"
              style={inputStyle}
            />

            <div style={{ ...LABEL, paddingBottom: 10 }}>type</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
              {([['task', 'task'], ['renewal', 'renewal']] as [string, string][]).map(([k, label]) => (
                <button type="button" key={k} onClick={() => setDraft({ ...draft, kind: k })} style={toggleBtn(draft.kind === k)}>{label}</button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
              <div>
                <div style={{ ...LABEL, paddingBottom: 10 }}>category</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {CATEGORIES.map(([k, label]) => (
                    <button type="button" key={k} onClick={() => setDraft({ ...draft, category: k })} style={toggleBtn(draft.category === k)}>{label}</button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ ...LABEL, paddingBottom: 10 }}>{draft.kind === 'renewal' ? 'expires' : 'when'}</div>
                <input
                  type="date"
                  value={draft.kind === 'renewal' ? draft.expiry_date : draft.due}
                  onChange={(e) => setDraft(draft.kind === 'renewal' ? { ...draft, expiry_date: e.target.value } : { ...draft, due: e.target.value })}
                  aria-label={draft.kind === 'renewal' ? 'expiry date' : 'due date'}
                  style={{ ...inputStyle, marginBottom: 0 }}
                />
              </div>
            </div>

            <div style={{ ...LABEL, paddingBottom: 10 }}>whose court?</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
              {([['MINE', 'mine'], ['THEIRS', 'theirs'], ['WAITING', 'waiting']] as [string, string][]).map(([k, label]) => (
                <button type="button" key={k} onClick={() => setDraft({ ...draft, ball_state: k })} style={toggleBtn(draft.ball_state === k)}>{label}</button>
              ))}
            </div>

            {draft.ball_state === 'WAITING' && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ ...LABEL, paddingBottom: 10 }}>expected by</div>
                <input type="date" value={draft.eta_date} onChange={(e) => setDraft({ ...draft, eta_date: e.target.value })} aria-label="eta date" style={{ ...inputStyle, maxWidth: 240, marginBottom: 0 }} />
              </div>
            )}

            <div style={{ ...LABEL, paddingBottom: 10 }}>minutes · optional</div>
            <input
              type="number"
              min="0"
              step="0.5"
              value={draft.duration_min}
              onChange={(e) => setDraft({ ...draft, duration_min: e.target.value })}
              placeholder="e.g. 2"
              aria-label="estimated duration in minutes"
              style={{ ...inputStyle, maxWidth: 240 }}
            />

            <div style={{ ...LABEL, paddingBottom: 10 }}>recurs</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
              {RECURS.map(([k, label]) => (
                <button type="button" key={k} onClick={() => setDraft({ ...draft, recur: k })} style={toggleBtn(draft.recur === k)}>{label}</button>
              ))}
            </div>

            <div style={{ ...LABEL, paddingBottom: 10 }}>note · optional</div>
            <input
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              placeholder="e.g. expires july, takes 6 weeks"
              aria-label="optional note"
              style={{ ...inputStyle, fontStyle: 'italic' }}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={save} disabled={!draft.title.trim()} style={{
                padding: '12px 22px',
                background: draft.title.trim() ? INK : 'transparent',
                color: draft.title.trim() ? BG : FAINT,
                border: `1px solid ${draft.title.trim() ? INK : HAIRLINE_HI}`,
                fontFamily: "'DM Mono',monospace",
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: draft.title.trim() ? 'pointer' : 'default',
                borderRadius: 2,
                transition: 'all 240ms',
              }}>save</button>
              <button type="button" onClick={() => { setAddOpen(false); setDraft({ ...EMPTY_DRAFT }); }} style={{ padding: '12px 18px', background: 'transparent', color: MUTED, border: 'none', fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', cursor: 'pointer' }}>cancel</button>
            </div>
          </div>
        )}

        {/* ── filter tabs ───────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 18, paddingBottom: 28, borderBottom: `1px solid ${HAIRLINE}`, marginBottom: 32 }}>
          {([
            ['active', activeCount],
            ['done', doneCount],
            ['all', (items ?? []).length],
          ] as [string, number][]).map(([k, n]) => {
            const on = filter === k;
            return (
              <button type="button" key={k} onClick={() => setFilter(k as 'active' | 'done' | 'all')} style={{
                background: 'none',
                border: 'none',
                padding: '6px 0',
                fontFamily: "'DM Mono',monospace",
                fontSize: 11,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                color: on ? INK : FAINT,
                borderBottom: `1px solid ${on ? ACCENT : 'transparent'}`,
                transition: 'all 240ms',
              }}>{k} <span style={{ color: on ? MUTED : FAINT, marginLeft: 6 }}>{n}</span></button>
            );
          })}
        </div>

        {/* ── empty state ───────────────────────────────────────────────── */}
        {withDaysLeft.length === 0 && (
          <div style={{
            padding: '48px 0',
            fontFamily: "'DM Serif Display',serif",
            fontStyle: 'italic',
            fontSize: 'clamp(20px, 2.2vw, 26px)',
            color: MUTED,
            lineHeight: 1.4,
            maxWidth: 520,
          }}>
            {filter === 'active' && (
              (items ?? []).length === 0
                ? "throw a task in — even just 'call mom'."
                : "nothing on the list. either you're on top of it or you'll find out the hard way. tap + new."
            )}
            {filter === 'done' && 'nothing marked done.'}
            {filter === 'all' && "throw a task in — even just 'call mom'."}
          </div>
        )}

        {/* ── task list ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {withDaysLeft.map((it) => {
            const itState = it.state ?? (it.status === 'done' ? 'closed' : 'active');
            const isClosed = itState === 'closed';
            const isDone = itState === 'done';
            const overdue = it._daysLeft != null && it._daysLeft < 0 && !isClosed;
            const soon = it._daysLeft != null && it._daysLeft >= 0 && it._daysLeft <= 14 && !isClosed;
            const ballState = it.ball_state ?? 'MINE';
            const ballChip = ballState === 'THEIRS' ? { text: 'THRS', color: MUTED }
              : ballState === 'WAITING' ? { text: 'WAIT', color: FAINT }
              : { text: 'MINE', color: INK };
            const stale = staleBalls[it.id];
            const last5 = last5Pcts[it.id];
            const pwTask = paperworkTasks[it.id];
            const deferChain = deferChains[it.id];
            const isTwoMin = typeof it.duration_min === 'number' && it.duration_min <= 2 && !isClosed && !isDone;
            const recurLabel = RECURS.find((r) => r[0] === it.recur)?.[1] ?? it.recur;

            return (
              <div key={it.id} style={{
                padding: '22px 0',
                borderBottom: `1px solid ${HAIRLINE}`,
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: '10px 20px',
                alignItems: 'baseline',
                opacity: isClosed ? 0.5 : 1,
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{
                      fontFamily: "'Inter Tight',sans-serif",
                      fontSize: 'clamp(17px, 1.8vw, 20px)',
                      fontWeight: 600,
                      color: INK,
                      letterSpacing: '-0.01em',
                      lineHeight: 1.3,
                      textDecoration: isClosed ? 'line-through' : 'none',
                      textDecorationColor: MUTED,
                      textDecorationThickness: '1px',
                    }}>{it.title ?? it.label}</div>
                    <span style={chip(ballChip.color)}>{ballChip.text}</span>
                    {it.kind === 'renewal' && <span style={chip(MUTED)}>RENEW</span>}
                    {isDone && <span style={chip(INK)}>DONE</span>}
                  </div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: '0.22em', color: FAINT, textTransform: 'uppercase', paddingTop: 8 }}>
                    <span>{it.category}</span>
                    {it.recur && it.recur !== 'none' && <span> · recurs {recurLabel}</span>}
                  </div>
                  {it.note && (
                    <div style={{ fontFamily: "'Inter Tight',sans-serif", fontStyle: 'italic', fontSize: 14, color: MUTED, paddingTop: 8, lineHeight: 1.5 }}>{it.note}</div>
                  )}
                  {/* per-row pattern chips */}
                  {(stale || last5 || pwTask || deferChain || (typeof it.defer_count === 'number' && it.defer_count > 0)) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 10 }}>
                      {stale && <span style={chipHi}>{stale.copy}</span>}
                      {last5 && <span style={chipHi}>{last5.copy}</span>}
                      {pwTask && !isClosed && (
                        <>
                          <button type="button" onClick={() => acceptPaperworkTask(it.id)} style={chipBtn}>paperwork — split GATHER + FILL?</button>
                          <button type="button" onClick={() => dismissPaperworkTask(it.id)} aria-label="dismiss paperwork" style={{ minHeight: 44, padding: '6px 10px', background: 'transparent', fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: '0.18em', color: FAINT, textTransform: 'uppercase', border: 'none', cursor: 'pointer' }}>×</button>
                        </>
                      )}
                      {!deferChain && typeof it.defer_count === 'number' && it.defer_count > 0 && (
                        <span style={chip(MUTED)}>deferred {it.defer_count}×</span>
                      )}
                      {deferChain && !isClosed && (
                        <button type="button" onClick={() => expandDeferChain(it.id)} style={chipBtn}>deferred {deferChain.defer_count}× — phone? form? confrontation?</button>
                      )}
                    </div>
                  )}
                  {deferChain?.expanded && !isClosed && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 8 }}>
                      {(['phone', 'form', 'confrontation'] as const).map((k) => (
                        <button type="button" key={k} onClick={() => deferRoot(it.id, k)} style={btnGhost}>{k}</button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ textAlign: 'right' }}>
                  {it.due ? (
                    <>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: '0.22em', color: overdue || soon ? ACCENT : MUTED, textTransform: 'uppercase', fontWeight: 500 }}>{fmtDate(it.due)}</div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: '0.2em', color: overdue ? ACCENT : FAINT, textTransform: 'uppercase', paddingTop: 4, fontWeight: 500 }}>{relDays(it._daysLeft)}</div>
                    </>
                  ) : (
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: '0.2em', color: FAINT, textTransform: 'uppercase' }}>no date</div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {isTwoMin && (
                    <button type="button" onClick={() => doNow(it.id)} style={{ minHeight: 44, padding: '10px 14px', background: 'transparent', border: `1px solid ${ACCENT}`, color: ACCENT, fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer', borderRadius: 2 }}>do now</button>
                  )}
                  {!isDone && !isClosed && (
                    <button type="button" onClick={() => markDone(it.id)} style={{ minHeight: 44, padding: '10px 14px', background: 'transparent', border: `1px solid ${HAIRLINE_HI}`, color: MUTED, fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer', borderRadius: 2 }}>
                      {it.recur && it.recur !== 'none' ? 'mark done · roll' : 'mark done'}
                    </button>
                  )}
                  {isDone && !isClosed && (
                    <button type="button" onClick={() => closeLoop(it.id)} style={{ minHeight: 44, padding: '10px 14px', background: INK, border: `1px solid ${INK}`, color: BG, fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer', borderRadius: 2 }}>close loop</button>
                  )}
                  {!isDone && !isClosed && (
                    <button type="button" onClick={() => deferTask(it.id)} style={{ minHeight: 44, padding: '10px 14px', background: 'transparent', border: `1px solid ${HAIRLINE}`, color: FAINT, fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer', borderRadius: 2 }}>defer</button>
                  )}
                  <button type="button" onClick={() => del(it.id)} aria-label={`delete ${it.title ?? it.label ?? 'item'}`} style={{ minHeight: 44, padding: '10px 12px', background: 'transparent', color: FAINT, border: 'none', fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' }}>×</button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── AdminReflected (Sprint 5 · F5 · cross-module forwards) ────── */}
        <AdminReflected />

        {/* ── AdminNoticed (orchestrator-computed patterns) ──────────────── */}
        <AdminNoticed />

        <div style={{ marginTop: 72, paddingTop: 28, borderTop: `1px solid ${HAIRLINE}`, fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: '0.36em', color: FAINT, textTransform: 'uppercase', textAlign: 'center' }}>
          ollie <span style={{ color: MUTED, margin: '0 10px' }}>·</span> admin <span style={{ color: MUTED, margin: '0 10px' }}>·</span> mmxxvi
        </div>
      </div>

      {/* ── A5 firehose modal ──────────────────────────────────────────── */}
      {firehose && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 100 }} role="dialog" aria-modal="true" aria-label="firehose dump">
          <div style={{ background: PAPER, color: INK, padding: 32, maxWidth: 520, width: '100%', maxHeight: '85vh', overflowY: 'auto', border: `1px solid ${HAIRLINE}`, borderRadius: 2 }}>
            <div style={{ ...LABEL, paddingBottom: 10 }}>firehose dump</div>
            <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 24, color: INK, letterSpacing: '-0.01em', lineHeight: 1.2, paddingBottom: 12 }}>firehose dump.</div>
            <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, color: MUTED, lineHeight: 1.5, paddingBottom: 20 }}>{firehose.candidates.length} candidate admin items detected. select to add:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 24 }}>
              {firehose.candidates.map((c, i) => (
                <button type="button" key={`fh-${i}`} onClick={() => toggleFirehose(i)} style={{ minHeight: 44, padding: '10px 12px', background: c.checked ? BG : 'transparent', color: INK, textAlign: 'left', border: `1px solid ${c.checked ? HAIRLINE_HI : HAIRLINE}`, borderRadius: 2, cursor: 'pointer', fontFamily: "'Inter Tight',sans-serif", fontSize: 15, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 14, height: 14, border: `1px solid ${HAIRLINE_HI}`, background: c.checked ? INK : 'transparent', flexShrink: 0, borderRadius: 2, display: 'inline-block' }} />
                  <span>{c.token}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={addFirehoseSelected} disabled={firehose.candidates.every((c) => !c.checked)} style={{
                minHeight: 44, padding: '12px 22px',
                background: firehose.candidates.some((c) => c.checked) ? INK : 'transparent',
                color: firehose.candidates.some((c) => c.checked) ? BG : FAINT,
                border: `1px solid ${firehose.candidates.some((c) => c.checked) ? INK : HAIRLINE_HI}`,
                fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase',
                cursor: firehose.candidates.some((c) => c.checked) ? 'pointer' : 'default', borderRadius: 2,
              }}>
                add {firehose.candidates.filter((c) => c.checked).length} item{firehose.candidates.filter((c) => c.checked).length === 1 ? '' : 's'}
              </button>
              <button type="button" onClick={() => setFirehose(null)} style={{ minHeight: 44, padding: '12px 18px', background: 'transparent', color: FAINT, border: 'none', fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', cursor: 'pointer' }}>cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── A8 burst session modal ─────────────────────────────────────── */}
      {burstOpen && burstIds.length > 0 && (() => {
        const cur = (items ?? []).find((x) => x?.id === burstIds[burstIdx]);
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 100 }} role="dialog" aria-modal="true" aria-label="burst session">
            <div style={{ background: PAPER, color: INK, padding: 32, maxWidth: 520, width: '100%', border: `1px solid ${HAIRLINE}`, borderRadius: 2 }}>
              {!cur ? (
                <>
                  <div style={{ ...LABEL, paddingBottom: 16 }}>burst</div>
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 15, color: MUTED, paddingBottom: 20 }}>task missing — moving on.</div>
                  <button type="button" onClick={burstAdvance} style={btnPrimary}>next</button>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 16 }}>
                    <div style={LABEL}>burst · {burstIdx + 1} of {burstIds.length}</div>
                    <button type="button" onClick={burstClose} style={{ background: 'transparent', border: 'none', color: FAINT, fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer', minHeight: 44, padding: '8px 12px' }}>close</button>
                  </div>
                  <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: 24, color: INK, letterSpacing: '-0.01em', lineHeight: 1.2, paddingBottom: 12 }}>{cur.title ?? cur.label}</div>
                  <div style={{ fontFamily: "'Inter Tight',sans-serif", fontSize: 14, color: MUTED, lineHeight: 1.5, paddingBottom: 24 }}>
                    {typeof cur.duration_min === 'number' ? `${cur.duration_min} min. ` : ''}do it now.
                  </div>
                  <button type="button" onClick={burstAdvance} style={btnPrimary}>done · next</button>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── shared micro style helpers ────────────────────────────────────────────────

function now(): number { return Date.now(); }

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  background: BG,
  border: `1px solid ${HAIRLINE}`,
  color: INK,
  borderRadius: 2,
  fontFamily: "'Inter Tight',sans-serif",
  fontSize: 17,
  outline: 'none',
  marginBottom: 18,
  boxSizing: 'border-box',
};

function toggleBtn(active: boolean): React.CSSProperties {
  return {
    minHeight: 44,
    padding: '10px 18px',
    background: active ? INK : 'transparent',
    color: active ? BG : MUTED,
    border: `1px solid ${active ? INK : HAIRLINE}`,
    fontFamily: "'DM Mono',monospace",
    fontSize: 10,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    borderRadius: 2,
  };
}

const btnPrimary: React.CSSProperties = {
  minHeight: 44,
  padding: '10px 18px',
  background: INK,
  color: BG,
  border: `1px solid ${INK}`,
  fontFamily: "'DM Mono',monospace",
  fontSize: 10,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  borderRadius: 2,
};

const btnGhost: React.CSSProperties = {
  minHeight: 44,
  padding: '10px 18px',
  background: 'transparent',
  color: MUTED,
  border: `1px solid ${HAIRLINE_HI}`,
  fontFamily: "'DM Mono',monospace",
  fontSize: 10,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  borderRadius: 2,
};

function chip(color: string): React.CSSProperties {
  return {
    fontFamily: "'DM Mono',monospace",
    fontSize: 9,
    letterSpacing: '0.18em',
    color,
    textTransform: 'uppercase',
    padding: '2px 6px',
    border: `1px solid ${HAIRLINE}`,
    borderRadius: 4,
  };
}

const chipHi: React.CSSProperties = {
  fontFamily: "'DM Mono',monospace",
  fontSize: 9,
  letterSpacing: '0.18em',
  color: INK,
  textTransform: 'uppercase',
  padding: '4px 8px',
  border: `1px solid ${HAIRLINE_HI}`,
  borderRadius: 4,
};

const chipBtn: React.CSSProperties = {
  minHeight: 44,
  padding: '6px 10px',
  background: 'transparent',
  fontFamily: "'DM Mono',monospace",
  fontSize: 9,
  letterSpacing: '0.18em',
  color: INK,
  textTransform: 'uppercase',
  border: `1px solid ${HAIRLINE_HI}`,
  borderRadius: 4,
  cursor: 'pointer',
};
