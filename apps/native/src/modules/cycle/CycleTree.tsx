/**
 * CycleTree · the cycle hero — a living olive tree rendered in SVG.
 *
 * Direct port of `~/Documents/ollie-cycle-tree.html`'s `tree()` drawing
 * logic + its sway / drift CSS. The tree is the cycle's *feeling*: it grows
 * a little each day (sprout → full crown → olives at ovulation) and sheds on
 * the period. Day number + phase render BELOW the tree, never overlaid.
 *
 * Geometry is reproduced 1:1 from the mock so the look stays design-locked:
 *   - crown sits LOW on the branches (cy biased down the trunk on young trees)
 *   - ~190 small 3-tone leaves scaled by growth, inside a swaying <g>
 *   - 2 short branches once grown a bit
 *   - bold olives at g > 0.72 scattered via phyllotaxis (golden-angle +
 *     sqrt radius — never a ring or a clump), deep fill + a tiny highlight
 *   - rooted in a soil mound (back + front) with root-flare strokes
 *
 * No Math.random (unavailable + non-deterministic) — scatter is an
 * index-hash via Math.sin, exactly like the mock's `rnd(seed)`.
 *
 * Motion: a gentle canopy sway always, plus drifting shed leaves on a period
 * day. Both honour `prefers-reduced-motion: reduce` via a scoped <style>.
 */

import { useId } from 'react';
import { colors, fonts } from '../../theme/tokens';

// ── palette (ported from the mock's CSS vars) ──────────────────────────────
// The mock used bespoke olive hues; keep them so the tree matches exactly,
// while the day/phase text uses the shared theme tokens.
const TRUNK = '#7a6a4a';
const LEAF = '#6f8a4f';
const LEAF2 = '#7d9a5b';
const ACCENT = '#566f33'; // == lightPalette.sage / sageDeep
const SOIL_BACK = '#9c8b69';
const SOIL_FRONT = '#8a7656';
const OLIVE = '#2a3320';

/** Deterministic index hash — the mock's `rnd(seed)`. Stable across renders. */
function rnd(seed: number): number {
  const x = Math.sin(seed * 99.7) * 43758.5453;
  return x - Math.floor(x);
}

interface DrawnTree {
  /** static layer: ground + trunk + branches + fallen pile. */
  base: string;
  /** swaying layer: leaves + olives. */
  canopy: string;
  /** drifting layer: shed leaves mid-air (period only). */
  falling: string;
}

/**
 * Build the three SVG-fragment layers for the tree at a given growth/shed.
 * Pure string assembly — mirrors the mock's `tree()` exactly, including all
 * coefficients, so the rendered shape is identical.
 */
