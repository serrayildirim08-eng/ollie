import { useEffect, useRef } from 'react';

export interface BurhanTreeProps {
  height?: number;
  tone?: 'home' | 'garden';
  droop?: number;
  waterLevel?: number;
  onClick?: () => void;
}

type Variant = 'home' | 'garden';

interface Preset {
  baseW: number;
  baseH: number;
  trunkW: number;
  trunkH: number;
  depth: number;
  freeLeaves: number;
  leafPerBranch: [number, number];
  leafSize: [number, number];
  branchSpread: number;
  oliveChance: number;
  swayMul: number;
  treeY: number;
  sideBranches: boolean;
}

const PRESETS: Record<Variant, Preset> = {
  home: {
    baseW: 360, baseH: 440, trunkW: 20, trunkH: 180, depth: 5,
    freeLeaves: 120, leafPerBranch: [30, 52], leafSize: [6, 11],
    branchSpread: 0.7, oliveChance: 0.05, swayMul: 55, treeY: 0.85,
    sideBranches: true,
  },
  garden: {
    baseW: 480, baseH: 580, trunkW: 28, trunkH: 240, depth: 6,
    freeLeaves: 185, leafPerBranch: [40, 72], leafSize: [7, 13],
    branchSpread: 0.8, oliveChance: 0.06, swayMul: 70, treeY: 0.85,
    sideBranches: true,
  },
};

interface Branch {
  id: number;
  x1: number; y1: number;
  x2: number; y2: number;
  width: number;
  depth: number;
  curve: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
}

interface Leaf {
  free?: boolean;
  branchId?: number;
  px?: number; py?: number;
  t?: number;
  ox: number; oy: number;
  size: number;
  rot: number;
  fAmp: number;
  fFreq: number;
  fPh: number;
  shade: number;
  lift: number;
}

interface Olive {
  branchId: number;
  t: number;
  ox: number; oy: number;
  rx: number; ry: number;
  rot: number;
  dark: boolean;
}

