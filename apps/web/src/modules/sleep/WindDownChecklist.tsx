/**
 * WindDownChecklist — sequential 6-item bedtime ritual.
 *
 * Audit reference: audits/AUDIT_body_v2.md · hypothesis #6
 *   "Wind-down checklist (sequential ritual steps) likely NOT STARTED" — CONFIRMED.
 *
 * UX:
 *   - Opens only inside the 60-minute window before the user's target bedtime
 *     (default 23:00 if unset). Outside the window the component renders null.
 *   - Items are tap-to-complete sequentially; only the next item is interactive,
 *     past items are checked, future items are dimmed and ignore clicks.
 *   - Soft cross-fade on completion (CSS only — Framer Motion is not a dep here).
 *   - When all items are complete the card collapses to a single quiet line.
 *   - In-progress state is persisted per-night in the sleep store (date-keyed),
 *     so reload restores the user's place. At local-midnight the date key
 *     changes, so a new night starts fresh.
 *
 * Supplement gating:
 *   - If body.supplements is empty → the supplement step is skipped (5 items).
 *   - If body.supplements has entries → the step is shown (6 items).
 *
 * Privacy:
 *   - If the user has opted out of the sleep module (shared.consent.modules.sleep === false),
 *     this component renders null. Opt-in is the default.
 *
 * Events:
 *   - sleep:wind_down_completed when the final item is checked
 *   - sleep:wind_down_skipped   when the user dismisses the card mid-flow
 *
 * Pattern feed (sleep:wind_down_step):
 *   - Each item tap emits one `sleep:wind_down_step` event
 *     { ts, step_id, step_label, action: 'checked' }. The sleep orchestrator
 *     subscribes and appends a WindDownLogEntry to the sleep.windDownLog
 *     slice (single-writer: idempotency + cap live there, not here).
 *     detectWindDownFriction reads that slice and measures the first→last
 *     checked gap per night to surface a "stuck step". Without this emit the
 *     friction detector has no input and the pattern never fires.
 *
 * Style:
 *   - Sleep module palette (bone / ink / sage accent). Courier New.
 *   - Faint cream → sky gradient on the card surface. No frosted glass,
 *     no neon, no playful bounce — editorial restraint per design DNA.
 *
 * i18n: strings.en/es.json body.wind_down.*
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useStoreSlice } from '../../store';
import * as events from '@ollie/events';
import { getString, type Locale } from '../../i18n';

// ─── palette (mirrors SleepModule C tokens) ──────────────────────────────────

const C = {
  bone:      '#F2EEE4',
  ink:       '#14130F',
  inkSoft:   '#4B4740',
  inkFaint:  '#7C7770',
  inkGhost:  '#C8C4BA',
  rule:      'rgba(20,19,15,0.10)',
  ruleSoft:  'rgba(20,19,15,0.06)',
  accent:    '#4F6E5B',     // sage
  sky:       '#D6DEE6',     // soft sky — gradient hint
  cream:     '#EDE6D6',     // warmer cream tint
} as const;

const COURIER = "'Courier New', Courier, monospace";

// ─── window helpers ──────────────────────────────────────────────────────────

const DEFAULT_TARGET_BEDTIME = '23:00';
const WINDOW_MINUTES = 60;

/** Parse "HH:MM" → minutes-past-midnight, or null on malformed. */
export function parseHHMM(s: string | null | undefined): number | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Local date key (YYYY-MM-DD). Day boundary is local midnight. */
export function dayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Should the checklist be visible right now?
 * Visible when current local time is within [bedtime - 60min, bedtime + 8h]
 * — the "+8h" cushion lets a late-bedtime user (e.g. 02:00) still see it.
 * The window wraps midnight: if bedtime is 23:00 we open at 22:00, and a
 * 00:30 check stays inside the window via wrap-around math.
 */
