/**
 * CycleModule — ceramic visual language, scoped.
 * Breaks from sage/sky/frosted-glass. Entering cycle should feel like a
 * different, quieter app. Visual spec: CLAUDE.md §cycle.
 *
 * Wire: reads from store 'cycle' slices. Logic calls are useMemo-only
 * (never inside render). Store writes go through store.set.
 */

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  detectBoundaries,
  detectHealthFlags,
  detectAdherenceIssue,
  deriveCycleStats,
  computePhaseForDate,
  predictNextPeriod,
  predictOvulation,
  fertileWindow,
  findCorrelations,
} from '@ollie/logic/cycle';
import type { CycleItem, Phase } from '@ollie/logic/cycle';
import { useStoreSlice } from '../../store';
import { SourcesLink } from '../../components/SourcesLink';
import { getString, getPlural, type InterpolationVars, type Locale } from '../../i18n';

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Active UI locale for this module's `t`/`tn` helpers.
 *
 * `t` and `tn` are module-level (not hooks) because they are called from
 * ~10 sibling render functions, not just the component — threading a
 * `t` prop through all of them would be a large, churny refactor. Instead
 * the `CycleModule` component syncs this variable from
 * `shared.settings.locale` at the top of its render body (see
 * `syncCycleLocale`). Because every `t()` call happens during render of a
 * descendant — which runs strictly after the parent's body — the value is
 * always current. `useStoreSlice('shared','settings')` drives the
 * re-render when the user switches language.
 *
 * Audit-fix #5: previously hardcoded to `'en'`, so Spanish users saw the
 * cycle module in English regardless of their setting.
 */
let activeLocale: Locale = 'en';

function syncCycleLocale(raw: string | undefined): void {
  activeLocale = raw === 'es' ? 'es' : raw === 'en-literal' ? 'en-literal' : 'en';
}

function t(key: string, ...args: (string | number)[]): string {
  // `${i}` tokens map to interpolation vars '0', '1', … — getString's
  // interpolation replaces EVERY occurrence (the old `.replace` here only
  // hit the first).
  const vars: InterpolationVars = {};
  args.forEach((a, i) => { vars[String(i)] = a; });
  return getString(activeLocale, key, args.length ? vars : undefined);
}

/**
 * Plural-aware variant of `t`. Pass the BASE key (no `_one`/`_many`
 * suffix); i18next picks the CLDR-correct form for the count. `count`
 * fills the `${0}` token automatically.
 */
function tn(baseKey: string, count: number): string {
  return getPlural(activeLocale, baseKey, count);
}

const CERAMIC_TAGS = [
  'cramps', 'bloating', 'fatigue', 'headache', 'mood shift',
  'bleeding day 1', 'bleeding', 'spotting', 'clear', 'energy',
] as const;
type CeramicTag = typeof CERAMIC_TAGS[number];

const CERAMIC_TAG_KEYS: Record<CeramicTag, string> = {
  'cramps': 'cycle.record.tag.cramps',
  'bloating': 'cycle.record.tag.bloating',
  'fatigue': 'cycle.record.tag.fatigue',
  'headache': 'cycle.record.tag.headache',
  'mood shift': 'cycle.record.tag.mood_shift',
  'bleeding day 1': 'cycle.record.tag.bleeding_day_1',
  'bleeding': 'cycle.record.tag.bleeding',
  'spotting': 'cycle.record.tag.spotting',
  'clear': 'cycle.record.tag.clear',
  'energy': 'cycle.record.tag.energy',
};

function cyclePhaseLabel(name: Phase | string): string {
  const map: Record<string, string> = {
    'menstrual': 'cycle.phase.menstrual',
    'follicular': 'cycle.phase.follicular',
    'ovulation window': 'cycle.phase.ovulation_window',
    'luteal': 'cycle.phase.luteal',
    'late-luteal or overdue': 'cycle.phase.late_luteal',
    'unknown': 'cycle.phase.unknown',
  };
  const k = map[name];
  return k ? t(k) : name;
}

function fmtDay(d: Date): string {
  return d.getDate().toString().padStart(2, '0');
}
function fmtMonth(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long' }).toLowerCase();
}
function fmtFullDate(d: Date): string {
  return `${fmtDay(d)} ${fmtMonth(d)} ${d.getFullYear()}`;
}
function fmtOvulationDate(ts: number): string {
  const d = new Date(ts);
  return `${fmtMonth(d)} ${d.getDate()}`;
}