export function BurhanTree({
  height = 220,
  tone = 'home',
  droop = 0,
  waterLevel = 50,
  onClick,
}: BurhanTreeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);

  // Derive width from aspect ratio of the preset
  const cfg = PRESETS[tone];
  const aspectRatio = cfg.baseW / cfg.baseH;
  const resolvedHeight = Math.max(50, height);
  const resolvedWidth = Math.round(resolvedHeight * aspectRatio);

  const desat = Math.min(Math.max(droop, 0) / 100, 1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctxOrNull = canvas.getContext('2d');
    if (!ctxOrNull) return;
    const ctx: CanvasRenderingContext2D = ctxOrNull;

    const w = resolvedWidth;
    const h = resolvedHeight;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Respect prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let destroyed = false;

    const rand = (a: number, b: number) => Math.random() * (b - a) + a;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

    function hash(n: number): number {
      const x = Math.sin(n * 127.1) * 43758.5453123;
      return x - Math.floor(x);
    }
    function noise1(x: number): number {
      const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
      return lerp(hash(i), hash(i + 1), u);
    }

    const branches: Branch[] = [];
    const leaves: Leaf[] = [];
    const olives: Olive[] = [];

    const sx = w / cfg.baseW, sy = h / cfg.baseH, sc = Math.min(sx, sy);
    const tx = w * 0.5, ty = h * cfg.treeY;
    const maxDepth = cfg.depth;
    const SM = cfg.swayMul;

    function addBranch(
      x1: number, y1: number, len: number, angle: number,
      bw: number, depth: number, swayAmp: number, sideBias: number
    ) {
      if (depth <= 0 || len < 8 * sc) return;
      const id = branches.length;
      const curve = rand(-0.35, 0.35) + sideBias * 0.12;
      const x2 = x1 + Math.cos(angle) * len;
      const y2 = y1 + Math.sin(angle) * len;
      branches.push({
        id, x1, y1, x2, y2, width: bw, depth, curve,
        swayAmp, swayFreq: rand(0.7, 1.4), swayPhase: rand(0, Math.PI * 2),
      });
      if (depth <= 2) {
        const lc = Math.floor(rand(cfg.leafPerBranch[0], cfg.leafPerBranch[1]));
        for (let i = 0; i < lc; i++) {
          const t = rand(0.15, 1), sp = (1 - t) * 10 * sc + 12 * sc;
          leaves.push({
            branchId: id, t,
            ox: rand(-sp, sp) * cfg.branchSpread,
            oy: rand(-sp * 0.6, sp * 0.6) * cfg.branchSpread,
            size: rand(cfg.leafSize[0], cfg.leafSize[1]) * sc,
            rot: rand(-1.2, 1.2),
            fAmp: rand(0.03, 0.13),
            fFreq: rand(1.2, 3.2),
            fPh: rand(0, Math.PI * 2),
            shade: rand(0, 1),
            lift: rand(-5, 5) * sc,
          });
          if (Math.random() < cfg.oliveChance) {
            olives.push({
              branchId: id, t,
              ox: rand(-sp * 0.6, sp * 0.6),
              oy: rand(-sp * 0.4, sp * 0.4),
              rx: rand(3, 5) * sc,
              ry: rand(4.5, 6.5) * sc,
              rot: rand(-0.8, 0.8),
              dark: Math.random() < 0.55,
            });
          }
        }
      }
      const cc = depth > maxDepth - 2 ? 2 : 3;
      for (let i = 0; i < cc; i++) {
        const dir = i === 0 ? -1 : i === 1 ? 1 : rand(-1, 1);
        addBranch(
          lerp(x1, x2, rand(0.5, 0.92)),
          lerp(y1, y2, rand(0.5, 0.92)),
          len * rand(0.62, 0.77),
          angle + dir * rand(0.25, 0.52) + rand(-0.12, 0.12),
          bw * rand(0.58, 0.73),
          depth - 1,
          swayAmp * 1.22,
          dir,
        );
      }
    }

    const th = cfg.trunkH * sc;
    addBranch(tx, ty, th, -Math.PI / 2, cfg.trunkW * sc, maxDepth, 0.012, 0);
    if (cfg.sideBranches && maxDepth >= 4) {
      addBranch(tx - 5 * sc, ty - th * 0.42, th * 0.72, -Math.PI / 2 - 0.55, cfg.trunkW * 0.55 * sc, maxDepth - 2, 0.018, -1);
      addBranch(tx + 4 * sc, ty - th * 0.46, th * 0.78, -Math.PI / 2 + 0.6, cfg.trunkW * 0.58 * sc, maxDepth - 2, 0.019, 1);
    }

    for (let i = 0; i < cfg.freeLeaves; i++) {
      const ang = rand(0, Math.PI * 2), r = Math.sqrt(Math.random());
      const cW = w * 0.42 * cfg.branchSpread, cH = h * 0.28 * cfg.branchSpread;
      leaves.push({
        free: true,
        px: tx + Math.cos(ang) * cW * r,
        py: ty - th * 0.92 + Math.sin(ang) * cH * r,
        ox: rand(-12, 12) * sc,
        oy: rand(-8, 8) * sc,
        size: rand(cfg.leafSize[0], cfg.leafSize[1]) * sc,
        rot: rand(-1.1, 1.1),
        fAmp: rand(0.04, 0.15),
        fFreq: rand(1.4, 3.6),
        fPh: rand(0, Math.PI * 2),
        shade: rand(0, 1),
        lift: rand(-5, 5) * sc,
      });
    }

    function getWind(t: number): number {
      if (prefersReducedMotion) return 0.3; // gentle static wind
      return (
        Math.sin(t * 0.55) * 0.55 +
        Math.pow(noise1(t * 0.23), 2) * 1.2 +
        Math.sin(t * 1.8 + 1.2) * 0.15
      ) * 0.9;
    }

    function getBP(b: Branch, t: number, wind: number) {
      const df = 1 + (maxDepth - b.depth) * 0.22;
      const sw = Math.sin(t * b.swayFreq + b.swayPhase) * b.swayAmp * df * wind;
      const dx = b.x2 - b.x1, dy = b.y2 - b.y1;
      const cx2 = (b.x1 + b.x2) * 0.5 + (-dy) * 0.08 * b.curve + sw * SM * 0.73 * sc;
      const cy2 = (b.y1 + b.y2) * 0.5 + dx * 0.04 * b.curve;
      const ex = b.x2 + sw * SM * sc;
      return (q: number) => {
        const iq = 1 - q;
        return {
          x: iq * iq * b.x1 + 2 * iq * q * cx2 + q * q * ex,
          y: iq * iq * b.y1 + 2 * iq * q * cy2 + q * q * b.y2,
          sway: sw,
        };
      };
    }

    function drawLeaf(
      x: number, y: number, sz: number,
      rot: number, shade: number, ls: number
    ) {
      const len = sz * 1.9, wid = sz * 0.46;
      const c1 = [110, 132, 88], c2 = [145, 160, 116];
      const r = Math.floor(lerp(c1[0], c2[0], shade) + ls * 10);
      const g = Math.floor(lerp(c1[1], c2[1], shade) + ls * 18);
      const b = Math.floor(lerp(c1[2], c2[2], shade) + ls * 9);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const gd = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
      gd.addColorStop(0, `rgba(${clamp(r - 12, 0, 255)},${clamp(g - 14, 0, 255)},${clamp(b - 10, 0, 255)},0.95)`);
      gd.addColorStop(0.45, `rgba(${clamp(r + 10, 0, 255)},${clamp(g + 12, 0, 255)},${clamp(b + 8, 0, 255)},0.98)`);
      gd.addColorStop(1, `rgba(${clamp(r - 20, 0, 255)},${clamp(g - 16, 0, 255)},${clamp(b - 12, 0, 255)},0.94)`);
      ctx.fillStyle = gd;
      ctx.beginPath();
      ctx.moveTo(-len / 2, 0);
      ctx.quadraticCurveTo(0, -wid, len / 2, 0);
      ctx.quadraticCurveTo(0, wid, -len / 2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(230,235,220,0.26)';
      ctx.lineWidth = Math.max(0.5, sz * 0.08);
      ctx.beginPath();
      ctx.moveTo(-len / 2 + 1, 0);
      ctx.lineTo(len / 2 - 1, 0);
      ctx.stroke();
      ctx.restore();
    }

    function drawOlive(
      x: number, y: number, rx: number, ry: number, rot: number, dark: boolean
    ) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      const gd = ctx.createRadialGradient(-rx * 0.3, -ry * 0.35, 1, 0, 0, ry * 1.6);
      if (dark) {
        gd.addColorStop(0, '#6f7b36');
        gd.addColorStop(0.45, '#4e5d27');
        gd.addColorStop(1, '#2f3818');
      } else {
        gd.addColorStop(0, '#93a54d');
        gd.addColorStop(0.45, '#74873d');
        gd.addColorStop(1, '#4d5a29');
      }
      ctx.fillStyle = gd;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.ellipse(-rx * 0.25, -ry * 0.3, rx * 0.2, ry * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function render(ms: number) {
      if (destroyed) return;
      const t = prefersReducedMotion ? 0 : ms * 0.001;
      const wind = getWind(t);

      ctx.clearRect(0, 0, w, h);

      // Ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      ctx.ellipse(
        tx + w * 0.08 + Math.sin(t * 0.7) * w * 0.02,
        ty + h * 0.02,
        w * 0.35,
        h * 0.04,
        -0.12,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      // Branches
      const sorted = [...branches].sort((a, b) => b.width - a.width);
      for (const b of sorted) {
        const df = 1 + (maxDepth - b.depth) * 0.22;
        const sw = Math.sin(t * b.swayFreq + b.swayPhase) * b.swayAmp * df * wind;
        const dx = b.x2 - b.x1, dy = b.y2 - b.y1;
        const mx = (b.x1 + b.x2) * 0.5 + (-dy) * 0.08 * b.curve + sw * SM * 0.73 * sc;
        const my = (b.y1 + b.y2) * 0.5 + dx * 0.04 * b.curve;
        const ex = b.x2 + sw * SM * sc;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#4f3826';
        ctx.lineWidth = b.width + 1.8 * sc;
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.quadraticCurveTo(mx, my, ex, b.y2);
        ctx.stroke();
        const bg = ctx.createLinearGradient(b.x1, b.y1, b.x2, b.y2);
        bg.addColorStop(0, '#6f523a');
        bg.addColorStop(0.5, '#866246');
        bg.addColorStop(1, '#5d4330');
        ctx.strokeStyle = bg;
        ctx.lineWidth = b.width;
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.quadraticCurveTo(mx, my, ex, b.y2);
        ctx.stroke();
      }

      // Leaves + olives — depth-sorted
      interface DrawItem {
        k: 'l' | 'o';
        x: number; y: number;
        size?: number; rot?: number; shade?: number; ls?: number;
        rx?: number; ry?: number; dark?: boolean;
        d: number;
      }
      const items: DrawItem[] = [];

      for (const lf of leaves) {
        let bx: number, by: number, si = 0;
        if (lf.free) {
          bx = lf.px!;
          by = lf.py!;
          si = Math.sin(t * 0.9 + lf.fPh) * 0.4 + wind * 0.4;
        } else {
          const b = branches[lf.branchId!];
          if (!b) continue;
          const p = getBP(b, t, wind)(lf.t!);
          bx = p.x;
          by = p.y;
          si = p.sway * SM * 0.36;
        }
        const fl = Math.sin(t * lf.fFreq + lf.fPh) * lf.fAmp;
        items.push({
          k: 'l',
          x: bx + lf.ox + si * 0.7,
          y: by + lf.oy + lf.lift + Math.cos(t * 1.3 + lf.fPh) * 1.2,
          size: lf.size,
          rot: lf.rot + fl + wind * 0.05,
          shade: lf.shade,
          ls: wind * 0.15 + fl * 0.5,
          d: by,
        });
      }

      for (const o of olives) {
        const b = branches[o.branchId];
        if (!b) continue;
        const p = getBP(b, t, wind)(o.t);
        items.push({
          k: 'o',
          x: p.x + o.ox + p.sway * SM * 0.25,
          y: p.y + o.oy,
          rx: o.rx,
          ry: o.ry,
          rot: o.rot + wind * 0.05,
          dark: o.dark,
          d: p.y + o.oy + 1,
        });
      }

      items.sort((a, b) => a.d - b.d);

      for (const it of items) {
        if (it.k === 'l') {
          drawLeaf(it.x, it.y, it.size!, it.rot!, it.shade!, it.ls!);
        } else {
          drawOlive(it.x, it.y, it.rx!, it.ry!, it.rot!, it.dark!);
        }
      }

      if (prefersReducedMotion) return; // single static frame, no RAF loop

      if (document.hidden) {
        animRef.current = null;
        return;
      }
      animRef.current = requestAnimationFrame(render);
    }

    animRef.current = requestAnimationFrame(render);

    const onVis = () => {
      if (!destroyed && !document.hidden && !animRef.current) {
        animRef.current = requestAnimationFrame(render);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      destroyed = true;
      document.removeEventListener('visibilitychange', onVis);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = null;
    };
  }, [tone, resolvedWidth, resolvedHeight, droop, waterLevel]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? 'burhan the olive tree' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={{
        width: resolvedWidth,
        height: resolvedHeight,
        display: 'block',
        cursor: onClick ? 'pointer' : 'default',
        filter: `saturate(${1 - desat * 0.4}) brightness(${1 - desat * 0.12})`,
        transition: 'filter 600ms ease',
      }}
    />
  );
}
