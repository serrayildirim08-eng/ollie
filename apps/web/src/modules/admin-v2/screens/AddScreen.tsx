/**
 * admin-v2 · AddScreen — add to admin (admin-add.html)
 *
 * The add form, the v2 way: one quiet underlined title line (never a big
 * box), a calm 2-up kind picker (task / renewal), a wrap of soft category
 * pills, and — only when kind = renewal — an expiry date line with a sage
 * preview of the staged 90/30/7/0-day cues. An optional recurrence pill
 * wrap. One full-width amber "add it" commit; a dry "noted." confirmation.
 *
 * Real data: the commit writes a real `admin.tasks` row through
 * `useAdminActions.addTask`, the SAME shape the live `AdminModule.save`
 * writes — so the task is immediately visible to the live module.
 */
import { useState } from 'react';
import { Screen, AmberButton, IconCheck, v2 } from '../../money-v2/v2';
import { useAdminActions } from '../useAdminActions';
import {
  KIND_OPTIONS,
  CATEGORY_OPTIONS,
  RECUR_OPTIONS,
  fmtLongDate,
} from '../selectors';

export interface AddScreenProps {
  now: number;
  onBack: () => void;
}

/** the default expiry — 30 days out, the calm mid-runway default */
function defaultExpiryISO(now: number): string {
  return new Date(now + 30 * 86_400_000).toISOString().slice(0, 10);
}

export function AddScreen({ now, onBack }: AddScreenProps) {
  const actions = useAdminActions(now);

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'task' | 'renewal'>('task');
  const [category, setCategory] = useState<string>('other');
  const [expiryISO, setExpiryISO] = useState<string>(defaultExpiryISO(now));
  const [recur, setRecur] = useState<string>('');
  const [saved, setSaved] = useState(false);

  const canSave = title.trim().length > 0 && !saved;

  const commit = () => {
    if (!canSave) return;
    const id = actions.addTask({
      title: title.trim(),
      kind,
      category,
      expiryDate: kind === 'renewal' ? expiryISO : '',
      recur,
    });
    if (id) {
      setSaved(true);
      // the dry confirmation sits for a beat, then the screen dismisses
      window.setTimeout(() => onBack(), 900);
    }
  };

  return (
    <Screen label="add to admin" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
      {/* the lead — one calm line */}
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
        }}
      >
        <b style={{ fontWeight: 500 }}>what needs tracking</b>
      </div>

      {/* the title field — one quiet underlined line */}
      <input
        type="text"
        value={title}
        placeholder="renew passport"
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          marginTop: 30,
          border: 'none',
          borderBottom: `1.5px solid ${v2.ink}`,
          background: 'transparent',
          padding: '0 0 11px',
          fontSize: 21,
          fontWeight: 500,
          color: v2.ink,
          letterSpacing: '-0.01em',
          fontFamily: v2.sans,
          outline: 'none',
        }}
      />

      {/* kind — task / renewal */}
      <SectionLabel>kind</SectionLabel>
      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
        {KIND_OPTIONS.map((k) => {
          const on = kind === k.value;
          return (
            <button
              key={k.value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setKind(k.value);
                // picking renewal nudges the category to match, once
                if (k.value === 'renewal' && category === 'other') {
                  setCategory('renewal');
                }
              }}
              style={{
                boxSizing: 'border-box',
                height: 58,
                borderRadius: 16,
                border: `1px solid ${on ? v2.accent : v2.line}`,
                background: on ? '#FCF6EA' : v2.card,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                cursor: 'pointer',
                boxShadow: on ? 'none' : '0 6px 16px rgba(42,38,34,.04)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  color: v2.ink,
                  fontWeight: on ? 600 : 500,
                  letterSpacing: '-0.01em',
                }}
              >
                {k.label}
              </span>
              <span style={{ fontSize: 10, color: v2.mute, fontWeight: 600, letterSpacing: '0.03em' }}>
                {k.hint}
              </span>
            </button>
          );
        })}
      </div>

      {/* category */}
      <SectionLabel>category</SectionLabel>
      <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {CATEGORY_OPTIONS.map((c) => {
          const on = category === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => setCategory(c)}
              style={{
                boxSizing: 'border-box',
                border: `1px solid ${on ? v2.accent : v2.line}`,
                background: on ? v2.accent : v2.card,
                borderRadius: 14,
                padding: '8px 13px',
                fontSize: 13,
                fontWeight: on ? 600 : 500,
                color: on ? '#fff' : v2.ink,
                letterSpacing: '-0.01em',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {c}
            </button>
          );
        })}
      </div>

      {/* expiry — only for a renewal */}
      {kind === 'renewal' && (
        <>
          <SectionLabel>expires</SectionLabel>
          <div
            style={{
              boxSizing: 'border-box',
              marginTop: 14,
              borderBottom: `1px solid ${v2.line}`,
              paddingBottom: 11,
              position: 'relative',
            }}
          >
            <span
              style={{
                fontSize: 17,
                color: v2.ink,
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              {fmtLongDate(new Date(`${expiryISO}T00:00:00`).getTime())}
            </span>
            {/* a real date input sits invisibly over the calm display line */}
            <input
              type="date"
              value={expiryISO}
              aria-label="expiry date"
              onChange={(e) => {
                if (e.target.value) setExpiryISO(e.target.value);
              }}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontFamily: v2.sans,
              }}
            />
          </div>
          {/* the staged-cue preview — a calm sage line */}
          <div style={{ marginTop: 13, display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: v2.sage,
                flexShrink: 0,
                marginTop: 5,
              }}
            />
            <span style={{ fontSize: 13, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
              ollie will <b style={{ color: v2.ink, fontWeight: 600 }}>raise it quietly</b> at 90,
              30, 7 days, and the day it&rsquo;s due &mdash; never all at once.
            </span>
          </div>
        </>
      )}

      {/* recurrence — optional */}
      <div
        style={{
          marginTop: 34,
          fontSize: 11,
          color: v2.mute,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        repeats
        <span
          style={{
            color: v2.line,
            fontWeight: 500,
            textTransform: 'none',
            letterSpacing: '0.01em',
            marginLeft: 7,
          }}
        >
          &mdash; optional, blank = a one-off
        </span>
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {RECUR_OPTIONS.map((r) => {
          const on = recur === r.value;
          return (
            <button
              key={r.value}
              type="button"
              aria-pressed={on}
              onClick={() => setRecur(on ? '' : r.value)}
              style={{
                boxSizing: 'border-box',
                border: `1px solid ${on ? '#A8703C' : v2.line}`,
                background: on ? '#FBF1E7' : v2.card,
                borderRadius: 14,
                padding: '7px 12px',
                fontSize: 12,
                fontWeight: on ? 600 : 500,
                color: on ? '#A8703C' : v2.mute,
                letterSpacing: '0.01em',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <AmberButton
        block
        icon={<IconCheck size={22} />}
        onClick={commit}
        disabled={!canSave}
        style={{
          marginTop: 36,
          height: 52,
          opacity: canSave ? 1 : 0.45,
        }}
      >
        add it
      </AmberButton>
      {saved && (
        <div
          style={{
            marginTop: 16,
            textAlign: 'center',
            fontSize: 13,
            color: v2.sage,
            fontWeight: 600,
            letterSpacing: '0.01em',
          }}
        >
          noted.
        </div>
      )}
    </Screen>
  );
}

// ─── a section label ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: import('react').ReactNode }) {
  return (
    <div
      style={{
        marginTop: 34,
        fontSize: 11,
        color: v2.mute,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}
