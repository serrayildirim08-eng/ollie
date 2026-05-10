import React, { useEffect, useRef, useState } from 'react';
import { BurhanTree } from '../components/BurhanTree';

// ─── types ────────────────────────────────────────────────────────────────────

export interface GardenStats {
  growth: number;   // 0–1
  water: number;    // 0–1
  health: 'thriving' | 'thirsty';
}

export interface GardenScreenProps {
  onNavigate: (to: 'home') => void;
  onWater?: () => void;
  stats?: GardenStats;
}

const DEFAULT_STATS: GardenStats = { growth: 0.42, water: 0.72, health: 'thriving' };

// ─── CSS keyframes (injected once) ───────────────────────────────────────────

const GARDEN_STYLES = `
@keyframes gardenFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes gardenSlideUp {
  from { opacity: 0; transform: translateY(18px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes cloudDrift1 {
  0%   { transform: translateX(0); }
  100% { transform: translateX(38px); }
}
@keyframes cloudDrift2 {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-28px); }
}
@keyframes petalDrift {
  0%   { transform: translateX(0) translateY(0) rotate(0deg); opacity: 0.7; }
  60%  { opacity: 0.5; }
  100% { transform: translateX(var(--px, 80px)) translateY(var(--py, 140px)) rotate(var(--pr, 180deg)); opacity: 0; }
}
@keyframes flamePulse {
  0%,100% { opacity: 0.8; transform: scaleY(1); }
  50%      { opacity: 0.55; transform: scaleY(0.88); }
}
@keyframes waterRipple {
  0%   { opacity: 0.7; transform: scale(1); }
  100% { opacity: 0;   transform: scale(1.6); }
}
@keyframes shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@keyframes dropletFall {
  0%   { opacity: 0.9; transform: translateY(0); }
  100% { opacity: 0;   transform: translateY(120px); }
}
@keyframes treeGlow {
  0%   { filter: brightness(1) drop-shadow(0 0 0px rgba(100,180,100,0)); }
  40%  { filter: brightness(1.08) drop-shadow(0 0 18px rgba(100,200,100,0.45)); }
  100% { filter: brightness(1) drop-shadow(0 0 0px rgba(100,180,100,0)); }
}

@media (prefers-reduced-motion: reduce) {
  .garden-cloud, .garden-petal, .garden-flame,
  .garden-ripple, .garden-shimmer, .garden-droplet { animation: none !important; }
}
`;

function injectStyles() {
  if (document.getElementById('garden-screen-styles')) return;
  const el = document.createElement('style');
  el.id = 'garden-screen-styles';
  el.textContent = GARDEN_STYLES;
  document.head.appendChild(el);
}

// ─── sub-components ───────────────────────────────────────────────────────────

function Cloud1() {
  return (
    <svg
      className="garden-cloud"
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: '6%',
        left: '8%',
        opacity: 0.55,
        animation: 'cloudDrift1 22s ease-in-out infinite alternate',
      }}
      width="180"
      height="55"
      viewBox="0 0 180 55"
    >
      <defs>
        <filter id="gc1">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
      </defs>
      <ellipse cx="90" cy="32" rx="80" ry="20" fill="white" filter="url(#gc1)" opacity="0.7" />
      <ellipse cx="60" cy="26" rx="45" ry="15" fill="white" filter="url(#gc1)" opacity="0.75" />
      <ellipse cx="125" cy="26" rx="50" ry="16" fill="white" filter="url(#gc1)" opacity="0.65" />
    </svg>
  );
}

function Cloud2() {
  return (
    <svg
      className="garden-cloud"
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: '14%',
        left: '54%',
        opacity: 0.45,
        animation: 'cloudDrift2 30s ease-in-out infinite alternate',
      }}
      width="140"
      height="45"
      viewBox="0 0 140 45"
    >
      <defs>
        <filter id="gc2">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <ellipse cx="70" cy="25" rx="60" ry="17" fill="white" filter="url(#gc2)" opacity="0.65" />
      <ellipse cx="45" cy="20" rx="35" ry="13" fill="white" filter="url(#gc2)" opacity="0.7" />
    </svg>
  );
}