export function isWithinWindow(
  nowMin: number,
  bedtimeMin: number,
  windowMin: number = WINDOW_MINUTES,
): boolean {
  const startMin = (bedtimeMin - windowMin + 24 * 60) % (24 * 60);
  const endMin   = (bedtimeMin + 8 * 60) % (24 * 60);
  if (startMin <= endMin) {
    return nowMin >= startMin && nowMin <= endMin;
  }
  // wrap across midnight
  return nowMin >= startMin || nowMin <= endMin;
}

// ─── item definition ─────────────────────────────────────────────────────────

export type WindDownItemId =
  | 'phone_away'
  | 'drink_water'
  | 'supplement'
  | 'lights_low'
  | 'breath_journal'
  | 'into_bed';

interface WindDownItem {
  id:    WindDownItemId;
  label: string;
  hint?: string;
}

function buildItems(locale: Locale): WindDownItem[] {
  return [
    { id: 'phone_away',     label: getString(locale, 'body.wind_down.phone_away') },
    { id: 'drink_water',    label: getString(locale, 'body.wind_down.drink_water') },
    { id: 'supplement',     label: getString(locale, 'body.wind_down.supplement') },
    { id: 'lights_low',     label: getString(locale, 'body.wind_down.lights_low') },
    { id: 'breath_journal', label: getString(locale, 'body.wind_down.breath_journal'), hint: getString(locale, 'body.wind_down.breath_journal_hint') },
    { id: 'into_bed',       label: getString(locale, 'body.wind_down.into_bed') },
  ];
}

/** Returns the ordered list of items active tonight (supplement may be skipped). */
export function itemsForTonight(hasSupplements: boolean, locale: Locale = 'en'): WindDownItem[] {
  const items = buildItems(locale);
  if (hasSupplements) return items;
  return items.filter((i) => i.id !== 'supplement');
}

// ─── persisted state ─────────────────────────────────────────────────────────

interface WindDownState {
  /** Date key (YYYY-MM-DD) the in-progress run belongs to. Day-boundary reset key. */
  date: string;
  /** Item ids checked in order — used as the "cursor". */
  completed: WindDownItemId[];
  /** ms timestamp of the first tap (used to compute durationMs on completion). */
  startedAt: number | null;
  /** Set to true after sleep:wind_down_completed has fired for this night. */
  finished: boolean;
  /** Set to true after the user dismisses the card. */
  dismissed: boolean;
}

const EMPTY_STATE: WindDownState = {
  date:      '',
  completed: [],
  startedAt: null,
  finished:  false,
  dismissed: false,
};

// ─── Supplement shape ────────────────────────────────────────────────────────
// Mirrors apps/web/src/modules/body/BodyModule.tsx Supplement.

interface BodySupplement {
  id:        string;
  name:      string;
  dose:      string | null;
  added_at:  number;
}

// ─── consent shape (forward-compatible) ─────────────────────────────────────
// shared.consent.modules is a forward-looking shape — when per-module opt-out
// ships, this gate honors it. Default = opted-in.

interface ModuleConsent {
  sleep?: boolean;
}

// ─── component ───────────────────────────────────────────────────────────────

interface WindDownChecklistProps {
  /** Optional clock injection for tests. */
  nowFn?: () => Date;
}

