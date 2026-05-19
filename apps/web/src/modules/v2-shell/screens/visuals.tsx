/**
 * v2-shell · homepage micro-visuals
 *
 * The small calm data objects in the gutter of each homepage card —
 * lifted verbatim from body.html / home.html / work.html. Each is a tiny
 * SVG: ink + one accent, never a loud chart, sage marks an observed thing.
 *
 * They are static (the mockups draw fixed example data); the glance line
 * next to them carries the live numbers. Keeping them static is correct —
 * the v2 mockups themselves are static-shape, data-on-the-line designs.
 */
import { v2 } from '../../money-v2/v2';

/** cycle — a phase ring: sage luteal arc + travelling day marker (body.html) */
export function CyclePhaseRing() {
  return (
    <svg width={46} height={46} viewBox="0 0 46 46" aria-hidden>
      <circle cx="23" cy="23" r="18" stroke={v2.line} strokeWidth={3} fill="none" />
      <circle
        cx="23"
        cy="23"
        r="18"
        stroke={v2.sage}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        strokeDasharray="50 63"
        strokeDashoffset="-63"
        transform="rotate(-90 23 23)"
      />
      <circle cx="40.3" cy="28.4" r="4" fill={v2.sage} />
    </svg>
  );
}

/** sleep — a 7-night bar chart, last night in amber (body.html) */
export function SleepBars() {
  const heights = [24, 32, 18, 29, 38, 22, 30];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 46, paddingBottom: 5, position: 'relative' }}>
      <span style={{ position: 'absolute', left: 0, right: 0, bottom: 3, height: 1.5, borderRadius: 1, background: v2.line }} />
      {heights.map((h, i) => (
        <span
          key={`bar-${i}`}
          style={{
            width: 7,
            height: h,
            background: i === heights.length - 1 ? v2.accent : v2.mute,
            borderRadius: 2.5,
            display: 'block',
            position: 'relative',
            zIndex: 1,
          }}
        />
      ))}
    </div>
  );
}

/** body — a filling vessel, water to 4/8 (body.html) */
export function WaterGlass() {
  return (
    <svg width={34} height={46} viewBox="0 0 34 46" aria-hidden>
      <clipPath id="v2ShellCup">
        <path d="M7.5 5 L26.5 5 L24.8 35 Q24.4 41 17 41 Q9.6 41 9.2 35 Z" />
      </clipPath>
      <g clipPath="url(#v2ShellCup)">
        <rect x="6" y="23" width="22" height="20" fill={v2.sage} opacity={0.88} />
        <line x1="6" y1="23.4" x2="28" y2="23.4" stroke="#fff" strokeWidth={1} opacity={0.45} />
      </g>
      <path d="M7 4 L27 4 L25.1 35 Q24.6 42 17 42 Q9.4 42 8.9 35 Z" stroke={v2.ink} strokeWidth={1.6} fill="none" />
    </svg>
  );
}

/** medication — a day timeline: taken dose, now-tick, next dose (body.html) */
export function MedTimeline() {
  return (
    <svg width={50} height={46} viewBox="0 0 50 46" aria-hidden>
      <line x1="5" y1="26" x2="45" y2="26" stroke={v2.line} strokeWidth={2} strokeLinecap="round" />
      <circle cx="14" cy="26" r="3.4" fill={v2.ink} />
      <line x1="24" y1="26" x2="24" y2="16" stroke={v2.mute} strokeWidth={1.5} strokeLinecap="round" />
      <circle cx="34" cy="26" r="4.6" stroke={v2.accent} strokeWidth={1.6} fill={v2.paper} />
      <circle cx="34" cy="26" r="2" fill={v2.accent} />
    </svg>
  );
}