function drawTree(W: number, H: number, growth: number, shedding: boolean): DrawnTree {
  const cx = W / 2;
  const groundY = H - 24;
  const g = Math.max(0, Math.min(1, growth));
  const shed = shedding;
  const s = H / 248; // scale factor — hero (H=248) is the reference size

  let out = ''; // static
  let canopy = ''; // swaying
  let falling = ''; // drifting

  // ground — a soft soil patch the tree is rooted in (back layer)
  out += `<line x1="${cx - 46 * s}" y1="${groundY}" x2="${cx + 46 * s}" y2="${groundY}" stroke="rgba(86,90,60,.18)" stroke-width="1.5" stroke-linecap="round"/>`;
  out += `<ellipse cx="${cx}" cy="${(groundY + 2.5 * s).toFixed(1)}" rx="${(30 * s).toFixed(1)}" ry="${(8 * s).toFixed(1)}" fill="${SOIL_BACK}" opacity="0.40"/>`;

  // trunk grows taller with growth
  const trunkH = (54 + 56 * g) * s;
  const topY = groundY - trunkH;
  out += `<path d="M ${cx} ${groundY} C ${cx - 6 * s} ${groundY - trunkH * 0.5} ${cx + 5 * s} ${groundY - trunkH * 0.7} ${cx} ${topY}" stroke="${TRUNK}" stroke-width="${(5 + 3 * g) * s}" fill="none" stroke-linecap="round"/>`;

  // root flare — little roots spreading into the soil at the base
  out += `<path d="M ${cx} ${(groundY - 3 * s).toFixed(1)} q ${-7 * s} ${5 * s} ${-14 * s} ${6 * s}" stroke="${TRUNK}" stroke-width="${(3 * s).toFixed(1)}" fill="none" stroke-linecap="round"/>`;
  out += `<path d="M ${cx} ${(groundY - 3 * s).toFixed(1)} q ${7 * s} ${5 * s} ${14 * s} ${6 * s}" stroke="${TRUNK}" stroke-width="${(3 * s).toFixed(1)}" fill="none" stroke-linecap="round"/>`;

  // front soil mound — drawn over the root ends so they emerge from the dirt
  out += `<ellipse cx="${cx}" cy="${(groundY + 3 * s).toFixed(1)}" rx="${(19 * s).toFixed(1)}" ry="${(6.5 * s).toFixed(1)}" fill="${SOIL_FRONT}" opacity="0.6"/>`;

  // a couple of branches once grown a bit
  if (g > 0.25) {
    out += `<path d="M ${cx} ${topY + 22 * s} q ${-22 * s} ${-6 * s} ${-34 * s} ${-22 * s}" stroke="${TRUNK}" stroke-width="${(3 + 1.5 * g) * s}" fill="none" stroke-linecap="round"/>`;
    out += `<path d="M ${cx} ${topY + 34 * s} q ${22 * s} ${-4 * s} ${34 * s} ${-20 * s}" stroke="${TRUNK}" stroke-width="${(3 + 1.5 * g) * s}" fill="none" stroke-linecap="round"/>`;
  }

  // canopy: a tight, FULL crown. Crown sits ON the branches; on YOUNGER
  // (smaller-growth) trees it starts lower down the trunk so a sprout isn't a
  // bare stick with a tuft on top.
  const canopyR = (15 + 46 * g) * s;
  const cy = topY + canopyR * 0.18 + trunkH * 0.24 * (1 - g);
  const leafRx = 6 * s;
  const leafRy = 2.8 * s;
  const maxLeaves = 190;
  const n = Math.round(maxLeaves * g);
  for (let i = 0; i < n; i++) {
    const a = rnd(i + 1) * Math.PI * 2;
    const rr = Math.sqrt(rnd(i + 7)) * canopyR;
    const lx = cx + Math.cos(a) * rr;
    // bias the crown taller-than-wide so leaves run from the branches upward
    const ly = cy + Math.sin(a) * rr * 1.02 - canopyR * 0.25;
    const rot = rnd(i + 13) * 180;
    const r3 = rnd(i + 3);
    const col = r3 > 0.62 ? LEAF2 : r3 > 0.28 ? LEAF : ACCENT;
    canopy += `<ellipse cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" rx="${leafRx.toFixed(1)}" ry="${leafRy.toFixed(1)}" fill="${col}" transform="rotate(${rot.toFixed(0)} ${lx.toFixed(1)} ${ly.toFixed(1)})" opacity="0.97"/>`;
  }

  // olives — appear as growth peaks; drawn LAST so they sit on top of the
  // leaves. Phyllotaxis scatter (golden-angle + sqrt radius) fills the crown
  // disk naturally — never a ring or a clump.
  if (g > 0.72 && !shed) {
    const nOlive = 5;
    for (let i = 0; i < nOlive; i++) {
      const ang = i * 2.39996 + 0.7;
      const rr = canopyR * 0.82 * Math.sqrt((i + 0.5) / nOlive) + canopyR * 0.06 * (rnd(i + 50) - 0.5);
      const ox = cx + Math.cos(ang) * rr;
      const oy = cy + Math.sin(ang) * rr * 0.82 + canopyR * 0.06;
      const orr = 4.6 * s;
      canopy += `<circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="${orr.toFixed(1)}" fill="${OLIVE}"/>`;
      canopy += `<circle cx="${(ox - orr * 0.3).toFixed(1)}" cy="${(oy - orr * 0.3).toFixed(1)}" r="${(orr * 0.28).toFixed(1)}" fill="rgba(255,255,255,.4)"/>`;
    }
  }

  // shedding: a few leaves drifting down + a small pile on the ground
  if (shed) {
    for (let i = 0; i < 6; i++) {
      const fx = cx - 30 * s + rnd(i + 60) * 60 * s;
      const fy = topY + 16 * s + rnd(i + 70) * (trunkH - 16 * s);
      falling += `<ellipse class="ollie-cycletree-falling" style="animation-delay:${(rnd(i + 85) * -3).toFixed(2)}s" cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" rx="${leafRx.toFixed(1)}" ry="${leafRy.toFixed(1)}" fill="${LEAF}" opacity="0.6"/>`;
    }
    for (let i = 0; i < 5; i++) {
      const px = cx - 28 * s + rnd(i + 90) * 56 * s;
      out += `<ellipse cx="${px.toFixed(1)}" cy="${(groundY - 2).toFixed(1)}" rx="${leafRx.toFixed(1)}" ry="${(leafRy * 0.9).toFixed(1)}" fill="${LEAF}" opacity="0.45"/>`;
    }
  }

  return { base: out, canopy, falling };
}

