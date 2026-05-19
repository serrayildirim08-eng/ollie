/**
 * cycle-v2 · PartnerAskScreen — the 4-category ask flow (partner-ask.html)
 *
 * One focus: pick what you need across material · touch · labor ·
 * emotional. Each category is a calm block — a small sage glyph, the
 * category word, a few quiet chips. ollie composes the picks into a calm
 * note shown in a preview card before the one amber "send" commit.
 *
 * Real data: the picks persist to the live `cycle.asks` slice through
 * `useCycleActions` (the same slice the live `CycleModule.PartnerSection`
 * reads + writes). The note preview is composed by the pure
 * `composeAskNote` selector. Sending is an honest stub — the share
 * channel is not wired in the preview (see module report).
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Screen,
  Chip,
  AmberButton,
  IconShare,
  IconBag,
  IconHeart,
  IconHome,
  IconChat,
  v2,
} from '../../money-v2/v2';
import { useCycleSlices } from '../useCycleSlices';
import { useCycleActions } from '../useCycleActions';
import { ASK_CATEGORIES, composeAskNote } from '../selectors';
import type { AskCategory } from '../selectors';

export interface PartnerAskScreenProps {
  now: number;
  onBack: () => void;
  onSafe: () => void;
}

const CATEGORY_GLYPH: Record<AskCategory['key'], ReactNode> = {
  material: <IconBag size={15} weight={1.8} stroke={v2.sage} />,
  touch: <IconHeart stroke={v2.sage} />,
  labor: <IconHome stroke={v2.sage} />,
  emotional: <IconChat stroke={v2.sage} />,
};

export function PartnerAskScreen({ now, onBack, onSafe }: PartnerAskScreenProps) {
  const slices = useCycleSlices();
  const actions = useCycleActions(now);

  // seed from the live store so a previously-saved ask reopens with its picks
  const [picks, setPicks] = useState<Set<string>>(
    () => new Set(slices.asks),
  );
  const [sent, setSent] = useState(false);

  const note = useMemo(() => composeAskNote([...picks]), [picks]);

  function toggle(option: string) {
    setPicks((cur) => {
      const next = new Set(cur);
      if (next.has(option)) next.delete(option);
      else next.add(option);
      // persist every change to the live cycle.asks slice
      actions.setAsks([...next]);
      return next;
    });
  }

  function send() {
    actions.setAsks([...picks]);
    setSent(true);
    // honest stub: the picks are persisted; the share channel is not wired
    window.setTimeout(onBack, 850);
  }

  return (
    <Screen
      label="new ask"
      onBack={onBack}
      onSafe={onSafe}
      scroll
      contentStyle={{ paddingTop: 0 }}
    >
      {/* the lead */}
      <div
        style={{
          marginTop: 44,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
          lineHeight: 1.3,
        }}
      >
        <b style={{ fontWeight: 500 }}>what would help</b> right now
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 13,
          color: v2.mute,
          fontWeight: 400,
          lineHeight: 1.5,
        }}
      >
        pick a few. ollie turns them into a calm note you can send — so you
        don&rsquo;t have to find the words.
      </div>

      {/* the 4 categories */}
      {ASK_CATEGORIES.map((cat) => (
        <div key={cat.key} style={{ marginTop: 30 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span
              style={{
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
              {CATEGORY_GLYPH[cat.key]}
            </span>
            <span
              style={{
                fontSize: 11,
                color: v2.mute,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {cat.key}
            </span>
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 9 }}>
            {cat.options.map((opt) => (
              <Chip key={opt} on={picks.has(opt)} onToggle={() => toggle(opt)}>
                {opt}
              </Chip>
            ))}
          </div>
        </div>
      ))}

      {/* the note preview — ollie's calm sentence from the picks */}
      <div
        style={{
          marginTop: 34,
          border: `1.5px solid ${v2.line}`,
          borderRadius: 14,
          background: v2.card,
          padding: '16px 17px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          ollie&rsquo;s note
        </div>
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 15,
            color: picks.size > 0 ? v2.ink : v2.mute,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            lineHeight: 1.5,
          }}
        >
          {picks.size > 0 ? `“${note}”` : note}
        </p>
      </div>

      {/* the one commit */}
      <AmberButton
        block
        icon={<IconShare size={18} />}
        onClick={send}
        disabled={picks.size === 0}
        style={{ marginTop: 22, opacity: picks.size > 0 ? 1 : 0.45 }}
      >
        send the ask
      </AmberButton>
      <div
        style={{
          marginTop: 13,
          fontSize: 12,
          color: v2.mute,
          fontWeight: 400,
          textAlign: 'center',
          letterSpacing: '0.005em',
        }}
      >
        {sent
          ? 'saved — your ask is ready to share.'
          : 'goes to your partner in Ollie — or send as a plain message to anyone'}
      </div>
    </Screen>
  );
}
