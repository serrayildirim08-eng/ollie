/**
 * partner-v2 · PartnerAskScreen — the 4-category ask flow (partner-ask.html)
 *
 * ONE focus: pick what you need. Four calm category blocks — material ·
 * touch · labor · emotional — each a small tailored glyph, the category
 * word, a few quiet option chips. As the user picks, `composeAskNote()`
 * turns the picks into ollie's calm note, shown live in a quiet preview
 * card so the user reads the words before they commit. One amber action
 * sends the ask; a quiet line under it states where the ask goes.
 *
 * Reached from my-partner's "new ask". The note is composed purely in
 * `selectors.ts` — this screen only owns the live selection state.
 */
import { useMemo, useState } from 'react';
import { Screen, Chip, AmberButton, IconShare, IconHeart, IconHome, IconChat, v2 } from '../../money-v2/v2';
import {
  askFlowVM,
  emptyAskSelection,
  type AskCategory,
  type AskSelection,
  type PartnerState,
} from '../selectors';

export interface PartnerAskScreenProps {
  state: PartnerState;
  /** record the ask the user sent — appends to the stub history */
  onSend: (kind: AskCategory) => void;
  onBack: () => void;
  onSafe: () => void;
}

/** the tailored glyph for each ask category */
function CategoryGlyph({ category }: { category: AskCategory }) {
  const common = { size: 15 as const, stroke: v2.sage, weight: 1.8 };
  switch (category) {
    case 'material':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={v2.sage} strokeWidth={1.8} aria-hidden>
          <path d="M6 7h12l-1 13H7zM9 7V5a3 3 0 0 1 6 0v2" />
        </svg>
      );
    case 'touch':
      return <IconHeart {...common} />;
    case 'labor':
      return <IconHome {...common} />;
    case 'emotional':
    default:
      return <IconChat {...common} />;
  }
}

export function PartnerAskScreen({
  state,
  onSend,
  onBack,
  onSafe,
}: PartnerAskScreenProps) {
  const [selection, setSelection] = useState<AskSelection>(emptyAskSelection);
  const [sent, setSent] = useState(false);

  const vm = useMemo(() => askFlowVM(state, selection), [state, selection]);

  const toggle = (category: AskCategory, key: string) => {
    setSelection((sel) => {
      const picked = sel[category];
      const next = picked.includes(key)
        ? picked.filter((k) => k !== key)
        : [...picked, key];
      return { ...sel, [category]: next };
    });
  };

  const handleSend = () => {
    if (!vm.canSend) return;
    // the headline category — the first category with a pick, in render order
    const lead = vm.categories.find((c) => selection[c.category].length > 0);
    if (lead) onSend(lead.category);
    setSent(true);
    window.setTimeout(() => onBack(), 900);
  };

  // a calm confirmation stage once the ask is sent
  if (sent) {
    return (
      <Screen
        label="new ask"
        onBack={onBack}
        onSafe={onSafe}
        centered
        contentStyle={{ paddingTop: 0 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 300, color: v2.ink, letterSpacing: '-0.02em' }}>
            sent to {vm.partnerName}.
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: v2.mute, fontWeight: 400, lineHeight: 1.55 }}>
            ollie&rsquo;s note is on its way. you don&rsquo;t have to say anything else.
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen label="new ask" onBack={onBack} onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      {/* the lead — one calm line */}
      <div
        style={{
          marginTop: 30,
          fontSize: 22,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.02em',
          lineHeight: 1.3,
        }}
      >
        <b style={{ fontWeight: 500 }}>what would help</b> right now
      </div>
      <div style={{ marginTop: 8, fontSize: 13, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
        pick a few. ollie turns them into a calm note you can send &mdash; so you
        don&rsquo;t have to find the words.
      </div>

      {/* the 4 categories — material · touch · labor · emotional */}
      {vm.categories.map((cat) => (
        <div key={cat.category} style={{ marginTop: 30 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span
              aria-hidden
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
              <CategoryGlyph category={cat.category} />
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
              {cat.label}
            </span>
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 9 }}>
            {cat.options.map((opt) => (
              <Chip
                key={opt.key}
                on={selection[cat.category].includes(opt.key)}
                onToggle={() => toggle(cat.category, opt.key)}
              >
                {opt.label}
              </Chip>
            ))}
          </div>
        </div>
      ))}

      {/* the note preview — ollie's calm sentence from the picks */}
      <div
        style={{
          marginTop: 34,
          boxSizing: 'border-box',
          border: `1.5px solid ${v2.line}`,
          borderRadius: 14,
          background: v2.card,
          padding: '16px 17px',
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: v2.mute,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          ollie&rsquo;s note
        </span>
        <p
          style={{
            marginTop: 8,
            fontSize: 15,
            color: vm.canSend ? v2.ink : v2.mute,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            lineHeight: 1.5,
          }}
        >
          {vm.canSend ? `“${vm.note}”` : vm.note}
        </p>
      </div>

      {/* the one commit — full-width amber */}
      <AmberButton
        icon={<IconShare size={18} />}
        onClick={handleSend}
        disabled={!vm.canSend}
        block
        style={{
          marginTop: 22,
          opacity: vm.canSend ? 1 : 0.45,
          cursor: vm.canSend ? 'pointer' : 'not-allowed',
          boxShadow: vm.canSend ? v2.amberShadow : 'none',
        }}
      >
        send to {vm.partnerName}
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
        goes to {vm.partnerName} in Ollie &mdash; or send as a plain message to
        anyone
      </div>
    </Screen>
  );
}