// Stone arch with trailing vine + bougainvillea
function StoneArch({ cx, width }: { cx: string; width: number }) {
  return (
    <svg
      aria-hidden="true"
      style={{ position: 'absolute', top: 0, left: cx, width }}
      viewBox="0 0 200 300"
      preserveAspectRatio="none"
    >
      {/* Arch pillars */}
      <rect x="0" y="80" width="28" height="220" fill="#D4C8B0" stroke="#C0B49C" strokeWidth="0.5" />
      <rect x="172" y="80" width="28" height="220" fill="#C8BC9C" stroke="#C0B49C" strokeWidth="0.5" />
      {/* Arch curve */}
      <path
        d="M0 80 Q0 0 100 0 Q200 0 200 80"
        fill="none"
        stroke="#C8BC9C"
        strokeWidth="28"
        strokeLinecap="butt"
      />
      {/* Block lines */}
      {[100, 130, 160, 190, 220, 250].map((y) => (
        <line key={y} x1={2} y1={y} x2={26} y2={y} stroke="#B8AA90" strokeWidth="0.8" opacity="0.4" />
      ))}
      {/* Vine */}
      <path
        d="M14 80 Q8 120 12 160 Q6 200 10 240"
        fill="none"
        stroke="#5A7A3A"
        strokeWidth="1.5"
        opacity="0.7"
      />
      {/* Vine leaves */}
      {[100, 130, 160, 200, 230].map((y, i) => (
        <ellipse
          key={i}
          cx={14 + (i % 2 === 0 ? -8 : 8)}
          cy={y}
          rx="6"
          ry="3"
          fill="#5A7A3A"
          opacity="0.65"
          transform={`rotate(${i % 2 === 0 ? -30 : 30}, ${14 + (i % 2 === 0 ? -8 : 8)}, ${y})`}
        />
      ))}
      {/* Bougainvillea clusters */}
      {[95, 115, 135, 155].map((y, i) => (
        <g key={i}>
          <circle cx={14 + (i % 2 === 0 ? -10 : 10)} cy={y} r={4} fill="#D4889A" opacity="0.75" />
          <circle cx={14 + (i % 2 === 0 ? -6 : 6)} cy={y - 4} r={3} fill="#C47A8C" opacity="0.65" />
          <circle cx={14 + (i % 2 === 0 ? -12 : 12)} cy={y + 4} r={2.5} fill="#E0A0B0" opacity="0.6" />
        </g>
      ))}
    </svg>
  );
}

