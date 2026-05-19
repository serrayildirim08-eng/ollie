/**
 * admin-v2 · TaskScreen — a single task (admin-task.html)
 *
 * One task as the focus — the title large, its days-left + ball state calm
 * under it, one amber "mark it done" commit. Below, the quiet action rows:
 * close-the-loop (sage dot, distinct from done), defer, whose-move, and
 * split-into-GATHER+FILL (umber dot). At the foot, the attached document
 * references — A14 cognitive-offload, the paperwork lives with the task.
 *
 * Real data + real logic: `taskDetailVM` over the live `admin.tasks` slice;
 * every action mutates the live store through `useAdminActions`, which
 * mirrors the live `AdminModule`'s markDone / closeLoop / deferTask /
 * splitIntoGatherFill / addDocRef.
 */
import { useMemo, useState } from 'react';
import {
  Screen,
  AmberButton,
  IconCheck,
  IconChevronRight,
  IconDoc,
  IconLink,
  IconPlus,
  v2,
} from '../../money-v2/v2';
import { useAdminSlices } from '../useAdminSlices';
import { useAdminActions } from '../useAdminActions';
import { taskDetailVM, type BallTag } from '../selectors';
import type { BallState } from '@ollie/logic/admin';

export interface TaskScreenProps {
  now: number;
  taskId: string | null;
  onBack: () => void;
  onSafe: () => void;
}

