/**
 * v2-shell · ModulesScreen — the 4 rooms (modules.html)
 *
 * DIRECTION.md Level 1: "money · body · home · work as four calm rooms,
 * one word each. no titles, no counts." It is the fourth panel of the
 * capture deck (dot 4 of 4). Tapping a room asks the shell to push that
 * module's homepage.
 *
 * Built from modules.html verbatim — four `.room` cards, soft glyph tile,
 * 27px room word. Find + Safe come from the shell chrome painted over the
 * whole deck, so this screen renders only the rooms.
 */
import { v2 } from '../../money-v2/v2';
import type { ModuleKey } from '../types';

const box = { boxSizing: 'border-box' as const };

export interface ModulesScreenProps {
  onOpenModule: (module: ModuleKey) => void;
  /**
   * open the settings screen. The modules panel is the app's "map", so a
   * quiet settings link lives here — the one place the v2 IA reaches the
   * (still hand-built) settings screen. Optional: omitted by bare hosts.
   */
  onSettings?: () => void;
}

interface Room {
  key: ModuleKey;
  word: string;
  glyph: JSX.Element;
}

const ROOMS: Room[] = [
  {
    key: 'money',
    word: 'money',
    glyph: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10M9.5 9.2a2.5 2 0 0 1 5 0c0 2.6-5 1.4-5 4a2.5 2 0 0 0 5 0" />
      </>
    ),
  },
  {
    key: 'body',
    word: 'body',
    glyph: <path d="M12 21c-1-6-7-7-7-12a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5-6 6-7 12z" />,
  },
  {
    key: 'home',
    word: 'home',
    glyph: <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5" />,
  },
  {
    key: 'work',
    word: 'work',
    glyph: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </>
    ),
  },
];

export function ModulesScreen({ onOpenModule, onSettings }: ModulesScreenProps) {
  return (
    <div
      style={{
        ...box,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 14,
        padding: '0 30px',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {ROOMS.map((room) => (
        <button
          key={room.key}
          type="button"
          onClick={() => onOpenModule(room.key)}
          aria-label={room.word}
          style={{
            ...box,
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            padding: 22,
            background: v2.card,
            border: `1px solid ${v2.line}`,
            borderRadius: 24,
            boxShadow: '0 12px 30px rgba(42,38,34,.05)',
            cursor: 'pointer',
            textAlign: 'left',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span
            aria-hidden
            style={{
              ...box,
              width: 54,
              height: 54,
              borderRadius: 16,
              background: v2.tile,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={v2.accent} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              {room.glyph}
            </svg>
          </span>
          <span style={{ fontSize: 27, fontWeight: 400, color: v2.ink, letterSpacing: '-.015em' }}>
            {room.word}
          </span>
        </button>
      ))}

      {/* a quiet settings link — the v2 IA's one route to the hand-built
          settings screen (sign-out, consent, security). Low-emphasis on
          purpose: settings is rare app-config, not a daily room. */}
      {onSettings && (
        <button
          type="button"
          onClick={onSettings}
          aria-label="settings"
          style={{
            ...box,
            alignSelf: 'center',
            marginTop: 6,
            padding: '8px 18px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            color: v2.mute,
            letterSpacing: '.03em',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          settings
        </button>
      )}
    </div>
  );
}