/** habits — an open 270° progress gauge, filled 3/6 (body.html / work.html) */
export function ProgressGauge({ fill = 40 }: { fill?: number }) {
  return (
    <svg width={46} height={46} viewBox="0 0 46 46" aria-hidden>
      <circle
        cx="23"
        cy="23"
        r="17"
        stroke={v2.line}
        strokeWidth={3.5}
        fill="none"
        strokeLinecap="round"
        strokeDasharray="80.1 26.7"
        transform="rotate(135 23 23)"
      />
      <circle
        cx="23"
        cy="23"
        r="17"
        stroke={v2.ink}
        strokeWidth={3.5}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${(fill / 100) * 80.1} ${106.8 - (fill / 100) * 80.1}`}
        transform="rotate(135 23 23)"
      />
    </svg>
  );
}

/** admin — a stack of waiting task-lines, the top one due in umber (home.html) */
export function TaskStack() {
  const lines = [
    { due: true, w: undefined as number | undefined },
    { due: false, w: 34 },
    { due: false, w: 26 },
    { due: false, w: 20 },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 56 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              border: `1.6px solid ${l.due ? v2.umber : v2.mute}`,
              background: l.due ? v2.umber : 'none',
              flexShrink: 0,
            }}
          />
          <span style={{ height: 5, borderRadius: 2.5, background: l.due ? v2.umber : v2.mute, flex: l.w ? `0 0 ${l.w}px` : 1 }} />
        </div>
      ))}
    </div>
  );
}

/** pets — per-pet care rings: one partial amber, one full sage (home.html) */
export function PetRings() {
  return (
    <div style={{ display: 'flex', gap: 9 }}>
      <svg width={30} height={30} viewBox="0 0 30 30" aria-hidden>
        <circle cx="15" cy="15" r="12" fill={v2.tile} />
        <circle cx="15" cy="15" r="13" stroke={v2.line} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        <circle cx="15" cy="15" r="13" stroke={v2.accent} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeDasharray="50.7 31" transform="rotate(-90 15 15)" />
        <text x="15" y="15" fontSize="12" fontWeight="700" fill={v2.ink} textAnchor="middle" dominantBaseline="central">M</text>
      </svg>
      <svg width={30} height={30} viewBox="0 0 30 30" aria-hidden>
        <circle cx="15" cy="15" r="12" fill={v2.tile} />
        <circle cx="15" cy="15" r="13" stroke={v2.sage} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        <text x="15" y="15" fontSize="12" fontWeight="700" fill={v2.ink} textAnchor="middle" dominantBaseline="central">T</text>
      </svg>
    </div>
  );
}

/** grocery — a mini torn-note list, one line struck (home.html) */
export function GroceryNote() {
  const lines = [
    { got: false, w: undefined as number | undefined },
    { got: true, w: undefined as number | undefined },
    { got: false, w: 40 },
    { got: false, w: 30 },
    { got: false, w: 22 },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: 58 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 1.5,
              border: `1.6px solid ${l.got ? v2.accent : v2.mute}`,
              background: l.got ? v2.accent : 'none',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              height: 4,
              borderRadius: 2,
              background: l.got ? v2.line : v2.mute,
              flex: l.w ? `0 0 ${l.w}px` : 1,
              maxWidth: l.got ? '60%' : undefined,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** work — a stack of matter file-tabs, the front one warm umber (work.html) */
export function MatterStack() {
  return (
    <svg width={50} height={46} viewBox="0 0 50 46" aria-hidden>
      <path
        stroke={v2.mute}
        strokeWidth={1.7}
        strokeLinejoin="round"
        fill="none"
        d="M12 13h14l3 3h13v22a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V15a2 2 0 0 1 2-2z"
      />
      <path
        stroke={v2.mute}
        strokeWidth={1.7}
        strokeLinejoin="round"
        fill="none"
        d="M9 19h14l3 3h13v22a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V21a2 2 0 0 1 2-2z"
      />
      <path
        stroke={v2.umber}
        strokeWidth={1.7}
        strokeLinejoin="round"
        fill="#F3E4D3"
        d="M6 25h14l3 3h13v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V27a2 2 0 0 1 2-2z"
      />
    </svg>
  );
}