// Terracotta pot with plant
function TerraCottaPot({
  style,
  scale = 1,
}: {
  style: React.CSSProperties;
  scale?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      style={{ ...style, transform: `scale(${scale})`, transformOrigin: 'bottom center' }}
      width="55"
      height="72"
      viewBox="0 0 55 72"
    >
      <defs>
        <linearGradient id={`pot-g-${Math.round(scale * 100)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C97B4B" />
          <stop offset="100%" stopColor="#A85C30" />
        </linearGradient>
      </defs>
      <path d="M10 26 L7 58 Q7 65 48 65 L48 58 L45 26 Z" fill={`url(#pot-g-${Math.round(scale * 100)})`} opacity="0.9" />
      <rect x="7" y="22" width="41" height="6" rx="2" fill="#D4916A" opacity="0.85" />
      <line x1="14" y1="35" x2="12" y2="54" stroke="#C06838" strokeWidth="0.8" opacity="0.25" />
      <line x1="40" y1="35" x2="42" y2="54" stroke="#C06838" strokeWidth="0.8" opacity="0.25" />
      <path d="M27 22 Q25 13 21 5" stroke="#4A6A38" strokeWidth="1.4" fill="none" opacity="0.7" />
      <path d="M27 22 Q29 11 34 4" stroke="#4A6A38" strokeWidth="1.4" fill="none" opacity="0.7" />
      <path d="M27 22 Q27 10 27 1" stroke="#4A6A38" strokeWidth="1.4" fill="none" opacity="0.7" />
      {[
        [21, 5], [34, 4], [27, 1], [19, 10], [35, 9], [23, 14], [31, 13],
      ].map(([x, y], i) => (
        <ellipse
          key={i}
          cx={x}
          cy={y}
          rx="4"
          ry="1.5"
          fill="#5A7A45"
          opacity="0.62"
          transform={`rotate(${i * 28}, ${x}, ${y})`}
        />
      ))}
    </svg>
  );
}

// Brass lantern with flickering flame
function BrassLantern({ style }: { style: React.CSSProperties }) {
  return (
    <svg aria-hidden="true" style={style} width="22" height="46" viewBox="0 0 22 46">
      {/* Hook */}
      <line x1="11" y1="0" x2="11" y2="6" stroke="#B8963C" strokeWidth="1.5" />
      {/* Top cap */}
      <path d="M5 8 L17 8 L15 14 L7 14 Z" fill="#C8A040" stroke="#B8963C" strokeWidth="0.5" />
      {/* Body */}
      <rect x="6" y="14" width="10" height="18" rx="1" fill="#D4AA48" stroke="#B8963C" strokeWidth="0.5" opacity="0.85" />
      {/* Glass panels */}
      <rect x="7" y="15" width="3.5" height="16" rx="0.5" fill="rgba(255,240,160,0.35)" />
      <rect x="11.5" y="15" width="3.5" height="16" rx="0.5" fill="rgba(255,240,160,0.25)" />
      {/* Base */}
      <path d="M5 32 L17 32 L16 38 L6 38 Z" fill="#C8A040" stroke="#B8963C" strokeWidth="0.5" />
      {/* Foot */}
      <rect x="7" y="38" width="8" height="3" rx="1" fill="#B8903A" />
      {/* Flame */}
      <ellipse
        className="garden-flame"
        cx="11"
        cy="24"
        rx="2"
        ry="3.5"
        fill="rgba(255,200,60,0.85)"
        style={{ animation: 'flamePulse 1.8s ease-in-out infinite', transformOrigin: '11px 26px' }}
      />
      <ellipse cx="11" cy="25" rx="1.2" ry="2" fill="rgba(255,240,140,0.7)" />
    </svg>
  );
}

// Reflecting pool
function ReflectingPool({ waterLevel }: { waterLevel: number }) {
  const waterAlpha = 0.3 + waterLevel * 0.35;
  return (
    <svg
      aria-hidden="true"
      style={{
        position: 'absolute',
        bottom: '20%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 3,
      }}
      width="340"
      height="100"
      viewBox="0 0 340 100"
    >
      {/* Stone rim */}
      <ellipse cx="170" cy="65" rx="160" ry="34" fill="#B8A888" opacity="0.5" />
      {/* Water */}
      <ellipse cx="170" cy="66" rx="152" ry="28" fill={`rgba(100,180,210,${waterAlpha})`} />
      {/* Shimmer stripe */}
      <clipPath id="pool-clip">
        <ellipse cx="170" cy="66" rx="152" ry="28" />
      </clipPath>
      <rect
        className="garden-shimmer"
        x="-10"
        y="50"
        width="60"
        height="36"
        fill="rgba(255,255,255,0.18)"
        clipPath="url(#pool-clip)"
        style={{ animation: 'shimmer 4s ease-in-out infinite' }}
      />
      {/* Ripples */}
      <ellipse
        className="garden-ripple"
        cx="140"
        cy="68"
        rx="22"
        ry="7"
        fill="none"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="0.8"
        style={{ animation: 'waterRipple 3.5s ease-out infinite' }}
      />
      <ellipse
        className="garden-ripple"
        cx="200"
        cy="64"
        rx="16"
        ry="5"
        fill="none"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="0.8"
        style={{ animation: 'waterRipple 3.5s ease-out 1.8s infinite' }}
      />
      {/* Floating petals on pool */}
      {[
        [130, 62],
        [160, 70],
        [190, 60],
        [215, 68],
      ].map(([px, py], i) => (
        <ellipse
          key={i}
          cx={px}
          cy={py}
          rx="3.5"
          ry="2"
          fill="#E0A0B0"
          opacity="0.55"
          transform={`rotate(${i * 40}, ${px}, ${py})`}
        />
      ))}
    </svg>
  );
}

// Atmospheric drifting petals
function DriftingPetals() {
  const petals: Array<{ left: string; top: string; delay: string; dur: string; px: string; py: string; pr: string }> = [
    { left: '12%',  top: '15%', delay: '0s',    dur: '18s', px: '90px',  py: '160px', pr: '200deg' },
    { left: '28%',  top: '8%',  delay: '3s',    dur: '22s', px: '60px',  py: '200px', pr: '150deg' },
    { left: '50%',  top: '20%', delay: '6s',    dur: '20s', px: '-50px', py: '180px', pr: '240deg' },
    { left: '70%',  top: '10%', delay: '1.5s',  dur: '24s', px: '40px',  py: '170px', pr: '120deg' },
    { left: '85%',  top: '18%', delay: '9s',    dur: '19s', px: '-70px', py: '150px', pr: '270deg' },
    { left: '40%',  top: '5%',  delay: '12s',   dur: '21s', px: '80px',  py: '190px', pr: '180deg' },
  ];

  return (
    <>
      {petals.map((p, i) => (
        <div
          key={i}
          className="garden-petal"
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: p.top,
            left: p.left,
            width: 8,
            height: 5,
            borderRadius: '50% 20%',
            background: '#E0A0B0',
            opacity: 0,
            zIndex: 12,
            pointerEvents: 'none',
            ['--px' as string]: p.px,
            ['--py' as string]: p.py,
            ['--pr' as string]: p.pr,
            animation: `petalDrift ${p.dur} ease-in ${p.delay} infinite`,
          }}
        />
      ))}
    </>
  );
}

