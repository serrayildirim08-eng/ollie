/**
 * MedicationModule — Sprint 4 · E1 + E7
 *
 * Voice: dry, factual. "noted." not "great job!". No streaks.
 */

import React, { useMemo, useState } from 'react';
import { useStoreSlice } from '../../store';
import { mkId } from '../../lib/mkId';
import { emit } from '@ollie/events';
import {
  takenToday,
  takenCountToday,
  dosesRemainingToday,
  type MedicationItem,
  type MedicationKind,
  type AdherenceReport,
  isoDate,
} from '@ollie/logic/medication';

const T = {
  bg: '#F5F4F0',
  ink: '#111111',
  muted: '#666666',
  faint: '#999999',
  border: 'rgba(0,0,0,0.08)',
  card: 'rgba(255,255,255,0.6)',
} as const;

const labelStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 10,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: T.muted,
};

const KINDS: MedicationKind[] = ['vitamin', 'supplement', 'prescription', 'otc'];

export function MedicationModule() {
  const [items, setItems] = useStoreSlice<MedicationItem[]>('medication', 'items', []);
  const [adherence] = useStoreSlice<Record<string, AdherenceReport | null>>('medication', 'adherence', {});
  const [drafting, setDrafting] = useState(false);
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [kind, setKind] = useState<MedicationKind>('vitamin');
  const [schedule, setSchedule] = useState('08:00');

  const today = useMemo(() => Date.now(), []);
  const visible = (items ?? []).filter((i) => !i.archived);

  function addItem() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const item: MedicationItem = {
      id: mkId('m'),
      name: trimmed.toLowerCase(),
      dose: dose.trim() || undefined,
      kind,
      schedule: schedule.split(',').map((s) => s.trim()).filter(Boolean),
      taken: [],
      created_at: Date.now(),
    };
    setItems([...(items ?? []), item]);
    setDrafting(false);
    setName(''); setDose(''); setSchedule('08:00');
  }

  function logTaken(itemId: string) {
    const next = (items ?? []).map((it) => {
      if (it.id !== itemId) return it;
      const now = Date.now();
      const d = new Date(now);
      const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const taken = [...(it.taken ?? []), { date: isoDate(now), time, ts: now }];
      return { ...it, taken };
    });
    setItems(next);
    const it = (items ?? []).find((x) => x.id === itemId);
    if (it) {
      try { emit('medication:logged', { item_id: it.id, name: it.name, ts: Date.now() }); }
      catch { /* registry warn ok */ }
    }
  }

  function archive(itemId: string) {
    setItems((items ?? []).map((it) => it.id === itemId ? { ...it, archived: true } : it));
  }

  return (
    <div style={{ minHeight: '100vh', overflowX: 'hidden', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px 120px' }}>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 32, fontWeight: 400, margin: 0 }}>
          medication
        </h1>
        <p style={{ ...labelStyle, marginTop: 8 }}>
          {visible.length === 0 ? 'no items yet' : `${visible.length} item${visible.length === 1 ? '' : 's'}`}
        </p>
      </header>

      {visible.length === 0 && !drafting && (
        <div style={{
          padding: '32px 20px',
          background: T.card,
          backdropFilter: 'blur(16px)',
          border: `1px solid ${T.border}`,
          borderRadius: 20,
          textAlign: 'center',
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 14,
          color: T.muted,
        }}>
          add a medication, supplement, or vitamin you take regularly.
        </div>
      )}

      {visible.map((it) => {
        const done = takenToday(it, today);
        const count = takenCountToday(it, today);
        const remaining = dosesRemainingToday(it, today);
        const adh = adherence?.[it.id];
        return (
          <div
            key={it.id}
            style={{
              padding: '18px 20px',
              background: T.card,
              backdropFilter: 'blur(16px)',
              border: `1px solid ${T.border}`,
              borderRadius: 20,
              marginBottom: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    background: it.color_hex ?? '#C8A26A',
                    display: 'inline-block',
                    boxShadow: 'inset 0 -2px 4px rgba(0,0,0,0.18)',
                  }}
                />
                <div>
                  <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, fontWeight: 400 }}>{it.name}</div>
                  <div style={{ ...labelStyle, marginTop: 2 }}>
                    {it.kind}{it.dose ? ` · ${it.dose}` : ''}
                    {it.schedule.length > 0 ? ` · ${it.schedule.join(' · ')}` : ' · manual log only'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => archive(it.id)}
                aria-label={`archive ${it.name}`}
                style={iconBtnStyle}
              >×</button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => logTaken(it.id)} style={primaryBtnStyle}>
                {done && remaining === 0 ? 'log another dose' : 'log taken'}
              </button>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: T.muted, letterSpacing: '0.04em' }}>
                today · {count} logged{it.schedule.length > 0 ? `, ${remaining} remaining` : ''}
              </span>
            </div>

            {adh && (
              <div style={{ ...labelStyle, marginTop: 4, color: adh.drift ? '#8A4B2C' : T.muted }}>
                {adh.copy}
              </div>
            )}
          </div>
        );
      })}

      {drafting ? (
        <div style={{
          padding: 20,
          background: T.card,
          backdropFilter: 'blur(16px)',
          border: `1px solid ${T.border}`,
          borderRadius: 20,
          marginTop: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name (e.g. vitamin d)" style={inputStyle} />
          <input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="dose (e.g. 1000 iu)" style={inputStyle} />
          <select value={kind} onChange={(e) => setKind(e.target.value as MedicationKind)} style={inputStyle}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="schedule · 08:00, 20:00 (leave blank for manual)"
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={addItem} style={primaryBtnStyle}>add</button>
            <button type="button" onClick={() => setDrafting(false)} style={ghostBtnStyle}>cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setDrafting(true)} style={{ ...ghostBtnStyle, marginTop: 18 }}>
          + add medication
        </button>
      )}
    </div>
    </div>
  );
}

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }

const primaryBtnStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 10,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  padding: '10px 14px',
  background: 'transparent',
  color: T.ink,
  border: `1px solid ${T.ink}`,
  borderRadius: 12,
  cursor: 'pointer',
};

const ghostBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  color: T.muted,
  borderColor: T.border,
};

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: T.muted,
  fontSize: 18,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 14,
  padding: '10px 12px',
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  background: 'rgba(255,255,255,0.5)',
};