export function TaskScreen({ now, taskId, onBack, onSafe }: TaskScreenProps) {
  const slices = useAdminSlices();
  const actions = useAdminActions(now);
  const vm = useMemo(() => taskDetailVM(slices, taskId, now), [slices, taskId, now]);

  // a local "whose move" picker — expands inline under its row
  const [ballOpen, setBallOpen] = useState(false);
  // a local doc-attach field
  const [docOpen, setDocOpen] = useState(false);
  const [docLabel, setDocLabel] = useState('');

  if (!vm.exists) {
    return (
      <Screen label="a task" onBack={onBack} onSafe={onSafe} centered>
        <div
          style={{
            fontSize: 16,
            color: v2.mute,
            fontWeight: 500,
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          this task isn&rsquo;t on the list anymore.
        </div>
      </Screen>
    );
  }

  return (
    <Screen label="a task" onBack={onBack} onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      {/* the hero — the task itself */}
      <div
        style={{
          marginTop: 44,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div style={{ fontSize: 13, color: v2.mute, fontWeight: 500, letterSpacing: '0.02em' }}>
          {vm.category}
        </div>
        <div
          style={{
            marginTop: 9,
            fontSize: 34,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
            textAlign: 'center',
          }}
        >
          {vm.title}
        </div>
        <div
          style={{
            marginTop: 14,
            fontSize: 14,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            textAlign: 'center',
          }}
        >
          {vm.meta}
        </div>

        {/* the ball-state line — one calm sentence */}
        <div style={{ marginTop: 11, display: 'flex', alignItems: 'center', gap: 8 }}>
          <BallMark ball={vm.ball} />
          <span
            style={{
              fontSize: 13,
              color: v2.mute,
              fontWeight: 500,
              letterSpacing: '0.01em',
            }}
          >
            {vm.ballSentence}
          </span>
        </div>

        {vm.finished ? (
          <div
            style={{
              marginTop: 24,
              fontSize: 14,
              color: v2.sage,
              fontWeight: 600,
              letterSpacing: '0.01em',
            }}
          >
            done. nothing left to do here.
          </div>
        ) : (
          <AmberButton
            icon={<IconCheck size={18} />}
            onClick={() => actions.markDone(vm.id)}
            style={{ marginTop: 24, height: 50, borderRadius: 25 }}
          >
            mark it done
          </AmberButton>
        )}
      </div>

      {/* the calm action rows */}
      {!vm.finished && (
        <div style={{ marginTop: 46, display: 'flex', flexDirection: 'column' }}>
          {/* close-the-loop — sage dot, distinct from done */}
          <ActionRow
            first
            dotColor={v2.sage}
            rowKey="close the loop"
            keyColor={v2.sage}
            value="done is filled — closed is mailed and back"
            onOpen={() => actions.closeLoop(vm.id)}
          />
          {/* defer */}
          <ActionRow
            rowKey="defer"
            value={vm.deferLine}
            onOpen={() => actions.deferTask(vm.id)}
          />
          {/* whose move — expands an inline ball picker */}
          <ActionRow
            rowKey="whose move"
            value="mine · waiting on someone · waiting on a date"
            last={!vm.alreadySplit && !ballOpen}
            onOpen={() => setBallOpen((o) => !o)}
          />
          {ballOpen && (
            <BallPicker
              current={vm.ball}
              onPick={(b) => {
                actions.setBall(vm.id, b);
                setBallOpen(false);
              }}
            />
          )}
          {/* split into GATHER + FILL — only when not already split */}
          {!vm.alreadySplit && (
            <ActionRow
              last
              dotColor="#A8703C"
              rowKey="split it up"
              keyColor="#A8703C"
              value="into gather the docs & fill the form"
              onOpen={() => actions.splitTask(vm.id)}
            />
          )}
        </div>
      )}

      {/* documents — A14, the paperwork lives with the task */}
      <div
        style={{
          marginTop: 32,
          fontSize: 11,
          color: v2.mute,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        documents
      </div>
      {vm.docs.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
          {vm.docs.map((doc, i) => (
            <div
              key={`${doc.label}-${i}`}
              style={{
                boxSizing: 'border-box',
                borderTop: `1px solid ${v2.line}`,
                borderBottom: i === vm.docs.length - 1 ? `1px solid ${v2.line}` : 'none',
                padding: '14px 2px',
                display: 'flex',
                alignItems: 'center',
                gap: 11,
              }}
            >
              <span
                style={{
                  boxSizing: 'border-box',
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  background: v2.tile,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <IconDoc size={14} stroke={v2.ink} />
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 14,
                  color: v2.ink,
                  fontWeight: 500,
                  letterSpacing: '-0.01em',
                }}
              >
                {doc.label}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  color: v2.mute,
                  fontWeight: 500,
                }}
              >
                <IconLink size={12} stroke={v2.mute} />
                {doc.link}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* attach a document — a quiet inline field */}
      {docOpen ? (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="text"
            value={docLabel}
            placeholder="document name"
            autoFocus
            onChange={(e) => setDocLabel(e.target.value)}
            style={{
              boxSizing: 'border-box',
              width: '100%',
              border: 'none',
              borderBottom: `1.5px solid ${v2.ink}`,
              background: 'transparent',
              padding: '0 0 10px',
              fontSize: 17,
              fontWeight: 500,
              color: v2.ink,
              letterSpacing: '-0.01em',
              fontFamily: v2.sans,
              outline: 'none',
            }}
          />
          <AmberButton
            block
            onClick={() => {
              if (docLabel.trim()) {
                actions.attachDoc(vm.id, docLabel.trim());
                setDocLabel('');
                setDocOpen(false);
              }
            }}
            style={{ height: 46, borderRadius: 23 }}
          >
            attach it
          </AmberButton>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDocOpen(true)}
          style={{
            marginTop: 13,
            alignSelf: 'flex-start',
            background: 'transparent',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: v2.accent,
            fontWeight: 600,
            letterSpacing: '0.01em',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <IconPlus size={14} weight={2.2} stroke={v2.accent} />
          attach a document
        </button>
      )}
    </Screen>
  );
}

// ─── the ball-state mark ─────────────────────────────────────────────────────

function BallMark({ ball }: { ball: BallTag }) {
  let style: React.CSSProperties;
  if (ball === 'MINE') style = { background: v2.ink };
  else if (ball === 'THEIRS') style = { background: 'transparent', border: '1.8px solid #A8703C' };
  else style = { background: 'transparent', border: `1.8px solid ${v2.mute}` };
  return (
    <span
      aria-hidden
      style={{
        boxSizing: 'border-box',
        width: 11,
        height: 11,
        borderRadius: 3,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

// ─── one action row ──────────────────────────────────────────────────────────

interface ActionRowProps {
  rowKey: string;
  value: import('react').ReactNode;
  onOpen: () => void;
  first?: boolean;
  last?: boolean;
  /** a leading dot — sage (close-loop) or umber (split) */
  dotColor?: string;
  /** the key colour, paired with the dot */
  keyColor?: string;
}

function ActionRow({ rowKey, value, onOpen, first, last, dotColor, keyColor }: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        background: 'transparent',
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: `1px solid ${v2.line}`,
        borderBottom: last ? `1px solid ${v2.line}` : 'none',
        padding: '18px 2px',
        display: 'flex',
        alignItems: 'center',
        cursor: 'pointer',
        textAlign: 'left',
        WebkitTapHighlightColor: 'transparent',
      }}
      data-first={first ? 'true' : undefined}
    >
      {dotColor && (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
            marginRight: 11,
          }}
        />
      )}
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.01em',
          color: keyColor ?? v2.mute,
          flexShrink: 0,
        }}
      >
        {rowKey}
      </span>
      <span style={{ color: v2.line, margin: '0 8px', fontSize: 13 }}>·</span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: v2.ink,
          flex: 1,
        }}
      >
        {value}
      </span>
      <span style={{ display: 'inline-flex', marginLeft: 8 }} aria-hidden>
        <IconChevronRight stroke={v2.mute} />
      </span>
    </button>
  );
}

// ─── the inline ball-state picker ────────────────────────────────────────────

const BALL_CHOICES: { value: BallState; label: string; hint: string }[] = [
  { value: 'MINE', label: 'mine', hint: 'nothing to wait on' },
  { value: 'THEIRS', label: 'with them', hint: 'waiting on someone' },
  { value: 'WAITING', label: 'on its way', hint: 'waiting on a date' },
];

function BallPicker({ current, onPick }: { current: BallTag; onPick: (b: BallState) => void }) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        gap: 8,
        padding: '14px 2px 4px',
      }}
    >
      {BALL_CHOICES.map((c) => {
        const on = c.value === current;
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(c.value)}
            style={{
              boxSizing: 'border-box',
              flex: 1,
              border: `1px solid ${on ? v2.accent : v2.line}`,
              background: on ? '#FCF6EA' : v2.card,
              borderRadius: 14,
              padding: '11px 8px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: on ? 600 : 500,
                color: v2.ink,
                letterSpacing: '-0.01em',
              }}
            >
              {c.label}
            </span>
            <span style={{ fontSize: 10, color: v2.mute, fontWeight: 500 }}>{c.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
