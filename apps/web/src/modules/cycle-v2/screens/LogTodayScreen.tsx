/**
 * cycle-v2 · LogTodayScreen — the day-log sheet (cycle-log.html)
 *
 * One thing: how is today. A calm lead line with the day stated for
 * context, a wrap of symptom-tag chips, one quiet free-note line, and a
 * distinct amber-hairline "bleeding — day 1" block that starts a new
 * cycle. One amber "save" commit.
 *
 * Real data: "save" appends real `CycleItem`s through `useCycleActions` —
 * symptom tags become `symptom` events, the note a `log` event, and the
 * bleeding-day-1 block a `started` event (a new cycle). The live boundary
 * detector + health-flag engine pick them all up immediately.
 */
import { useMemo, useState } from 'react';
import { Screen, Chip, AmberButton, IconCheck, IconPencil, v2 } from '../../money-v2/v2';
import { useCycleSlices } from '../useCycleSlices';
import { useCycleActions } from '../useCycleActions';
import { faceVM, SYMPTOM_TAGS } from '../selectors';

export interface LogTodayScreenProps {
  now: number;
  onBack: () => void;
}

export function LogTodayScreen({ now, onBack }: LogTodayScreenProps) {
  const slices = useCycleSlices();
  const actions = useCycleActions(now);
  const face = useMemo(() => faceVM(slices, now), [slices, now]);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [bleedingDayOne, setBleedingDayOne] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(tag: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  const dirty = picked.size > 0 || note.trim().length > 0 || bleedingDayOne;

  function save() {
    if (!dirty) {
      onBack();
      return;
    }
    actions.logToday({
      tags: [...picked],
      note: note.trim() || undefined,
      bleedingDayOne,
    });
    setSaved(true);
    // a brief calm confirmation, then dismiss
    window.setTimeout(onBack, 750);
  }

  return (
    <Screen label="log today" scroll contentStyle={{ paddingTop: 0 }} onBack={onBack}>
      {/* the lead — day stated for context */}
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
        }}
      >
        <b style={{ fontWeight: 500 }}>how is today</b>
      </div>
      <div style={{ marginTop: 6, fontSize: 13, color: v2.mute, fontWeight: 500 }}>
        day {face.day} &middot; {face.phase}
      </div>

      {/* symptom tag chips */}
      <div style={{ marginTop: 32 }}>
        <div
          style={{
            fontSize: 11,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          symptoms
        </div>
        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 9 }}>
          {SYMPTOM_TAGS.map((tag) => (
            <Chip key={tag} on={picked.has(tag)} onToggle={() => toggle(tag)}>
              {tag}
            </Chip>
          ))}
        </div>
      </div>

      {/* free-text note line — a quiet underline, never a big box */}
      <label
        style={{
          marginTop: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          borderBottom: `1px solid ${v2.line}`,
          paddingBottom: 11,
        }}
      >
        <IconPencil stroke={v2.mute} />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="add a note…"
          aria-label="add a note"
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            outline: 'none',
            fontSize: 15,
            color: v2.ink,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            fontFamily: v2.sans,
            padding: 0,
          }}
        />
      </label>

      {/* the distinct bleeding-day-1 action — starts a new cycle */}
      <button
        type="button"
        aria-pressed={bleedingDayOne}
        onClick={() => setBleedingDayOne((v) => !v)}
        style={{
          boxSizing: 'border-box',
          marginTop: 34,
          width: '100%',
          border: `1.5px solid ${v2.accent}`,
          borderRadius: 18,
          padding: '16px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 13,
          background: bleedingDayOne ? '#F6E3C4' : '#FCF4E6',
          cursor: 'pointer',
          textAlign: 'left',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: v2.accent,
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: v2.ink, letterSpacing: '-0.01em' }}>
            bleeding — day 1
          </span>
          <span style={{ fontSize: 12, color: '#9A7A45', fontWeight: 500 }}>
            {bleedingDayOne ? 'selected · starts a new cycle' : 'starts a new cycle'}
          </span>
        </span>
        {bleedingDayOne && <IconCheck size={18} stroke={v2.accent} />}
      </button>

      {/* save — the one commit */}
      <AmberButton
        block
        icon={<IconCheck size={20} />}
        onClick={save}
        style={{ marginTop: 32 }}
      >
        save
      </AmberButton>

      {saved && (
        <div
          role="status"
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