// Water droplets (shown when watering)
function WaterDroplets({ active }: { active: boolean }) {
  if (!active) return null;
  const drops = Array.from({ length: 14 }, (_, i) => ({
    left: `${48 + (i % 7) * 1.2 - 3}%`,
    delay: `${(i * 0.07).toFixed(2)}s`,
    size: 4 + (i % 3),
  }));
  return (
    <>
      {drops.map((d, i) => (
        <div
          key={i}
          className="garden-droplet"
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '30%',
            left: d.left,
            width: d.size,
            height: d.size * 1.6,
            borderRadius: '50% 50% 40% 40%',
            background: 'rgba(120,180,220,0.75)',
            zIndex: 20,
            pointerEvents: 'none',
            animation: `dropletFall 1.1s ease-in ${d.delay} infinite`,
          }}
        />
      ))}
    </>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function GardenScreen({ onNavigate, onWater, stats }: GardenScreenProps) {
  const s = stats ?? DEFAULT_STATS;
  const [watering, setWatering] = useState(false);
  const [treeGlow, setTreeGlow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    injectStyles();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleWater() {
    if (watering) return;
    setWatering(true);
    setTreeGlow(true);
    onWater?.();
    timerRef.current = setTimeout(() => {
      setWatering(false);
      setTreeGlow(false);
    }, 3200);
  }

  // Progress bar widths (clamped 0–100%)
  const growthPct = Math.round(Math.min(1, Math.max(0, s.growth)) * 100);
  const waterPct  = Math.round(Math.min(1, Math.max(0, s.water)) * 100);

  return (
    <div
      role="main"
      aria-label="garden"
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        background: '#7BA7CB',
        animation: 'gardenFadeIn 0.8s ease-out both',
      }}
    >
      {/* ── SKY ────────────────────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, #7BA7CB 0%, #9FC4DE 25%, #B8D8EE 50%, #D4EAF4 75%, #E8F2F8 100%)',
          zIndex: 0,
        }}
      />

      {/* Sun glow top-right */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -60,
          right: -60,
          width: 280,
          height: 280,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(255,240,180,0.45) 0%, rgba(255,220,120,0.2) 45%, transparent 70%)',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />

      {/* Clouds */}
      <Cloud1 />
      <Cloud2 />

      {/* ── STONE ARCHES (mid-back, top 40%) ───────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '40%',
          zIndex: 2,
          animation: 'gardenFadeIn 0.8s ease-out 0.15s both',
          opacity: 0,
        }}
      >
        <StoneArch cx="8%" width={200} />
        <StoneArch cx="38%" width={200} />
        <StoneArch cx="68%" width={200} />
      </div>

      {/* ── GROUND ──────────────────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          height: '42%',
          background:
            'linear-gradient(180deg, #8AAA70 0%, #70944A 30%, #5A8038 60%, #486C2E 100%)',
          zIndex: 2,
          animation: 'gardenFadeIn 0.8s ease-out 0.3s both',
          opacity: 0,
        }}
      />

      {/* Stone path */}
      <svg
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: '10%',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 4,
        }}
        width="260"
        height="50"
        viewBox="0 0 260 50"
      >
        {[
          [30, 28, 32, 11],
          [85, 30, 30, 10],
          [140, 26, 34, 11],
          [195, 28, 28, 10],
          [245, 30, 22, 9],
        ].map(([cx, cy, rx, ry], i) => (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill={i % 2 ? '#A8986A' : '#B8A878'}
            opacity="0.4"
            stroke="#A08860"
            strokeWidth="0.5"
            strokeOpacity="0.2"
          />
        ))}
      </svg>

      {/* Side terracotta pots */}
      <TerraCottaPot
        scale={1.1}
        style={{ position: 'absolute', bottom: '24%', left: '6%', zIndex: 4 }}
      />
      <TerraCottaPot
        scale={0.85}
        style={{ position: 'absolute', bottom: '22%', left: '13%', zIndex: 4 }}
      />
      <TerraCottaPot
        scale={1.0}
        style={{ position: 'absolute', bottom: '23%', left: '80%', zIndex: 4 }}
      />
      <TerraCottaPot
        scale={0.9}
        style={{ position: 'absolute', bottom: '24%', left: '87%', zIndex: 4 }}
      />

      {/* Brass lanterns */}
      <BrassLantern style={{ position: 'absolute', bottom: '42%', left: '18%', zIndex: 4 }} />
      <BrassLantern style={{ position: 'absolute', bottom: '42%', right: '18%', zIndex: 4 }} />

      {/* ── REFLECTING POOL ─────────────────────────────────────────────── */}
      <ReflectingPool waterLevel={s.water} />

      {/* ── BURHAN (full size, center) ───────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: '16%',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 5,
          animation: treeGlow ? 'treeGlow 3.2s ease-out both' : undefined,
        }}
      >
        <BurhanTree
          height={400}
          tone="garden"
          waterLevel={Math.round(s.water * 100)}
          droop={s.health === 'thirsty' ? 35 : 8}
        />
      </div>

      {/* Burhan reflection in pool */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: '16%',
          left: '50%',
          transform: 'translateX(-50%) scaleY(-0.18)',
          transformOrigin: 'bottom center',
          zIndex: 3,
          opacity: 0.12,
          pointerEvents: 'none',
        }}
      >
        <BurhanTree height={400} tone="garden" waterLevel={50} droop={0} />
      </div>

      {/* ── ATMOSPHERIC PETALS ──────────────────────────────────────────── */}
      <DriftingPetals />

      {/* ── WATER DROPLETS (watering animation) ─────────────────────────── */}
      <WaterDroplets active={watering} />

      {/* ── BOTTOM FROSTED CARD ─────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          padding: '0 24px 32px',
          zIndex: 15,
          boxSizing: 'border-box',
          animation: 'gardenSlideUp 0.8s ease-out 0.55s both',
          opacity: 0,
        }}
      >
        <div
          style={{
            maxWidth: 560,
            margin: '0 auto',
            background: 'rgba(255,255,255,0.62)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.28)',
            borderRadius: 20,
            padding: '18px 22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
          }}
        >
          {/* Stats */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 9,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'rgba(0,0,0,0.45)',
                margin: '0 0 10px',
              }}
            >
              burhan is {s.health}
            </p>

            {/* Growth bar */}
            <div style={{ marginBottom: 7 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 8,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'rgba(0,0,0,0.38)',
                  marginBottom: 3,
                }}
              >
                <span>growth</span>
                <span>{growthPct}%</span>
              </div>
              <div
                style={{
                  height: 4,
                  borderRadius: 99,
                  background: 'rgba(0,0,0,0.08)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${growthPct}%`,
                    borderRadius: 99,
                    background: '#7C9E87',
                    transition: 'width 600ms ease',
                  }}
                />
              </div>
            </div>

            {/* Water bar */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 8,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'rgba(0,0,0,0.38)',
                  marginBottom: 3,
                }}
              >
                <span>water</span>
                <span>{waterPct}%</span>
              </div>
              <div
                style={{
                  height: 4,
                  borderRadius: 99,
                  background: 'rgba(0,0,0,0.08)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${waterPct}%`,
                    borderRadius: 99,
                    background: '#6AA8C0',
                    transition: 'width 600ms ease',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Water button */}
          <button
            type="button"
            onClick={handleWater}
            disabled={watering}
            aria-label={watering ? 'watering in progress' : 'water burhan'}
            style={{
              flexShrink: 0,
              background: watering ? 'rgba(80,130,180,0.25)' : 'rgba(79,110,91,0.1)',
              border: `1px solid ${watering ? 'rgba(80,130,180,0.3)' : 'rgba(79,110,91,0.22)'}`,
              borderRadius: 20,
              padding: '9px 18px',
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: watering ? '#4A88B0' : '#5A7A60',
              cursor: watering ? 'default' : 'pointer',
              letterSpacing: '0.08em',
              transition: 'all 300ms ease',
              lineHeight: 1.2,
            }}
          >
            {watering ? 'watering…' : 'water burhan 💧'}
          </button>
        </div>
      </div>

      {/* ── BACK BUTTON ─────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => onNavigate('home')}
        aria-label="back to home"
        style={{
          position: 'absolute',
          top: 48,
          left: 32,
          zIndex: 20,
          background: 'rgba(255,255,255,0.55)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(0,0,0,0.06)',
          borderRadius: 20,
          padding: '7px 18px',
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.12em',
          color: 'rgba(0,0,0,0.55)',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        ← home
      </button>
    </div>
  );
}