export function WindDownChecklist({ nowFn }: WindDownChecklistProps): React.ReactElement | null {
  const getNow = useCallback(() => (nowFn ? nowFn() : new Date()), [nowFn]);

  // ── settings: target_bedtime lives on sleep.settings ────────────────────
  const [settings] = useStoreSlice<{ target_bedtime?: string | null } | null>(
    'sleep',
    'settings',
    null,
  );

  // ── locale ───────────────────────────────────────────────────────────────
  const [sharedSettings] = useStoreSlice<{ locale?: string }>('shared', 'settings', {});
  const localeRaw = sharedSettings?.locale ?? 'en';
  const locale: Locale = localeRaw === 'es' ? 'es' : 'en';

  // ── supplements ─────────────────────────────────────────────────────────
  const [supps] = useStoreSlice<BodySupplement[]>('body', 'supplements', []);
  const hasSupplements = Array.isArray(supps) && supps.length > 0;

  // ── consent (forward-compatible) ────────────────────────────────────────
  const [moduleConsent] = useStoreSlice<ModuleConsent>('shared', 'consent.modules', {});
  const optedOut = moduleConsent && moduleConsent.sleep === false;

  // ── persisted run state ─────────────────────────────────────────────────
  const [persisted, setPersisted] = useStoreSlice<WindDownState>(
    'sleep',
    'wind_down_state',
    EMPTY_STATE,
  );

  // ── tick: re-evaluate visibility every 60s so the window opens on time
  // without requiring user interaction.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  // referenced so eslint/ts doesn't warn — tick is read in the closure of memos
  void tick;

  // ── derived: today's items + cursor ─────────────────────────────────────
  const items = useMemo(() => itemsForTonight(hasSupplements, locale), [hasSupplements, locale]);

  const todayKey = useMemo(() => dayKey(getNow()), [getNow, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Snap persisted state to today (day-boundary reset).
  const state: WindDownState = useMemo(() => {
    if (!persisted || persisted.date !== todayKey) {
      return { ...EMPTY_STATE, date: todayKey };
    }
    return persisted;
  }, [persisted, todayKey]);

  // If a stale state exists (different date), clear it once.
  useEffect(() => {
    if (persisted && persisted.date && persisted.date !== todayKey) {
      setPersisted({ ...EMPTY_STATE, date: todayKey });
    }
  }, [persisted, todayKey, setPersisted]);

  // ── window gate ─────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    const now = getNow();
    const bedtimeMin =
      parseHHMM(settings?.target_bedtime ?? null) ??
      parseHHMM(DEFAULT_TARGET_BEDTIME) ??
      23 * 60;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return isWithinWindow(nowMin, bedtimeMin);
  }, [settings, getNow, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── early returns ────────────────────────────────────────────────────────
  if (optedOut) return null;
  if (!visible) return null;
  if (state.dismissed) return null;

  // ── cursor: index of the next tappable item ──────────────────────────────
  const cursor = state.completed.length;
  const allDone = cursor >= items.length;

  // ── handlers ─────────────────────────────────────────────────────────────
  const handleTap = (item: WindDownItem, index: number): void => {
    if (state.finished || allDone) return;
    if (index !== cursor) return; // only the next item is tappable

    const wasFirst = state.completed.length === 0;
    const tappedAt = Date.now();
    const startedAt = state.startedAt ?? tappedAt;

    if (wasFirst) {
      try {
        events.emit('sleep:wind_down_started', { ts: startedAt });
      } catch {
        // emit failures are non-fatal in the UI layer
      }
    }

    // Emit the per-step row the friction detector feeds on. The sleep
    // orchestrator subscribes to sleep:wind_down_step and appends it to
    // sleep.windDownLog (single-writer — idempotency + cap live there).
    // detectWindDownFriction groups rows by night via this ts.
    try {
      events.emit('sleep:wind_down_step', {
        ts:         tappedAt,
        step_id:    item.id,
        step_label: item.label,
        action:     'checked',
      });
    } catch {
      // emit failures are non-fatal in the UI layer
    }

    const nextCompleted: WindDownItemId[] = [...state.completed, item.id];
    const finished = nextCompleted.length === items.length;

    setPersisted({
      date:      todayKey,
      completed: nextCompleted,
      startedAt,
      finished,
      dismissed: false,
    });

    if (finished) {
      const completedAt = Date.now();
      try {
        events.emit('sleep:wind_down_completed', {
          ts:              completedAt,
          durationMs:      completedAt - startedAt,
          itemsCompleted:  nextCompleted.length,
        });
      } catch {
        // non-fatal
      }
    }
  };

  const handleDismiss = (): void => {
    if (!state.finished) {
      try {
        events.emit('sleep:wind_down_skipped', {
          ts:               Date.now(),
          itemsCompleted:   state.completed.length,
        });
      } catch {
        // non-fatal
      }
    }
    setPersisted({ ...state, dismissed: true });
  };

  // ── render: collapsed "rest well." after completion ──────────────────────
  if (state.finished) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          background: `linear-gradient(180deg, ${C.cream} 0%, ${C.sky} 100%)`,
          border: `1px solid ${C.rule}`,
          padding: '32px 28px',
          textAlign: 'center',
          fontFamily: COURIER,
          color: C.inkSoft,
          letterSpacing: '0.04em',
          fontStyle: 'italic',
          fontSize: 15,
          fontWeight: 400,
        }}
      >
        {getString(locale, 'body.wind_down.done')}
      </div>
    );
  }

  // ── render: active checklist ─────────────────────────────────────────────
  return (
    <section
      aria-label={getString(locale, 'body.wind_down.aria_section')}
      style={{
        background: `linear-gradient(180deg, ${C.cream} 0%, ${C.sky} 100%)`,
        border: `1px solid ${C.rule}`,
        padding: '24px 28px',
        fontFamily: COURIER,
        color: C.ink,
      }}
    >
      {/* header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: 14,
          borderBottom: `1px solid ${C.rule}`,
          marginBottom: 20,
        }}
      >
        <span
          style={{
            fontSize: 11,
            letterSpacing: '0.20em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: C.inkSoft,
          }}
        >
          {getString(locale, 'body.wind_down.subtitle').replace('${0}', String(items.length))}
        </span>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={getString(locale, 'body.wind_down.aria_dismiss')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: COURIER,
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'lowercase',
            color: C.inkFaint,
            fontWeight: 700,
            padding: '4px 0',
          }}
        >
          {getString(locale, 'body.wind_down.dismiss')}
        </button>
      </div>

      {/* items */}
      <ol
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
      >
        {items.map((item, index) => {
          const isDone   = index < cursor;
          const isNext   = index === cursor;
          const isFuture = index > cursor;
          return (
            <li
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '16px 0',
                borderBottom:
                  index === items.length - 1
                    ? 'none'
                    : `1px solid ${C.ruleSoft}`,
                opacity: isFuture ? 0.42 : 1,
                transition: 'opacity 220ms ease-out',
              }}
            >
              <button
                type="button"
                onClick={() => handleTap(item, index)}
                disabled={!isNext}
                aria-label={
                  isDone
                    ? getString(locale, 'body.wind_down.aria_done').replace('${0}', item.label)
                    : isNext
                    ? getString(locale, 'body.wind_down.aria_mark_done').replace('${0}', item.label)
                    : getString(locale, 'body.wind_down.aria_locked').replace('${0}', item.label)
                }
                aria-pressed={isDone}
                aria-disabled={!isNext}
                style={{
                  width: 22,
                  height: 22,
                  flexShrink: 0,
                  borderRadius: '50%',
                  border: isDone
                    ? `1.5px solid ${C.accent}`
                    : isNext
                    ? `1.5px solid ${C.ink}`
                    : `1.5px solid ${C.rule}`,
                  background: isDone ? C.accent : 'transparent',
                  cursor: isNext ? 'pointer' : 'default',
                  padding: 0,
                  position: 'relative',
                  transition:
                    'background 240ms ease-out, border-color 240ms ease-out',
                }}
              >
                {isDone && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: C.bone,
                      fontSize: 12,
                      fontWeight: 700,
                      lineHeight: 1,
                      // simple hairline tick — no playful glyphs
                    }}
                  >
                    ·
                  </span>
                )}
              </button>

              <div
                style={{
                  flex: 1,
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  color: isDone ? C.inkFaint : C.ink,
                  textDecoration: isDone ? `line-through ${C.inkGhost}` : 'none',
                  transition: 'color 240ms ease-out',
                }}
              >
                {item.label}
                {item.hint && (
                  <span
                    style={{
                      marginLeft: 10,
                      fontStyle: 'italic',
                      fontWeight: 400,
                      color: C.inkFaint,
                      fontSize: 12,
                    }}
                  >
                    {item.hint}
                  </span>
                )}
              </div>

              <span
                aria-hidden="true"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  color: C.inkGhost,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 18,
                  textAlign: 'right',
                }}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