function fmtRange(range: [Date, Date] | null): string {
  if (!range) return '';
  const [a, b] = range;
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${fmtDay(a)} — ${fmtDay(b)} ${fmtMonth(b)}`;
  }
  return `${fmtDay(a)} ${fmtMonth(a)} — ${fmtDay(b)} ${fmtMonth(b)}`;
}

type AlgorithmTier = 'cold' | 'variable' | 'shifting' | 'personalized' | 'warming' | 'warm' | 'hot';

function confidenceTierCopy(tier: AlgorithmTier | string): string {
  const keyMap: Record<string, string> = {
    cold: 'cycle.confidence.cold',
    warming: 'cycle.confidence.warming',
    personalized: 'cycle.confidence.personalized',
    variable: 'cycle.confidence.variable',
    shifting: 'cycle.confidence.shifting',
    warm: 'cycle.confidence.warming',
    hot: 'cycle.confidence.personalized',
  };
  return t(keyMap[tier] ?? 'cycle.confidence.fallback');
}

// ─── CSS tokens (scoped to .cycle-module) ────────────────────────────────────
// All actual colors live in the .cycle-module inline style / className below.
// We reference CSS custom properties through inline styles so they are scoped.

const C = {
  base: 'var(--ceramic-base)',
  deep: 'var(--ceramic-deep)',
  bone: 'var(--ceramic-bone)',
  sand: 'var(--ceramic-sand)',
  ink: 'var(--ceramic-ink)',
  inkSoft: 'var(--ceramic-ink-soft)',
  inkFaint: 'var(--ceramic-ink-faint)',
  accent: 'var(--ceramic-accent)',
} as const;

// ─── MoonPhaseTile ────────────────────────────────────────────────────────────

interface MoonPhaseTileProps {
  cycleDay: number;
  cycleLength: number;
}

function MoonPhaseTile({ cycleDay, cycleLength }: MoonPhaseTileProps) {
  const N = Math.max(21, Math.min(40, Math.round(cycleLength)));
  const day = Math.max(1, cycleDay);
  const phase = ((day - 1) % N) / N;
  const r = 72, cx = 100, cy = 100;
  const maskCx = phase <= 0.5
    ? cx - phase * 4 * r
    : cx + (phase - 0.5) * 4 * r;
  return (
    <svg
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={{ display: 'block', margin: '0 auto 56px', width: 'min(320px, 78vw)', height: 'min(320px, 78vw)' }}
    >
      <rect x="0" y="0" width="200" height="200" fill={C.bone} />
      <circle cx={cx} cy={cy} r={r} fill={C.deep} />
      <circle cx={maskCx} cy={cy} r={r} fill={C.bone} />
    </svg>
  );
}

// ─── RecordPanel ──────────────────────────────────────────────────────────────

interface RecordPanelProps {
  onSave: (tags: string[], note: string) => void;
  onCancel: () => void;
}

function RecordPanel({ onSave, onCancel }: RecordPanelProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const toggle = (tag: string) => {
    setSelected(s => s.includes(tag) ? s.filter(x => x !== tag) : [...s, tag]);
  };

  const save = () => {
    if (selected.length === 0 && !note.trim()) { onCancel(); return; }
    onSave(selected, note);
    setSelected([]);
    setNote('');
  };

  return (
    <div style={{
      margin: '24px auto 0',
      width: '100%',
      maxWidth: 640,
      padding: 'clamp(20px, 5vw, 32px)',
      background: C.bone,
      boxSizing: 'border-box',
    }}>
      {/* tag row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        {CERAMIC_TAGS.map(tag => {
          const on = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(tag)}
              style={{
                background: on ? C.deep : 'transparent',
                border: `1px solid ${on ? C.deep : C.sand}`,
                color: on ? C.base : C.ink,
                padding: '10px 14px',
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'lowercase',
                cursor: 'pointer',
                minHeight: 44,
                borderRadius: 0,
              }}
            >
              {t(CERAMIC_TAG_KEYS[tag])}
            </button>
          );
        })}
      </div>

      {/* note */}
      <textarea
        rows={3}
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder={t('cycle.record.note_ph')}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: C.base,
          border: `1px solid ${C.sand}`,
          padding: '12px 14px',
          fontFamily: "'DM Mono', monospace",
          fontSize: 13,
          lineHeight: 1.5,
          color: C.ink,
          marginBottom: 16,
          resize: 'vertical',
          borderRadius: 0,
          outline: 'none',
        }}
      />

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          onClick={save}
          style={{
            background: C.ink,
            color: C.base,
            border: 'none',
            padding: '14px 28px',
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            minHeight: 44,
            borderRadius: 0,
          }}
        >
          {t('cycle.record.btn.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: `1px solid ${C.sand}`,
            color: C.ink,
            padding: '10px 14px',
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'lowercase',
            cursor: 'pointer',
            minHeight: 44,
            borderRadius: 0,
          }}
        >
          {t('cycle.record.btn.cancel')}
        </button>
      </div>
    </div>
  );
}

// ─── PillLogSection ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const PILL_BACKDATE_LIMIT_DAYS = 3;

/** Returns YYYY-MM-DD for a timestamp in local time. */
function toDateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Returns the start-of-day timestamp (local midnight) for a given date offset from now. */
function startOfDayOffset(now: number, offsetDays: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + offsetDays * DAY_MS;
}

interface PillLogSectionProps {
  items: CycleItem[];
  onLogPill: (ts: number) => void;
  now: number;
  birthControlType: 'combined' | 'progestin-only' | 'other';
  masked?: boolean;
}

function PillLogSection({ items, onLogPill, now, masked }: PillLogSectionProps) {
  const pillItems = useMemo(
    () => items.filter(i => i && i.action === 'pill'),
    [items],
  );

  const loggedDates = useMemo(
    () => new Set(pillItems.map(p => toDateKey(p.ts ?? 0))),
    [pillItems],
  );

  const todayKey = toDateKey(now);
  const todayLogged = loggedDates.has(todayKey);

  // 7-day strip: today at index 6, 6 days ago at index 0
  const stripDays = useMemo((): Array<{ key: string; ts: number; daysBack: number }> => {
    return Array.from({ length: 7 }, (_, i) => {
      const daysBack = 6 - i;
      const dayStart = startOfDayOffset(now, -daysBack);
      return { key: toDateKey(dayStart), ts: dayStart, daysBack };
    });
  }, [now]);

  const handleDayTap = (daysBack: number, dayStart: number, alreadyLogged: boolean) => {
    if (alreadyLogged) return;
    if (daysBack > PILL_BACKDATE_LIMIT_DAYS) return;
    onLogPill(dayStart + 12 * 60 * 60 * 1000);
  };

  if (masked) {
    return (
      <section style={{ marginBottom: 80 }} aria-label="birth control (hidden in privacy mode)">
        <SectionLabel>{t('cycle.pill.section_title')}</SectionLabel>
        <div style={{
          height: 48,
          background: C.bone,
          borderRadius: 2,
          filter: 'blur(6px)',
        }} />
      </section>
    );
  }

  return (
    <section style={{ marginBottom: 80 }} aria-label="birth control">
      <SectionLabel>{t('cycle.pill.section_title')}</SectionLabel>

      {/* today toggle */}
      <button
        type="button"
        aria-label={t('cycle.pill.aria_today_btn')}
        aria-pressed={todayLogged}
        onClick={() => {
          if (!todayLogged) onLogPill(now);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: 'transparent',
          border: 'none',
          padding: '0 0 32px 0',
          cursor: todayLogged ? 'default' : 'pointer',
          color: C.ink,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: todayLogged ? C.accent : 'transparent',
            border: `1.5px solid ${todayLogged ? C.accent : C.sand}`,
            flexShrink: 0,
            transition: 'background 0.15s, border-color 0.15s',
          }}
        />
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 12,
          letterSpacing: '0.14em',
          textTransform: 'lowercase',
          color: todayLogged ? C.inkSoft : C.ink,
        }}>
          {todayLogged ? t('cycle.pill.today_logged') : t('cycle.pill.today_unlogged')}
        </span>
      </button>

      {/* 7-day strip */}
      <div
        role="group"
        aria-label="pill log — past 7 days"
        style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}
      >
        {stripDays.map(({ key, ts, daysBack }) => {
          const logged = loggedDates.has(key);
          const isToday = daysBack === 0;
          const tooOld = daysBack > PILL_BACKDATE_LIMIT_DAYS;
          const interactive = !logged && !isToday && !tooOld;

          return (
            <button
              key={key}
              type="button"
              aria-label={logged
                ? t('cycle.pill.aria_dot_logged', key)
                : t('cycle.pill.aria_dot_unlogged', key)}
              aria-pressed={logged}
              disabled={tooOld && !logged}
              onClick={() => handleDayTap(daysBack, ts, logged)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px 2px',
                cursor: interactive ? 'pointer' : 'default',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                minWidth: 44,
                minHeight: 44,
                opacity: tooOld && !logged ? 0.35 : 1,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: isToday ? 12 : 10,
                  height: isToday ? 12 : 10,
                  borderRadius: '50%',
                  background: logged ? C.accent : 'transparent',
                  border: `1.5px solid ${logged ? C.accent : C.sand}`,
                  display: 'block',
                  transition: 'background 0.12s',
                }}
              />
            </button>
          );
        })}
      </div>

      {/* retroactive hint: show only if yesterday was missed and user has pill history */}
      {(() => {
        const yesterdayKey = toDateKey(startOfDayOffset(now, -1));
        const yesterdayMissed = !loggedDates.has(yesterdayKey) && pillItems.length > 0;
        if (!yesterdayMissed) return null;
        return (
          <p style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.12em',
            color: C.inkSoft,
            margin: '16px 0 0 0',
            textTransform: 'lowercase',
          }}>
            {t('cycle.pill.retroactive_prompt')}
          </p>
        );
      })()}
    </section>
  );
}

// ─── SettingsPanel ────────────────────────────────────────────────────────────

interface CycleSettings {
  tracking_for_fertility: boolean;
  show_dial: boolean;
  passphrase_hint: string;
  birth_control_enabled: boolean;
  birth_control_type: 'combined' | 'progestin-only' | 'other';
}

interface SettingsPanelProps {
  settings: CycleSettings;
  onChange: (s: CycleSettings) => void;
  onClose: () => void;
}

function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('cycle.settings.aria.close')}
      onClick={onClose}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(30,30,30,0.35)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.base,
          maxWidth: 440,
          width: '100%',
          boxSizing: 'border-box',
          padding: 32,
        }}
      >
        <div style={{ font: "500 22px/1 'Inter Tight', sans-serif", color: C.ink, margin: '0 0 4px 0' }}>
          {t('cycle.settings.title')}
        </div>
        <div style={{ font: "400 10px/1 'DM Mono', monospace", color: C.inkFaint, letterSpacing: '0.14em', textTransform: 'uppercase', margin: '0 0 24px 0' }}>
          {t('cycle.settings.sub')}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 0', borderBottom: `1px solid ${C.sand}` }}>
          <div>
            <div style={{ font: "400 15px/1.4 'Inter Tight', sans-serif", color: C.ink }}>{t('cycle.settings.fertility.label')}</div>
            <div style={{ font: "400 11px/1.4 'DM Mono', monospace", color: C.inkFaint, marginTop: 4, letterSpacing: '0.04em' }}>{t('cycle.settings.fertility.sub')}</div>
          </div>
          <input
            type="checkbox"
            checked={settings.tracking_for_fertility}
            onChange={e => onChange({ ...settings, tracking_for_fertility: e.target.checked })}
            style={{ width: 22, height: 22, cursor: 'pointer' }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 0', borderBottom: `1px solid ${C.sand}` }}>
          <div>
            <div style={{ font: "400 15px/1.4 'Inter Tight', sans-serif", color: C.ink }}>{t('cycle.settings.dial.label')}</div>
            <div style={{ font: "400 11px/1.4 'DM Mono', monospace", color: C.inkFaint, marginTop: 4, letterSpacing: '0.04em' }}>{t('cycle.settings.dial.sub')}</div>
          </div>
          <input
            type="checkbox"
            checked={settings.show_dial}
            onChange={e => onChange({ ...settings, show_dial: e.target.checked })}
            style={{ width: 22, height: 22, cursor: 'pointer' }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 0', borderBottom: `1px solid ${C.sand}` }}>
          <div>
            <div style={{ font: "400 15px/1.4 'Inter Tight', sans-serif", color: C.ink }}>{t('cycle.settings.birth_control.label')}</div>
            <div style={{ font: "400 11px/1.4 'DM Mono', monospace", color: C.inkFaint, marginTop: 4, letterSpacing: '0.04em' }}>{t('cycle.settings.birth_control.sub')}</div>
          </div>
          <input
            type="checkbox"
            checked={settings.birth_control_enabled}
            onChange={e => onChange({ ...settings, birth_control_enabled: e.target.checked })}
            style={{ width: 22, height: 22, cursor: 'pointer' }}
          />
        </label>

        {settings.birth_control_enabled && (
          <div style={{ padding: '16px 0', borderBottom: `1px solid ${C.sand}` }}>
            <div style={{ font: "400 15px/1.4 'Inter Tight', sans-serif", color: C.ink, marginBottom: 6 }}>{t('cycle.settings.pill_type.label')}</div>
            <div style={{ font: "400 11px/1.4 'DM Mono', monospace", color: C.inkFaint, marginBottom: 10, letterSpacing: '0.04em' }}>{t('cycle.settings.pill_type.sub')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['combined', 'progestin-only', 'other'] as const).map(pt => {
                const labelKey = pt === 'combined' ? 'cycle.pill.type_combined' : pt === 'progestin-only' ? 'cycle.pill.type_progestin' : 'cycle.pill.type_other';
                const on = settings.birth_control_type === pt;
                return (
                  <button
                    key={pt}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange({ ...settings, birth_control_type: pt })}
                    style={{
                      background: on ? C.deep : 'transparent',
                      border: `1px solid ${on ? C.deep : C.sand}`,
                      color: on ? C.base : C.ink,
                      padding: '10px 14px',
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 11,
                      letterSpacing: '0.12em',
                      textTransform: 'lowercase',
                      cursor: 'pointer',
                      minHeight: 44,
                      borderRadius: 0,
                    }}
                  >
                    {t(labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ padding: '16px 0' }}>
          <div style={{ font: "400 15px/1.4 'Inter Tight', sans-serif", color: C.ink, marginBottom: 6 }}>{t('cycle.settings.passphrase.label')}</div>
          <div style={{ font: "400 11px/1.4 'DM Mono', monospace", color: C.inkFaint, marginBottom: 10, letterSpacing: '0.04em' }}>{t('cycle.settings.passphrase.sub')}</div>
          <input
            type="text"
            value={settings.passphrase_hint}
            onChange={e => onChange({ ...settings, passphrase_hint: e.target.value })}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: C.base,
              border: `1px solid ${C.sand}`,
              padding: '10px 12px',
              fontFamily: "'DM Mono', monospace",
              fontSize: 13,
              color: C.ink,
              borderRadius: 0,
              outline: 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── SectionLabel ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 20,
      fontFamily: "'DM Mono', monospace",
      fontSize: 12,
      fontWeight: 500,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      color: C.inkFaint,
      marginBottom: 32,
    }}>
      <span>{children}</span>
      <span style={{ flex: 1, height: 1, background: C.sand }} />
    </div>
  );
}

// ─── GhostBtn ─────────────────────────────────────────────────────────────────

interface GhostBtnProps {
  children: React.ReactNode;
  onClick: () => void;
}

function GhostBtn({ children, onClick }: GhostBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: `1px solid ${C.ink}`,
        color: C.ink,
        padding: '14px 24px',
        fontFamily: "'DM Mono', monospace",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        borderRadius: 0,
        minHeight: 48,
        minWidth: 96,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// ─── PartnerSection ───────────────────────────────────────────────────────────

const PARTNER_OPTIONS: Array<[string, string, Array<[string, string]>]> = [
  ['material', 'cycle.partner.cat.material', [
    ['flowers', 'cycle.partner.material.flowers'],
    ['chocolate', 'cycle.partner.material.chocolate'],
    ['takeout', 'cycle.partner.material.takeout'],
    ['advil and a heating pad', 'cycle.partner.material.advil'],
  ]],
  ['touch', 'cycle.partner.cat.touch', [
    ['a hug', 'cycle.partner.touch.hug'],
    ['to be held', 'cycle.partner.touch.held'],
    ['a back rub', 'cycle.partner.touch.back_rub'],
    ['space, no touching', 'cycle.partner.touch.space'],
  ]],
  ['labor', 'cycle.partner.cat.labor', [
    ['dishes tonight', 'cycle.partner.labor.dishes'],
    ['cook dinner', 'cycle.partner.labor.cook'],
    ['a grocery run', 'cycle.partner.labor.grocery'],
    ['laundry', 'cycle.partner.labor.laundry'],
  ]],
  ['emotional', 'cycle.partner.cat.emotional', [
    ['to be listened to', 'cycle.partner.emotional.listen'],
    ['a distraction', 'cycle.partner.emotional.distract'],
    ['reassurance', 'cycle.partner.emotional.reassure'],
    ['to be left alone', 'cycle.partner.emotional.alone'],
  ]],
];

interface PartnerSectionProps {
  asks: string[];
  onAsksChange: (next: string[]) => void;
}

function PartnerSection({ asks, onAsksChange }: PartnerSectionProps) {
  return (
    <section style={{ marginBottom: 80 }}>
      <SectionLabel>{t('cycle.section.ask_partner')}</SectionLabel>
      <div style={{ padding: '28px clamp(16px, 5vw, 32px)', background: C.bone, borderRadius: 2 }}>
        {PARTNER_OPTIONS.map(([, catKey, options]) => (
          <div key={catKey} style={{ paddingBottom: 16 }}>
            <div style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 9,
              letterSpacing: '0.22em',
              color: C.inkFaint,
              textTransform: 'uppercase',
              paddingBottom: 10,
              fontWeight: 500,
            }}>
              {t(catKey)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {options.map(([opt, optKey]) => {
                const on = asks.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? asks.filter(a => a !== opt) : [...asks, opt];
                      onAsksChange(next);
                    }}
                    style={{
                      padding: '10px 16px',
                      border: `1px solid ${on ? C.accent : 'rgba(30,30,30,0.22)'}`,
                      background: on ? C.accent : 'transparent',
                      color: on ? C.base : C.ink,
                      fontFamily: "'Inter Tight', sans-serif",
                      fontSize: 14,
                      fontWeight: on ? 600 : 500,
                      cursor: 'pointer',
                      borderRadius: 2,
                    }}
                  >
                    {t(optKey)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{
        paddingTop: 18,
        fontFamily: "'DM Mono', monospace",
        fontSize: 10,
        letterSpacing: '0.22em',
        color: asks.length > 0 ? C.accent : C.inkFaint,
        textTransform: 'uppercase',
        fontWeight: 500,
      }}>
        {asks.length > 0
          ? tn('cycle.partner.summary', asks.length)
          : t('cycle.partner.empty')}
      </div>
    </section>
  );
}

// ─── CycleModule ──────────────────────────────────────────────────────────────

export interface CycleModuleProps {
  onBack?: () => void;
}

export function CycleModule({ onBack }: CycleModuleProps) {
  // Store slices
  const [items, setItems] = useStoreSlice<CycleItem[]>('cycle', 'items', []);
  const [settings, setSettings] = useStoreSlice<CycleSettings>('cycle', 'settings', {
    tracking_for_fertility: false,
    show_dial: true,
    passphrase_hint: '',
    birth_control_enabled: false,
    birth_control_type: 'combined',
  });
  // birth_control_enabled is authoritative at shared.settings.birth_control_enabled.
  // One-time migration: if cycle.settings has it true and shared.settings doesn't, copy it.
  const [sharedBirthControl, setSharedBirthControl] = useStoreSlice<boolean>(
    'shared',
    'settings.birth_control_enabled',
    false,
  );
  // Perform migration once: if old cycle-local flag is true and shared is false, lift it.
  useEffect(() => {
    if (settings.birth_control_enabled && !sharedBirthControl) {
      setSharedBirthControl(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [lastEditedByCycle, setLastEditedByCycle] = useStoreSlice<Record<number, number>>('cycle', 'lastEditedByCycle', {});
  const [asks, setAsks] = useStoreSlice<string[]>('cycle', 'asks', []);

  // Audit-fix #5: keep the module-level `t`/`tn` locale in sync with the
  // user's setting. Subscribing here re-renders the whole module (and its
  // sibling render functions) when the locale changes; setting the value
  // synchronously in the parent body means every descendant `t()` call
  // sees the current locale.
  const [sharedSettings] = useStoreSlice<{ locale?: string }>('shared', 'settings', {});
  syncCycleLocale(sharedSettings?.locale);

  // Local UI state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [adherenceDismissed, setAdherenceDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = useMemo(() => new Date(now), [now]);

  // ── derived values ─────────────────────────────────────────────────────────

  const cycles = useMemo(() => detectBoundaries(items), [items]);

  const stats = useMemo(() => deriveCycleStats(cycles), [cycles]);

  const prediction = useMemo(() => predictNextPeriod(cycles), [cycles]);

  const adherence = useMemo(() => detectAdherenceIssue(cycles), [cycles]);

  const symptomEvents = useMemo(
    () => items.filter(i => i && (i.action === 'symptom' || i.action === 'log')),
    [items],
  );

  const flags = useMemo(
    () => detectHealthFlags(cycles, symptomEvents, now, lastEditedByCycle),
    [cycles, symptomEvents, now, lastEditedByCycle],
  );

  const correlations = useMemo(() => {
    // findCorrelations(symptomEvents, cycles) — note arg order
    return findCorrelations(symptomEvents, cycles).filter(c => c.uniqueCycles >= 3);
  }, [cycles, symptomEvents]);

  const fertileWin = useMemo(() => {
    if (!settings.tracking_for_fertility) return null;
    return fertileWindow(cycles);
  }, [cycles, settings.tracking_for_fertility]);

  const phaseName = useMemo(
    () => computePhaseForDate(cycles, now),
    [cycles, now],
  );

  const currentDay = useMemo(() => {
    if (!stats.last_period_start) return null;
    return Math.floor((now - stats.last_period_start) / 86_400_000) + 1;
  }, [stats.last_period_start, now]);

  const dialLength = Math.round(stats.mean_length ?? 28);

  const ovulationPrediction = useMemo(
    () => (settings.show_dial ? predictOvulation(cycles) : null),
    [cycles, settings.show_dial],
  );

  // Day index (0-based) of predicted ovulation within the current cycle.
  // null when prediction is absent or ovulationTs falls outside cycle range.
  const ovulationDayIndex = useMemo(() => {
    if (!ovulationPrediction?.ovulationTs || !stats.last_period_start) return null;
    const idx = Math.round(
      (ovulationPrediction.ovulationTs - stats.last_period_start) / 86_400_000,
    );
    if (idx < 0 || idx >= dialLength) return null;
    return idx;
  }, [ovulationPrediction, stats.last_period_start, dialLength]);
  const currentDayLabel = currentDay ?? 1;
  const recentCycles = cycles.filter(c => c.cycleLengthDays).slice(-5);

  // ── save record ────────────────────────────────────────────────────────────

  const saveRecord = useCallback((tags: string[], note: string) => {
    const ts = Date.now();
    const next = items.slice();
    const DEDUP_MS = 12 * 60 * 60 * 1000;
    const lastStarted = items.reduce<number>((acc, i) =>
      i && i.action === 'started' && i.ts > acc ? i.ts : acc, 0);

    tags.forEach(tag => {
      if (tag === 'bleeding day 1') {
        if (lastStarted && (ts - lastStarted) < DEDUP_MS) {
          next.push({ ts, action: 'symptom', text: 'bleeding (day 1 already logged)' });
        } else {
          next.push({ ts, action: 'started', text: 'period started' });
        }
      } else {
        next.push({ ts, action: 'symptom', text: tag });
      }
    });
    if (note.trim()) next.push({ ts, action: 'log', text: note.trim() });

    setItems(next);

    if (stats.last_period_start !== null) {
      const updated = { ...lastEditedByCycle, [stats.last_period_start]: ts };
      setLastEditedByCycle(updated);
    }
    setRecordOpen(false);
  }, [items, setItems, lastEditedByCycle, setLastEditedByCycle, stats.last_period_start]);

  // ── pill log handler ───────────────────────────────────────────────────────

  const savePill = useCallback((ts: number) => {
    const next = items.slice();
    next.push({ ts, action: 'pill' });
    setItems(next);
  }, [items, setItems]);

  // ── adherence handlers ─────────────────────────────────────────────────────

  const handleAdherenceAccept = () => setAdherenceDismissed(true);
  const handleAdherenceMissedLog = () => {
    const split = adherence.suggestedSplit;
    if (!split) return;
    const next = items.slice();
    next.push({ ts: split, action: 'started', text: 'period started (estimated — missed log)' });
    setItems(next);
    setAdherenceDismissed(true);
  };

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="cycle-module"
      style={{
        // CSS custom property tokens (scoped here so they don't leak)
        ['--ceramic-base' as string]: '#E8DED0',
        ['--ceramic-deep' as string]: '#C4A988',
        ['--ceramic-bone' as string]: '#D4C5B0',
        ['--ceramic-sand' as string]: '#B8A994',
        ['--ceramic-ink' as string]: '#1E1E1E',
        ['--ceramic-ink-soft' as string]: '#5C5750',
        ['--ceramic-ink-faint' as string]: '#8A8377',
        ['--ceramic-accent' as string]: '#8A4B2C',
        ['--ceramic-ovulation' as string]: '#5A7A5A',   // sage · distinct from umber accent
        background: '#E8DED0',
        color: '#1E1E1E',
        width: '100%',
        minHeight: '100vh',
        boxSizing: 'border-box',
        overflowX: 'hidden',
      }}
    >
      <style>{`
        @media (max-width: 640px) {
          .cycle-module .cycle-history-grid { gap: 8px !important; }
        }
      `}</style>
      <div style={{
        width: '100%',
        maxWidth: 1400,
        margin: '0 auto',
        padding: 'calc(88px + env(safe-area-inset-top)) clamp(20px, 5vw, 64px) calc(200px + env(safe-area-inset-bottom))',
      }}>

        {/* ── header ─────────────────────────────────────────────────── */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 'clamp(56px, 12vw, 120px)' }}>
          <div>
            <h1 style={{ font: "600 clamp(34px, 8vw, 56px)/1 'Inter Tight', sans-serif", color: C.ink, margin: 0, letterSpacing: '-0.03em' }}>
              {t('cycle.title')}
            </h1>
            <p style={{ font: "500 12px/1 'DM Mono', monospace", letterSpacing: '0.18em', textTransform: 'uppercase', color: C.inkFaint, margin: '14px 0 0 0' }}>
              {fmtFullDate(today)}
            </p>
          </div>
          <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <GhostBtn onClick={() => setSettingsOpen(true)}>{t('cycle.btn.settings')}</GhostBtn>
            {onBack && <GhostBtn onClick={onBack}>{t('cycle.btn.back')}</GhostBtn>}
          </nav>
        </header>

        {/* ── adherence banner ───────────────────────────────────────── */}
        {adherence.hasIssue && !adherenceDismissed && (
          <div style={{
            border: `1px solid ${C.ink}`,
            borderLeft: `4px solid ${C.accent}`,
            padding: '28px 32px',
            marginBottom: 72,
          }}>
            <p style={{ font: "500 18px/1.5 'Inter Tight', sans-serif", color: C.ink, margin: '0 0 20px 0', letterSpacing: '-0.005em' }}>
              {t('cycle.adherence.body', adherence.observedLength ?? '')}
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <GhostBtn onClick={handleAdherenceAccept}>{t('cycle.adherence.btn.was_long')}</GhostBtn>
              <GhostBtn onClick={handleAdherenceMissedLog}>{t('cycle.adherence.btn.missed')}</GhostBtn>
            </div>
          </div>
        )}

        {/* ── hero ──────────────────────────────────────────────────── */}
        <div style={{ width: '100%', maxWidth: 860, margin: '0 auto 72px' }}>
          {stats.irregular_flag ? (
            <div style={{
              width: 'min(320px, 78vw)', height: 'min(320px, 78vw)',
              background: C.bone,
              margin: '0 auto 56px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 'clamp(24px, 7vw, 40px)', textAlign: 'center',
              font: "500 12px/1.6 'DM Mono', monospace",
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: C.inkSoft,
            }}>
              {t('cycle.irregular.copy')}
            </div>
          ) : settings.show_dial ? (
            <MoonPhaseTile cycleDay={currentDayLabel} cycleLength={dialLength} />
          ) : null}

          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            {currentDay !== null ? (
              <>
                <div
                  style={{ font: "600 clamp(120px, 38vw, 224px)/0.9 'Inter Tight', sans-serif", fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.05em', color: C.ink, marginBottom: 28 }}
                  aria-label={t('cycle.day.aria', currentDay, cyclePhaseLabel(phaseName))}
                >
                  {String(currentDay).padStart(2, '0')}
                </div>
                <div style={{ font: "500 clamp(28px, 7vw, 40px)/1 'Inter Tight', sans-serif", color: C.ink, letterSpacing: '-0.015em', marginBottom: 14 }}>
                  {cyclePhaseLabel(phaseName)}
                </div>
                <div style={{ font: "400 17px/1.5 'Inter Tight', sans-serif", color: C.inkSoft }}>
                  {t('cycle.day.sub', currentDay, dialLength)}
                </div>
              </>
            ) : (
              <>
                <div
                  style={{ font: "600 clamp(64px, 18vw, 96px)/0.9 'Inter Tight', sans-serif", fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', color: C.inkFaint, marginBottom: 28 }}
                  aria-label={t('cycle.day.aria_empty')}
                >
                  —
                </div>
                <div style={{ font: "400 17px/1.5 'Inter Tight', sans-serif", color: C.inkSoft }}>
                  {t('empty.cta.cycle')}
                </div>
              </>
            )}
          </div>

          {currentDay !== null && !stats.irregular_flag && (
            <>
              <div
                role="progressbar"
                aria-valuenow={currentDay}
                aria-valuemax={dialLength}
                aria-label={
                  ovulationDayIndex !== null
                    ? t('cycle.day.aria', currentDay, cyclePhaseLabel(phaseName)) +
                      ` · ${t('cycle.ovulation.caption', ovulationPrediction?.ovulationTs ? fmtOvulationDate(ovulationPrediction.ovulationTs) : '')}`
                    : undefined
                }
                style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginBottom: ovulationDayIndex !== null ? 16 : 120, padding: '0 16px' }}
              >
                {Array.from({ length: dialLength }).map((_, i) => {
                  const isOvulation = i === ovulationDayIndex;
                  return (
                    <span
                      key={i}
                      aria-label={isOvulation ? 'ovulation' : undefined}
                      style={{
                        width: isOvulation ? 10 : 8,
                        height: isOvulation ? 10 : 8,
                        borderRadius: '50%',
                        background: isOvulation
                          ? 'var(--ceramic-ovulation)'
                          : i < currentDay
                            ? C.accent
                            : 'transparent',
                        border: isOvulation
                          ? '1.5px solid var(--ceramic-ovulation)'
                          : `1px solid ${i < currentDay ? C.accent : C.sand}`,
                        flexShrink: 0,
                        marginTop: isOvulation ? -1 : 0,
                      }}
                    />
                  );
                })}
              </div>

              {/* ovulation caption */}
              {ovulationPrediction?.ovulationTs && (
                <div
                  style={{
                    textAlign: 'center',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.14em',
                    color: 'var(--ceramic-ovulation)',
                    marginBottom: 120,
                    paddingTop: 8,
                  }}
                >
                  {ovulationPrediction.confidence < 0.4
                    ? t('cycle.ovulation.caption_low', fmtOvulationDate(ovulationPrediction.ovulationTs))
                    : t('cycle.ovulation.caption', fmtOvulationDate(ovulationPrediction.ovulationTs))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── body ──────────────────────────────────────────────────── */}
        <div style={{ width: '100%', maxWidth: 1000, margin: '0 auto' }}>

          {/* next period */}
          <section style={{ marginBottom: 80 }}>
            <SectionLabel>{t('cycle.section.next_period')}</SectionLabel>
            <p style={{ font: "500 clamp(28px, 6vw, 44px)/1.2 'Inter Tight', sans-serif", color: C.ink, letterSpacing: '-0.02em', margin: '0 0 16px 0' }}>
              {prediction.confidenceRange
                ? t('cycle.next.approximately', fmtRange(prediction.confidenceRange))
                : t('cycle.next.need_logged')}
            </p>
            <p style={{ font: "500 17px/1.5 'Inter Tight', sans-serif", color: C.inkSoft, margin: '0 0 14px 0', letterSpacing: '-0.005em' }}>
              {confidenceTierCopy(prediction.next_period?.confidence ?? prediction.confidenceLevel ?? 'cold')}
              {prediction.cyclesUsed > 0
                ? ` · ${tn('cycle.next.cycles_logged', prediction.cyclesUsed)}`
                : ''}
            </p>
            <p style={{ font: "400 15px/1.55 'Inter Tight', sans-serif", color: C.inkFaint, margin: 0 }}>
              {prediction.explanation}
            </p>
          </section>

          {/* patterns */}
          {correlations.length > 0 && (
            <section style={{ marginBottom: 80 }}>
              <SectionLabel>{t('cycle.section.patterns')}</SectionLabel>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {correlations.map(c => (
                  <li key={c.bucket} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 16, padding: '28px 0', borderBottom: `1px solid ${C.sand}` }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: C.accent, marginTop: 12 }} aria-hidden="true" />
                    <div>
                      <p style={{ font: "500 21px/1.5 'Inter Tight', sans-serif", color: C.ink, margin: 0, letterSpacing: '-0.01em' }}>
                        {t('cycle.pattern.body', c.bucket, `day ~${c.meanDay}`, c.uniqueCycles)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* clinician flags */}
          {flags.length > 0 && (
            <section style={{ marginBottom: 80 }}>
              <SectionLabel>{t('cycle.section.clinician')}</SectionLabel>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {flags.map(f => (
                  <li key={f.id} style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 16, padding: '28px 0', borderBottom: `1px solid ${C.sand}` }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: C.accent, marginTop: 12 }} aria-hidden="true" />
                    <div>
                      <p style={{ font: "500 21px/1.5 'Inter Tight', sans-serif", color: C.ink, margin: 0, letterSpacing: '-0.01em' }}>
                        {f.observation}
                      </p>
                      <p style={{ font: "400 15px/1.55 'Inter Tight', sans-serif", color: C.inkSoft, margin: '4px 0 0 0' }}>
                        {f.reference}
                      </p>
                      <p style={{ font: "400 15px/1.55 'Inter Tight', sans-serif", color: C.ink, margin: '4px 0 0 0' }}>
                        {f.suggestion}
                      </p>
                      <div style={{ marginTop: 8 }}>
                        <SourcesLink sources={f.sources} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* fertile window */}
          {fertileWin && (
            <section style={{ marginBottom: 80 }}>
              <SectionLabel>{t('cycle.section.fertile_window')}</SectionLabel>
              <p style={{ font: "500 clamp(28px, 6vw, 44px)/1.2 'Inter Tight', sans-serif", color: C.ink, letterSpacing: '-0.02em', margin: '0 0 16px 0' }}>
                {fmtRange(fertileWin)}
              </p>
              <p style={{ font: "400 15px/1.55 'Inter Tight', sans-serif", color: C.inkFaint, margin: 0 }}>
                {t('cycle.fertile.detail')}
              </p>
            </section>
          )}

          {/* cycle history */}
          {recentCycles.length > 0 && (
            <section style={{ marginBottom: 80 }}>
              <SectionLabel>
                {tn('cycle.section.record', recentCycles.length)}
              </SectionLabel>
              <div className="cycle-history-grid" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {recentCycles.map(c => (
                  <div key={c.cycleStartTs} style={{
                    width: 96, height: 96,
                    background: C.bone,
                    display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4,
                    paddingTop: 24,
                  }}>
                    <span style={{ font: "600 40px/1 'Inter Tight', sans-serif", fontVariantNumeric: 'tabular-nums', color: C.ink, letterSpacing: '-0.02em' }}>
                      {c.cycleLengthDays}
                    </span>
                    <span style={{ font: "500 14px/1 'DM Mono', monospace", color: C.inkFaint, letterSpacing: '0.1em' }}>
                      {t('cycle.record.unit_d')}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* record today */}
          <button
            type="button"
            aria-expanded={recordOpen}
            onClick={() => setRecordOpen(v => !v)}
            style={{
              display: 'block', width: '100%', maxWidth: 480, margin: '96px auto 0',
              boxSizing: 'border-box',
              background: recordOpen ? C.deep : C.base,
              border: `1.5px solid ${C.ink}`,
              color: recordOpen ? C.base : C.ink,
              padding: 28,
              fontFamily: "'DM Mono', monospace",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              borderRadius: 0,
              minHeight: 72,
              cursor: 'pointer',
            }}
          >
            {recordOpen ? t('cycle.record.btn.close') : t('cycle.record.btn.open')}
          </button>

          {recordOpen && <RecordPanel onSave={saveRecord} onCancel={() => setRecordOpen(false)} />}

          {/* birth control pill log — gated on shared.settings.birth_control_enabled */}
          {sharedBirthControl && (
            <div style={{ marginTop: 80 }}>
              <PillLogSection
                items={items}
                onLogPill={savePill}
                now={now}
                birthControlType={settings.birth_control_type}
              />
            </div>
          )}

          {/* ask partner */}
          <div style={{ marginTop: 80 }}>
            <PartnerSection
              asks={Array.isArray(asks) ? asks : []}
              onAsksChange={next => {
                setAsks(next);
              }}
            />
          </div>

        </div>{/* /.body */}

      </div>{/* /.inner */}

      {/* settings panel */}
      {settingsOpen && (
        <SettingsPanel
          settings={{ ...settings, birth_control_enabled: sharedBirthControl }}
          onChange={next => {
            // birth_control_enabled is authoritative in shared.settings; keep cycle.settings in sync
            if (next.birth_control_enabled !== sharedBirthControl) {
              setSharedBirthControl(next.birth_control_enabled);
            }
            setSettings(next);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