// keyframes ported verbatim from the mock; scoped to this component's class
// names. prefers-reduced-motion freezes both animations.
const MOTION_CSS = `
@keyframes ollie-cycletree-sway { 0%,100%{transform:rotate(-1.3deg)} 50%{transform:rotate(1.3deg)} }
@keyframes ollie-cycletree-drift { 0%{transform:translateY(0) rotate(0)} 100%{transform:translateY(26px) rotate(40deg)} }
.ollie-cycletree-sway { transform-box:fill-box; transform-origin:50% 100%; animation:ollie-cycletree-sway 5.5s ease-in-out infinite; }
.ollie-cycletree-falling { transform-box:fill-box; animation:ollie-cycletree-drift 3.4s ease-in infinite alternate; }
@media (prefers-reduced-motion: reduce){ .ollie-cycletree-sway,.ollie-cycletree-falling{animation:none;} }
`;

export function CycleTree({
  growth,
  shedding,
  day,
  phase,
  size = 240,
}: {
  growth: number;
  shedding: boolean;
  day: number;
  phase: string;
  size?: number;
}): JSX.Element {
  // viewBox follows the mock hero (240 × 248) so every coefficient lands the
  // same; the rendered <svg> scales to `size`.
  const W = 240;
  const H = 248;
  const { base, canopy, falling } = drawTree(W, H, growth, shedding);
  const styleId = useId();

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
    >
      <style>{MOTION_CSS}</style>
      <svg
        width={size}
        height={(size * H) / W}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: 'block', overflow: 'visible' }}
        role="img"
        aria-label={`cycle day ${day}, ${phase}${shedding ? ', shedding' : ''}`}
        // The three layers are emitted as raw SVG strings (the port keeps the
        // mock's exact draw order). dangerouslySetInnerHTML is safe here: every
        // value is numeric/derived, no user text reaches the markup.
        dangerouslySetInnerHTML={{
          __html:
            base +
            `<g class="ollie-cycletree-sway" id="${styleId}">${canopy}</g>` +
            falling,
        }}
      />
      {/* day + phase BELOW the tree — never overlaid. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'center',
          gap: 10,
          marginTop: 2,
        }}
      >
        <span
          style={{
            fontFamily: fonts.serif,
            fontSize: 40,
            fontWeight: 600,
            color: colors.ink,
            lineHeight: 1,
            letterSpacing: '-0.025em',
          }}
        >
          {day}
        </span>
        <span
          style={{
            fontFamily: fonts.sans,
            fontSize: 11,
            letterSpacing: '0.20em',
            textTransform: 'uppercase',
            color: colors.inkSoft,
          }}
        >
          {phase}
        </span>
      </div>
    </div>
  );
}
