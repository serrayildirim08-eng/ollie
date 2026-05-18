/**
 * AstrologyModule — ported from void-app.html AstrologyModule.
 *
 * Chart positions: prefer the real NatalChart from the astrology.chart store
 * slice (computed by the store orchestrator via astronomy-engine). Falls back
 * to the simplified Keplerian model when chart is not yet available.
 *
 * Store slices consumed:
 *   useStoreSlice('astrology', 'birth', null)  — BirthDraft | null
 *   useStoreSlice('astrology', 'chart', null)  — NatalChart | null
 */
import React, { useState, useEffect, useMemo } from 'react';
import { ModuleHelp } from '../../components/ModuleHelp';
import { useStoreSlice } from '../../store';
import type { NatalChart } from '@ollie/logic/astrology';

// ─── types ────────────────────────────────────────────────────────────────────

interface BirthDraft {
  date: string;
  time: string;
  place: string;
}

interface AstroPlanet {
  id: string;
  glyph: string;
  period: number;
  epoch: number;
}

interface AstroSign {
  name: string;
  glyph: string;
}

interface AstroAspectDef {
  name: string;
  target: number;
  orb: number;
  glyph: string;
  dash: string;
  angle: string;
}

interface PlanetPos {
  planet: AstroPlanet;
  lon: number;
}

interface AspectHit {
  a: PlanetPos;
  b: PlanetPos;
  type: AstroAspectDef;
  orb: number;
}

interface MoonPhase {
  frac: number;
  name: string;
}

interface StarDot {
  key: number;
  cx: number;
  cy: number;
  delay: string;
  dur: string;
}

// ─── static data ─────────────────────────────────────────────────────────────

const ASTRO_PLANETS: AstroPlanet[] = [
  { id: 'sun',     glyph: '☉', period: 365.2422,  epoch: 280.46646 },
  { id: 'moon',    glyph: '☽', period: 27.32158,  epoch: 218.316 },
  { id: 'mercury', glyph: '☿', period: 87.9691,   epoch: 252.25 },
  { id: 'venus',   glyph: '♀', period: 224.701,   epoch: 181.98 },
  { id: 'mars',    glyph: '♂', period: 686.971,   epoch: 355.43 },
  { id: 'jupiter', glyph: '♃', period: 4332.59,   epoch: 34.40 },
  { id: 'saturn',  glyph: '♄', period: 10759.22,  epoch: 49.94 },
  { id: 'uranus',  glyph: '♅', period: 30688.5,   epoch: 313.23 },
  { id: 'neptune', glyph: '♆', period: 60182.0,   epoch: 304.88 },
  { id: 'pluto',   glyph: '♇', period: 90560.0,   epoch: 238.92 },
];

const ASTRO_SIGNS: AstroSign[] = [
  { name: 'aries',       glyph: '♈' }, { name: 'taurus',      glyph: '♉' },
  { name: 'gemini',      glyph: '♊' }, { name: 'cancer',      glyph: '♋' },
  { name: 'leo',         glyph: '♌' }, { name: 'virgo',       glyph: '♍' },
  { name: 'libra',       glyph: '♎' }, { name: 'scorpio',     glyph: '♏' },
  { name: 'sagittarius', glyph: '♐' }, { name: 'capricorn',   glyph: '♑' },
  { name: 'aquarius',    glyph: '♒' }, { name: 'pisces',      glyph: '♓' },
];

const ASTRO_ASPECTS: AstroAspectDef[] = [
  { name: 'conjunction', target: 0,   orb: 6, glyph: '☌', dash: 'dot',   angle: '0°'   },
  { name: 'sextile',     target: 60,  orb: 4, glyph: '✶', dash: '1 3',   angle: '60°'  },
  { name: 'square',      target: 90,  orb: 5, glyph: '□', dash: '3 3',   angle: '90°'  },
  { name: 'trine',       target: 120, orb: 5, glyph: '△', dash: '8 4',   angle: '120°' },
  { name: 'opposition',  target: 180, orb: 6, glyph: '☍', dash: 'solid', angle: '180°' },
];

const ASTRO_SIGN_MEANINGS: Record<string, string> = {
  aries:       'first. fast. kind of a bully (fun).',
  taurus:      'slow on purpose. loves a snack.',
  gemini:      'three tabs open. funny.',
  cancer:      'feelings-first. will feed you.',
  leo:         'the performer. wants to be loved.',
  virgo:       'the fixer. re-folds laundry lovingly.',
  libra:       'cannot pick a restaurant.',
  scorpio:     'intense. does not do casual.',
  sagittarius: 'always booking a trip.',
  capricorn:   'takes it seriously. long game.',
  aquarius:    'the weird one. has theories.',
  pisces:      'the feeler. cries at commercials.',
};

const ASTRO_SIGN_MEANINGS_LONG: Record<string, string> = {
  aries:       "first. fast. kind of a bully in a fun way. will send the text before thinking about whether to send the text. impatient with slow anything.",
  taurus:      "slow on purpose. loves a snack, a routine, a soft sweater. will not be rushed. will hold a grudge like it is a houseplant.",
  gemini:      "three tabs open at all times. funny at dinner. impossible to pin down. says contradictory things in the same sentence and they are both true.",
  cancer:      "feelings-first. will feed you, will also sulk if you do not notice. remembers every time you did not call back. loyal past reason.",
  leo:         "the performer. wants to be loved and is honest about it. generous when seen, hurt when ignored. not actually dramatic, just committed.",
  virgo:       "the fixer. will re-fold your laundry, re-read your email, tell you the typo. means all of it lovingly. hates waste more than most people.",
  libra:       "cannot pick a restaurant. gets everyone on the same page anyway. thinks in pairs. allergic to vulgarity. will leave a party rather than cause a scene.",
  scorpio:     "intense by default. does not do casual, does not do small talk, will not pretend. remembers everything — not because it tries to, it just does.",
  sagittarius: "always planning a trip. says the truest thing in the room and then laughs about it. means well, mostly. easily bored.",
  capricorn:   "takes it seriously. long game. the one actually built different. unimpressed by urgency. still working when you give up.",
  aquarius:    "the weird one. has theories. cares about humans in the abstract more than the one in front of it. dressed like a concept.",
  pisces:      "the feeler. cries at commercials. picks up energy no one else does. very good listener, very bad estimator of time.",
};

const ASTRO_ASPECT_MEANINGS: Record<string, string> = {
  conjunction: 'stacked on top of each other. doing the same job as one move.',
  sextile:     'easy door between them. use it or do not.',
  square:      'annoying each other in a way you can use.',
  trine:       'flowing. often too easy to notice.',
  opposition:  'pulling against each other. you swing between them.',
};

const ASTRO_PLANET_MEANINGS: Record<string, string> = {
  sun:     "the main character. what you are trying to be, not always what you are. the thing everything else in your life orbits whether you notice it or not.",
  moon:    "how you actually feel under the performance. what you need to feel safe, soothed, at home. the weather inside that nobody else sees until they date you.",
  mercury: "how you think, talk, text, write. the vibe of your notes app and the tone of your voice notes. includes how you argue and how you change your mind.",
  venus:   "what you find hot. what you spend money on, what you would trade comfort for. how you flirt and who you trust with aesthetics.",
  mars:    "how you fight. how you show up when it is time to do the thing. the edge you use to push. how you want, specifically.",
  jupiter: "what you believe in. where luck shows up without you earning it. your version of bigger — travel, ideas, meaning, the plot you keep chasing.",
  saturn:  "where you are being asked to grow up. the homework. the stuff that feels hard for a reason — it is the shape you are becoming.",
  uranus:  "where you are unmistakably weird. the thing that surprises you about yourself. where you break the pattern and feel most alive doing it.",
  neptune: "where you get delulu. also where you dissolve into something bigger — art, spirit, other people, the ocean. porous territory.",
  pluto:   "what is being rewritten in you whether you want it or not. the underground process. the things you cannot unmake once you have seen them.",
};

const ASTRO_PLANET_IN_SIGN: Record<string, string> = {
  "sun-aries":       "your sun is in aries, so you are trying to be first, fast, and sure. you identify with going. the problem is not that you take too long — it is that you sometimes go before you know where. the gift: you start things nobody else would risk starting.",
  "sun-taurus":      "your sun is in taurus, so you are trying to be solid. you want a life you can actually taste — real food, real people, a bed you love. people misread your pace as stubbornness. sometimes it is. mostly you know what you are doing.",
  "sun-gemini":      "your sun is in gemini, so you are trying to be witty, various, free. you are a little bit of several people depending on the day. that is not fraud, that is range. your lesson is not be consistent, it is pick the version that matters today.",
  "sun-cancer":      "your sun is in cancer, so you are trying to be someone who cares well. your identity is wrapped up in who you love and how you feed them. the risk: you shrink to fit rooms that do not deserve you. the gift: nobody around you feels alone on your watch.",
  "sun-leo":         "your sun is in leo, so you are trying to be loved and you know it. you take up space on purpose because it is the shape of how you offer. the thing nobody tells leo suns: you are most generous when someone actually sees you, not when they only say they do.",
  "sun-virgo":       "your sun is in virgo, so you are trying to be useful and exact. your identity is tied to doing the thing right. the trap is overedit — polishing things past the point anybody wanted them polished. the gift: you notice what everyone else misses and it saves them every time.",
  "sun-libra":       "your sun is in libra, so you are trying to be the person who makes things work between people. you think in pairs. the trap: you can spend your whole life picking the right option. the gift: you do actually know how to leave a room better than you found it.",
  "sun-scorpio":     "your sun is in scorpio, so you are trying to be real — no small talk, no smoothing. you go deep because you cannot find the shallow end. the trap: you test people to see if they can handle you. the gift: the ones who pass get you forever.",
  "sun-sagittarius": "your sun is in sagittarius, so you are trying to be free, honest, somewhere else. you are wired for expansion — the next trip, the next idea, the next country. the trap: commitment feels like a cage until you find the one that is not. the gift: you tell the truth when nobody else will.",
  "sun-capricorn":   "your sun is in capricorn, so you are trying to build something that lasts. you are unimpressed by speed, skeptical of everyone's first attempt, including your own. the trap: you take too long to enjoy what you already built. the gift: you will still be standing when it matters.",
  "sun-aquarius":    "your sun is in aquarius, so you are trying to be a little outside everything. you care about the big picture and sometimes forget the person right in front of you is in it. the trap: performing aloof when you actually need closeness. the gift: you see futures other people cannot.",
  "sun-pisces":      "your sun is in pisces, so you are trying to be porous on purpose. you feel what is in the room before anyone says it. the trap: you absorb things that are not yours and then try to solve them. the gift: you can love people in specific ways most do not have access to.",
  "moon-aries":      "your moon is in aries. you need to do something physical when you are upset — walk, lift, slam a door, go for a drive. soothing looks like motion. advice that tells you to journal instead of move is not for you.",
  "moon-taurus":     "your moon is in taurus. comfort is not optional for you, it is the whole protocol. a real meal, a nap, the same sweater, your routine back. the moon-taurus trap is stalling comfort for too long — at some point you have to get up.",
  "moon-gemini":     "your moon is in gemini. you feel things by talking about them. thinking it through out loud is how you know what you think. bottling it up is genuinely bad for you — find someone who can listen without solving.",
  "moon-cancer":     "your moon is at home in cancer. you feel big, you feel for other people, you remember every small slight. you need a safe space to have the feeling before you perform the reasonable adult response.",
  "moon-leo":        "your moon is in leo. you need to be seen when you are feeling, not managed. one person who looks at you and says that is hard does more than ten who try to fix it. also: dress up when you are sad. it works.",
  "moon-virgo":      "your moon is in virgo. you soothe yourself by organizing something — a clean desk, a tidy spreadsheet, laundry folded with care. these are real rituals. the moon-virgo trap is using tidying to avoid the actual feeling.",
  "moon-libra":      "your moon is in libra. you feel steady when things around you are harmonious — an uncluttered room, a peaceful conversation, no one mad at you. the pressure to keep the peace can eat your actual feelings. someone asking but how do YOU feel is a gift.",
  "moon-scorpio":    "your moon is in scorpio. you feel everything at full volume and then try to make it look like you do not. privacy is a genuine need, not a style. the moon-scorpio trap is self-protection that turns into isolation.",
  "moon-sagittarius":"your moon is in sagittarius. you need space, distance, a vista — not because you do not feel deeply, but because you feel claustrophobic when the feelings are in too small a room. a walk outside fixes more than anyone expects.",
  "moon-capricorn":  "your moon is in capricorn. you feel better when you can name the feeling and put it in a framework. you do not love big emotional scenes — you want a plan. the moon-capricorn trap is mistaking the plan for the healing.",
  "moon-aquarius":   "your moon is in aquarius. you process feelings by getting a little distance, talking to a friend who is not emotionally involved, intellectualizing just enough to not drown. the trap: never getting wet enough to actually feel it.",
  "moon-pisces":     "your moon is in pisces. you pick up on everyone's feelings, sometimes you cannot tell which ones are yours. you need water, music, some solitude. the trap: dissolving into other people and calling it love.",
  "mars-aries":      "your mars is in aries — mars at home. you push fast, you want now, you go first. good version: starting things other people only talk about. bad version: burning out at 11am on tuesday because you went too hard monday.",
  "mars-taurus":     "your mars is in taurus. slow to anger, slow to start, but once you go, you are impossible to stop. good version: endurance nobody else has. bad version: stubbornness past the point of sense.",
  "mars-gemini":     "your mars is in gemini. you fight with words. quick, witty, cutting when it matters. good version: running rings around people who underestimate you. bad version: winning an argument you did not need to have.",
  "mars-cancer":     "your mars is in cancer. you push indirectly — around a conflict before going through it. good version: protecting what you love with focus. bad version: passive-aggression when you should just be aggressive.",
  "mars-leo":        "your mars is in leo. you fight for pride, for people you love, with flourish. good version: courage in public. bad version: taking a critique personally and making a scene.",
  "mars-virgo":      "your mars is in virgo. you push through precision — doing the thing exactly right until it cannot be argued with. good version: craftsmanship nobody can touch. bad version: weaponizing detail in a fight.",
  "mars-libra":      "your mars is in libra. you fight for fairness but also hate fighting. delay conflict until the delay becomes the conflict. good version: diplomat with teeth. bad version: passive until you explode, then apologetic.",
  "mars-scorpio":    "your mars is in scorpio — mars at home. when you want something you are unstoppable. when you are crossed you will wait. good version: focus nobody else can muster. bad version: the long grudge that eats you before it reaches the target.",
  "mars-sagittarius":"your mars is in sagittarius. you push big, honest, toward freedom. good version: saying what everyone else is thinking. bad version: saying it at the wrong time and calling it truth.",
  "mars-capricorn":  "your mars is in capricorn — one of mars's strongest placements. you want something, make a plan, execute. good version: you finish. bad version: you carry ambition into places it does not belong, like friendships.",
  "mars-aquarius":   "your mars is in aquarius. you fight for ideas, systems, communities — rarely for yourself directly. good version: pushing for the principle. bad version: intellectualizing anger past the point anyone can respond to.",
  "mars-pisces":     "your mars is in pisces. your drive is more current than edge — you push obliquely, go around, dream your way there. good version: you can move what nobody else can move. bad version: you conflate acting and wishing.",
};

const ASTRO_HOUSE_MEANINGS: Record<number, string> = {
  1:  "how people see you when you walk in. the mask that is also your face. body, vibe, first impression.",
  2:  "what you have and what you think you're worth. money, objects, the body, values. the stuff you own and the stuff you consider yours.",
  3:  "how you talk, what you know, what you read. siblings, neighbors, the group chat, quick trips. everyday mind.",
  4:  "home. family. where you come from. the private root of you — the version only people who lived with you have seen.",
  5:  "play. romance. creativity. the part of life you do for joy. also kids, real or metaphorical.",
  6:  "work. routines. health. service. the unglamorous daily grind and how you do it.",
  7:  "partners. the mirror. who you marry, who you fight with, who keeps showing up to show you yourself. not just romance — business partners count.",
  8:  "shared money, sex, death, transformation. the stuff you merge with someone else and cannot fully control. also what you inherit, in every sense.",
  9:  "meaning. travel. teachers. religion, philosophy, big ideas, the long view. where you go to become bigger than you were.",
  10: "public life. career. reputation. the thing strangers know about you. what you are building in the open.",
  11: "friends. networks. hopes. the people you choose and the future you're making with them.",
  12: "the unconscious. hidden places. endings. what you dissolve into — sleep, solitude, spirit, the thing you do not show.",
};

const ASTRO_HOROSCOPES = [
  "mercury's direct again. stuff that was stuck is moving. it's not magic, you just got your brain back. answer the texts you've been ghosting.",
  "moon is in taurus today. nothing you decide right now has to be correct, just comfortable. eat something real. don't negotiate with yourself about dinner.",
  "full moon in scorpio last week exposed a thing. whatever it was, it's not going back in the box. work with it, not around it.",
  "venus opposite jupiter — you want to give more than you have. say yes to half the things. the other half is not abandonment, it's pacing.",
  "mars is in capricorn being slow and steady. do the thing you've been putting off. small ugly steps count. nobody's watching, that's the point.",
  "sun in aries is firing early-season energy. you want to start eleven things at once. pick two. the other nine will be there next week.",
  "venus in pisces is softening the edges. anything you say from this space lands 30% sweeter than you mean it. proceed accordingly.",
  "saturn squaring your moon this month. not a tragedy, a correction. the feeling you keep having is real, and also a little overdue.",
  "jupiter in gemini is throwing information at you. you do not have to read every article. pick the three sources you trust and ignore the rest.",
  "moon void-of-course from noon to six. do not sign anything, do not decide anything, do not text the ex. use it as a legitimate excuse to do nothing.",
  "mercury in libra is overthinking the reply. write it, sleep on it, send it anyway. the first version was fine.",
  "new moon in aquarius — a clean weird slate. the instinct to reinvent something you just finished is the moon talking. maybe wait a week.",
  "pluto square your sun. this is the year you become someone you did not plan to be. resistance is normal. going through it is faster than going around it.",
  "north node in pisces for a few years — the collective lesson is gentleness. your version of that is specific. figure out which assumption you are being asked to drop.",
  "chiron on the ascendant — every hello right now feels like a first impression. it is not. the awkwardness is the healing.",
];

const ASTRO_MOON_PHASE_NAMES = [
  { max: 0.03, name: 'new moon' },
  { max: 0.22, name: 'waxing crescent' },
  { max: 0.28, name: 'first quarter' },
  { max: 0.47, name: 'waxing gibbous' },
  { max: 0.53, name: 'full moon' },
  { max: 0.72, name: 'waning gibbous' },
  { max: 0.78, name: 'last quarter' },
  { max: 0.97, name: 'waning crescent' },
  { max: 1.01, name: 'new moon' },
];

// ─── pure helpers ─────────────────────────────────────────────────────────────

function astroLon(planet: AstroPlanet, date: Date): number {
  const j2000 = 946728000000;
  const days = (date.getTime() - j2000) / 86400000;
  const mean = planet.epoch + (days / planet.period) * 360;
  return ((mean % 360) + 360) % 360;
}

function astroToSign(lon: number): { sign: AstroSign; deg: number } {
  const idx = Math.floor(((lon % 360) + 360) % 360 / 30) % 12;
  return { sign: ASTRO_SIGNS[idx], deg: ((lon % 30) + 30) % 30 };
}

function astroAspectBetween(
  lonA: number,
  lonB: number,
): { type: AstroAspectDef; orb: number } | null {
  let diff = Math.abs(lonA - lonB);
  if (diff > 180) diff = 360 - diff;
  for (const a of ASTRO_ASPECTS) {
    if (Math.abs(diff - a.target) <= a.orb) {
      return { type: a, orb: Math.abs(diff - a.target) };
    }
  }
  return null;
}

function astroPolar(
  lon: number,
  r: number,
  cx = 270,
  cy = 270,
): { x: number; y: number } {
  const rad = (lon % 360) * Math.PI / 180;
  return { x: cx - r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function astroMoonPhase(date: Date): MoonPhase {
  const ref = Date.UTC(2000, 0, 6, 18, 14, 0);
  const syn = 29.530588853 * 86400000;
  const p = (((date.getTime() - ref) % syn) + syn) % syn / syn;
  return {
    frac: p,
    name: (ASTRO_MOON_PHASE_NAMES.find(m => p < m.max) ?? ASTRO_MOON_PHASE_NAMES[0]).name,
  };
}

function astroOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function astroHouseFor(planetLon: number, sunLon: number): number {
  const planetSignIdx = Math.floor(((planetLon % 360) + 360) % 360 / 30);
  const sunSignIdx    = Math.floor(((sunLon % 360) + 360) % 360 / 30);
  return ((planetSignIdx - sunSignIdx + 12) % 12) + 1;
}

// ─── sub-components ───────────────────────────────────────────────────────────

function MoonTile({ frac }: { frac: number }) {
  const r = 36;
  const off = Math.cos(Math.PI * 2 * frac) * r * 0.9;
  const waxing = frac < 0.5;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true" style={{ display: 'block' }}>
      <mask id="astro-moon-mask">
        <rect width="96" height="96" fill="white" />
        <circle
          cx={48 + (waxing ? -off / 1.6 : off / 1.6)}
          cy="48"
          r={r}
          fill="black"
        />
      </mask>
      <circle cx="48" cy="48" r={r} fill="var(--astro-ink-soft)" mask="url(#astro-moon-mask)" />
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--astro-hairline)" strokeWidth="0.5" />
    </svg>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

interface AstrologyModuleProps {
  onBack: () => void;
}

export function AstrologyModule({ onBack }: AstrologyModuleProps) {
  // Store slices
  const [birth, setBirth] = useStoreSlice<BirthDraft | null>('astrology', 'birth', null);
  const [chart] = useStoreSlice<NatalChart | null>('astrology', 'chart', null);

  // Local state
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BirthDraft>(
    () => birth ?? { date: '', time: '', place: '' },
  );
  const [filterPlanet, setFilterPlanet] = useState<string | null>(null);
  const [readingAspect, setReadingAspect] = useState<AspectHit | null>(null);
  const [readingMoon, setReadingMoon] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [loaded, setLoaded] = useState(false);

  const hasReading = !!(filterPlanet ?? readingAspect ?? readingMoon);

  const openPlanet  = (id: string) => { setFilterPlanet(id); setReadingAspect(null); setReadingMoon(false); };
  const openAspect  = (asp: AspectHit) => { setReadingAspect(asp); setFilterPlanet(null); setReadingMoon(false); };
  const openMoon    = () => { setReadingMoon(true); setFilterPlanet(null); setReadingAspect(null); };
  const clearReading = () => { setFilterPlanet(null); setReadingAspect(null); setReadingMoon(false); };

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const t = requestAnimationFrame(() => setLoaded(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // Sync draft when birth changes externally
  useEffect(() => {
    if (birth && !editing) setDraft(birth);
  }, [birth, editing]);

  const hasNatal = !!(birth && birth.date);

  const natalDate = useMemo<Date | null>(() => {
    if (!birth?.date) return null;
    try {
      const dt = birth.time?.match(/^\d{2}:\d{2}/)
        ? `${birth.date}T${birth.time.slice(0, 5)}:00`
        : `${birth.date}T12:00:00`;
      const d = new Date(dt);
      return isNaN(d.getTime()) ? null : d;
    } catch { return null; }
  }, [birth]);

  // When the real chart is available from the store (computed via astronomy-engine),
  // map its planet longitudes onto the in-component PlanetPos shape. Fall back to
  // the Keplerian model otherwise.
  const natalPositions = useMemo<PlanetPos[]>(() => {
    if (chart?.planets) {
      return ASTRO_PLANETS.map(p => {
        const real = chart.planets[p.id];
        return { planet: p, lon: real != null ? real.longitude : (natalDate ? astroLon(p, natalDate) : 0) };
      });
    }
    if (!natalDate) return [];
    return ASTRO_PLANETS.map(p => ({ planet: p, lon: astroLon(p, natalDate) }));
  }, [chart, natalDate]);

  const transitPositions = useMemo<PlanetPos[]>(
    () => ASTRO_PLANETS.map(p => ({ planet: p, lon: astroLon(p, now) })),
    [now],
  );

  const activeAspects = useMemo<AspectHit[]>(() => {
    const out: AspectHit[] = [];
    for (let i = 0; i < transitPositions.length; i++) {
      for (let j = i + 1; j < transitPositions.length; j++) {
        const a = transitPositions[i];
        const b = transitPositions[j];
        const asp = astroAspectBetween(a.lon, b.lon);
        if (asp) out.push({ a, b, ...asp });
      }
    }
    out.sort((x, y) => x.orb - y.orb);
    return out.slice(0, 12);
  }, [transitPositions]);

  const aspectLines = useMemo<AspectHit[]>(() => {
    if (!transitPositions.length) return [];
    const lines: AspectHit[] = [];
    for (let i = 0; i < transitPositions.length; i++) {
      for (let j = i + 1; j < transitPositions.length; j++) {
        const a = transitPositions[i];
        const b = transitPositions[j];
        const asp = astroAspectBetween(a.lon, b.lon);
        if (!asp) continue;
        lines.push({ a, b, ...asp });
      }
    }
    lines.sort((x, y) => x.orb - y.orb);
    return lines;
  }, [transitPositions]);

  const filteredAspects = filterPlanet
    ? activeAspects.filter(asp => asp.a.planet.id === filterPlanet || asp.b.planet.id === filterPlanet)
    : activeAspects;

  const moon = useMemo(() => astroMoonPhase(now), [now]);
  const moonLon = useMemo(() => astroLon(ASTRO_PLANETS[1], now), [now]);

  const horoscope = useMemo(() => {
    const doy = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
    return ASTRO_HOROSCOPES[doy % ASTRO_HOROSCOPES.length];
  }, [now]);

  const glowClass = (() => {
    const h = now.getHours();
    if (h >= 5 && h < 9)   return 'astro-glow-dawn';
    if (h >= 9 && h < 17)  return 'astro-glow-noon';
    if (h >= 17 && h < 21) return 'astro-glow-dusk';
    return 'astro-glow-night';
  })();

  const stars = useMemo<StarDot[]>(() => {
    let s = 42;
    const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    return Array.from({ length: 36 }, (_, i) => {
      const ang = rand() * Math.PI * 2;
      const rad = 275 + rand() * 18;
      return {
        key: i,
        cx: 270 + Math.cos(ang) * rad,
        cy: 270 + Math.sin(ang) * rad,
        delay: (rand() * 5).toFixed(2),
        dur: (4 + rand() * 2).toFixed(2),
      };
    });
  }, []);

  const { x: moonMarkerX, y: moonMarkerY } = astroPolar(moonLon, 235);

  function saveNatal() {
    if (!draft.date) return;
    const safe: BirthDraft = {
      date: draft.date.trim(),
      time: draft.time.trim(),
      place: draft.place.trim(),
    };
    setBirth(safe);
    setEditing(false);
  }

  function fmtDateHeader(d: Date) {
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase();
  }
  function fmtWeekday(d: Date) {
    return d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  }
  function fmtTimeTZ(d: Date) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const off = -d.getTimezoneOffset() / 60;
    const tz = `gmt${off >= 0 ? '+' : ''}${off}`;
    return `${hh}:${mm} ${tz}`;
  }

  // ─── render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className={`astrology-module ${glowClass}`}
      style={{
        width: '100vw',
        minHeight: '100vh',
        position: 'relative',
        background: 'var(--astro-bg)',
        color: 'var(--astro-ink)',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        animation: 'fadeUp 400ms ease-out both',
      }}
    >
      {/* back */}
      <button
        type="button"
        onClick={onBack}
        className="astro-back"
        aria-label="back to dashboard"
        style={{
          position: 'fixed', top: 22, left: 24, zIndex: 30,
          background: 'rgba(28,24,20,0.6)', backdropFilter: 'blur(16px)',
          border: '1px solid var(--astro-hairline)', borderRadius: 20,
          padding: '8px 16px', color: 'var(--astro-ink)',
          fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 500,
          letterSpacing: '0.22em', textTransform: 'uppercase',
          cursor: 'pointer', transition: 'border-color 220ms ease',
        }}
      >
        ← dashboard
      </button>

      {/* help */}
      <div style={{ position: 'fixed', top: 22, right: 24, zIndex: 30 }}>
        <ModuleHelp moduleId="astrology" />
      </div>

      {/* radial glow */}
      <div
        aria-hidden="true"
        className="astro-glow"
        style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
      />

      {/* grid */}
      <div
        style={{
          maxWidth: 1316,
          margin: '0 auto',
          padding: 'var(--as-6) var(--as-5) 120px',
          display: 'grid',
          gridTemplateColumns: hasNatal ? '260px minmax(0, 640px) 260px' : 'minmax(0, 1fr)',
          columnGap: 'var(--as-6)',
          position: 'relative',
          zIndex: 1,
        }}
        className="astro-grid"
      >
        {/* ── EMPTY STATE ── */}
        {!hasNatal && (
          <div
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              paddingTop: '30vh',
              gap: 'var(--as-6)',
            }}
          >
            <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>chart · unset</div>
            <div
              style={{
                fontFamily: "'Spectral', Georgia, serif",
                fontStyle: 'italic',
                fontWeight: 400,
                fontSize: 28,
                color: 'var(--astro-ink)',
                letterSpacing: '-0.003em',
                lineHeight: 1.35,
                maxWidth: '24ch',
                textAlign: 'center',
              }}
            >
              drop your birth info. date, time, place. nothing works without it.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--as-4)', width: 360 }}>
              {(
                [
                  { key: 'date' as const,  label: 'DATE',  ph: 'YYYY-MM-DD' },
                  { key: 'time' as const,  label: 'TIME',  ph: 'HH:MM · TZ' },
                  { key: 'place' as const, label: 'PLACE', ph: 'city, country' },
                ] as const
              ).map(f => (
                <div key={f.key}>
                  <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)', marginBottom: 6 }}>{f.label}</div>
                  <input
                    value={draft[f.key] ?? ''}
                    onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                    placeholder={f.ph}
                    className="astro-input"
                    aria-label={f.label}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={!(draft.date && draft.time && draft.place)}
              onClick={saveNatal}
              className="astro-compute"
              style={{
                background: 'transparent', border: 'none', padding: 0,
                fontFamily: "'DM Mono', monospace", fontWeight: 500,
                fontSize: 11, letterSpacing: '0.28em', textTransform: 'uppercase',
                color: (draft.date && draft.time && draft.place) ? 'var(--astro-brass)' : 'var(--astro-ink-faint)',
                cursor: (draft.date && draft.time && draft.place) ? 'pointer' : 'default',
                transition: 'color 220ms ease',
              }}
            >
              → compute
            </button>
          </div>
        )}

        {/* ── LEFT RAIL ── */}
        {hasNatal && (
          <aside
            className={`astro-rail astro-stagger${loaded ? ' astro-stagger-in' : ''}`}
            style={{ '--stagger-delay': '120ms' } as React.CSSProperties}
          >
            <section className="astro-block">
              <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>birth</div>
              <div className="astro-rule" />
              <div className="astro-pair">
                <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>date</div>
                <div className="astro-caption">{birth?.date ?? '—'}</div>
              </div>
              <div className="astro-pair">
                <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>time</div>
                <div className="astro-caption">{birth?.time ?? '—'}</div>
              </div>
              <div className="astro-pair">
                <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>place</div>
                <div className="astro-caption">{birth?.place ?? '—'}</div>
              </div>
              <button
                type="button"
                onClick={() => { setDraft(birth ?? { date: '', time: '', place: '' }); setEditing(true); }}
                className="astro-mono astro-edit-trigger"
                style={{
                  background: 'transparent', border: 'none', padding: 0, marginTop: 'var(--as-3)',
                  color: 'var(--astro-ink-faint)', cursor: 'pointer',
                }}
              >
                → edit
              </button>
            </section>

            <section className="astro-block">
              <button
                type="button"
                onClick={() => (readingMoon ? clearReading() : openMoon())}
                className="astro-moon-button"
                style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}
              >
                <MoonTile frac={moon.frac} />
                <div className="astro-mono" style={{ color: 'var(--astro-ink-soft)', marginTop: 'var(--as-3)' }}>
                  moon · {moon.name} · {astroToSign(moonLon).deg.toFixed(1)}°{astroToSign(moonLon).sign.glyph}
                </div>
                <div className="astro-mono" style={{ color: 'var(--astro-ink-faint)', marginTop: 4 }}>
                  → click to read
                </div>
              </button>
            </section>

            <section className="astro-block">
              <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>transits · today</div>
              <div className="astro-rule" />
              {transitPositions.map(pos => {
                const sd = astroToSign(pos.lon);
                return (
                  <button
                    key={pos.planet.id}
                    type="button"
                    onClick={() => (filterPlanet === pos.planet.id ? clearReading() : openPlanet(pos.planet.id))}
                    className={`astro-transit-row${filterPlanet === pos.planet.id ? ' astro-active' : ''}`}
                  >
                    <span className="astro-glyph" style={{ fontSize: 16 }}>{pos.planet.glyph}</span>
                    <span style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 13, fontWeight: 500, color: 'var(--astro-ink)' }}>
                      {pos.planet.id}
                    </span>
                    <span className="astro-mono-num" style={{ color: 'var(--astro-ink-soft)', textAlign: 'right' }}>
                      {sd.sign.glyph} {sd.sign.name} {sd.deg.toFixed(1)}°
                    </span>
                    <span className="astro-mono" style={{ color: 'transparent' }} />
                  </button>
                );
              })}
            </section>
          </aside>
        )}

        {/* ── CENTER ── */}
        {hasNatal && (
          <main
            className={`astro-main astro-stagger${loaded ? ' astro-stagger-in' : ''}`}
            style={{ '--stagger-delay': '0ms' } as React.CSSProperties}
          >
            <div className="astro-date-row">
              <div className="astro-date-left">{fmtDateHeader(now)}</div>
              <div className="astro-mono" style={{ color: 'var(--astro-ink-soft)' }}>
                {fmtWeekday(now)} · {fmtTimeTZ(now)}
              </div>
            </div>
            <div className="astro-rule" style={{ margin: 'var(--as-3) 0 var(--as-6)' }} />

            {/* chart wheel */}
            <div className="astro-chart-wrap">
              <svg
                className="astro-chart"
                viewBox="0 0 540 540"
                width="540"
                height="540"
                role="img"
                aria-label="natal chart wheel"
              >
                <defs>
                  <path id="astro-rim" d="M 270 8 a 262 262 0 1 1 -0.01 0" />
                </defs>

                {/* stars */}
                {stars.map(st => (
                  <circle
                    key={st.key}
                    className="astro-star"
                    cx={st.cx}
                    cy={st.cy}
                    r="0.55"
                    fill="var(--astro-ink-faint)"
                    style={{ animationDelay: `${st.delay}s`, animationDuration: `${st.dur}s` }}
                  />
                ))}

                {/* outer frame */}
                <circle cx="270" cy="270" r="265" fill="none" stroke="var(--astro-hairline)" strokeWidth="0.5" />

                {/* rim text */}
                <text className="astro-rim-text">
                  <textPath href="#astro-rim" startOffset="50%" textAnchor="middle">
                    {(birth?.date ?? '').toUpperCase()} · {(birth?.time ?? '').toUpperCase()} · {(birth?.place ?? '').toUpperCase()}
                  </textPath>
                </text>

                {/* ZODIAC RING */}
                <g className="astro-zodiac-ring">
                  <circle cx="270" cy="270" r="250" fill="none" stroke="var(--astro-ink-soft)" strokeWidth="0.75" className="astro-stroke-draw" />
                  <circle cx="270" cy="270" r="220" fill="none" stroke="var(--astro-hairline)" strokeWidth="0.5" className="astro-stroke-draw" />
                  {Array.from({ length: 12 }).map((_, i) => {
                    const lon = i * 30;
                    const p1 = astroPolar(lon, 220);
                    const p2 = astroPolar(lon, 250);
                    return (
                      <line
                        key={`spoke-z-${i}`}
                        x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                        stroke="var(--astro-hairline)" strokeWidth="0.5"
                        className="astro-zspoke"
                        style={{ animationDelay: `${600 + i * 40}ms` }}
                      />
                    );
                  })}
                  {ASTRO_SIGNS.map((sg, i) => {
                    const lon = i * 30 + 15;
                    const { x, y } = astroPolar(lon, 235);
                    return (
                      <g
                        key={`sg-${i}`}
                        className="astro-zodiac-glyph"
                        transform={`translate(${x},${y})`}
                        style={{ animationDelay: `${900 + i * 40}ms` }}
                      >
                        <text className="astro-glyph" fontSize="14" textAnchor="middle" y="5">{sg.glyph}</text>
                      </g>
                    );
                  })}
                </g>

                {/* HOUSE RING */}
                <circle cx="270" cy="270" r="205" fill="none" stroke="var(--astro-hairline)" strokeWidth="0.5" className="astro-stroke-draw" />
                <circle cx="270" cy="270" r="85"  fill="none" stroke="var(--astro-hairline)" strokeWidth="0.5" className="astro-stroke-draw" />
                {Array.from({ length: 12 }).map((_, i) => {
                  const lon = i * 30;
                  const p1 = astroPolar(lon, 85);
                  const p2 = astroPolar(lon, 205);
                  const prominent = i % 3 === 0;
                  return (
                    <line
                      key={`spoke-h-${i}`}
                      x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                      stroke={prominent ? 'var(--astro-ink-soft)' : 'var(--astro-hairline)'}
                      strokeWidth={prominent ? '0.75' : '0.5'}
                      className="astro-hspoke"
                      style={{ animationDelay: `${1000 + i * 40}ms` }}
                    />
                  );
                })}
                {([0, 3, 6, 9] as const).map(i => {
                  const lon = i * 30;
                  const p1 = astroPolar(lon, 205);
                  const p2 = astroPolar(lon, 209);
                  return (
                    <line
                      key={`tick-${i}`}
                      x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                      stroke="var(--astro-ink-soft)" strokeWidth="0.75"
                      className="astro-hspoke"
                      style={{ animationDelay: `${1000 + i * 40}ms` }}
                    />
                  );
                })}

                {/* ASPECT LINES */}
                {aspectLines.map((ln, i) => {
                  const { x: x1, y: y1 } = astroPolar(ln.a.lon, 165);
                  const { x: x2, y: y2 } = astroPolar(ln.b.lon, 165);
                  const dash = ln.type.dash;
                  const isConj = ln.type.name === 'conjunction';
                  if (isConj) {
                    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
                    return (
                      <circle
                        key={`a-${i}`}
                        cx={mx} cy={my} r="2"
                        fill="var(--astro-brass)"
                        className="astro-aspect-conj"
                        style={{ animationDelay: `${1900 + i * 60}ms` }}
                      />
                    );
                  }
                  const isActive = filterPlanet &&
                    (ln.a.planet.id === filterPlanet || ln.b.planet.id === filterPlanet);
                  const isDim = filterPlanet && !isActive;
                  return (
                    <line
                      key={`a-${i}`}
                      x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={isDim ? 'var(--astro-ink-ghost)' : (isActive ? 'var(--astro-brass)' : 'var(--astro-brass-soft)')}
                      strokeWidth="0.75"
                      strokeDasharray={dash === 'solid' ? undefined : dash}
                      className="astro-aspect-line"
                      style={{ animationDelay: `${1900 + i * 60}ms` }}
                    />
                  );
                })}

                {/* PLANET GLYPHS */}
                {transitPositions.map((pos, i) => {
                  const { x, y } = astroPolar(pos.lon, 165);
                  const sd = astroToSign(pos.lon);
                  const tx = astroPolar(pos.lon, 183).x;
                  const ty = astroPolar(pos.lon, 183).y;
                  const dim = filterPlanet && filterPlanet !== pos.planet.id;
                  return (
                    <g
                      key={`p-${pos.planet.id}`}
                      className={`astro-planet-g${dim ? ' astro-planet-dim' : ''}`}
                      onClick={e => {
                        e.stopPropagation();
                        if (filterPlanet === pos.planet.id) clearReading();
                        else openPlanet(pos.planet.id);
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`${pos.planet.id} in ${sd.sign.name}`}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          if (filterPlanet === pos.planet.id) clearReading();
                          else openPlanet(pos.planet.id);
                        }
                      }}
                      style={{ cursor: 'pointer', animationDelay: `${1400 + i * 80}ms` }}
                    >
                      <circle cx={x} cy={y} r="14" fill="transparent" />
                      <text x={x} y={y + 5} textAnchor="middle" className="astro-glyph astro-planet-glyph" fontSize="16">
                        {pos.planet.glyph}
                      </text>
                      <text x={tx} y={ty + 3} textAnchor="middle" className="astro-deg-mini" style={{ animationDelay: `${1700 + i * 40}ms` }}>
                        {sd.deg.toFixed(0)}°
                      </text>
                    </g>
                  );
                })}

                {/* moon transit marker */}
                <circle cx={moonMarkerX} cy={moonMarkerY} r="2" fill="var(--astro-brass)" className="astro-moon-marker" />
              </svg>
            </div>

            {/* NATAL ANCHOR + HOROSCOPE */}
            {!hasReading && (
              <div>
                <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)', marginTop: 'var(--as-6)' }}>
                  your natal · the anchor
                </div>
                <div className="astro-rule" style={{ marginTop: 'var(--as-2)', marginBottom: 'var(--as-4)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--as-3)', maxWidth: '58ch' }}>
                  {natalPositions.slice(0, 2).map(pos => {
                    const sd = astroToSign(pos.lon);
                    const meaning = ASTRO_SIGN_MEANINGS[sd.sign.name] ?? '';
                    const sunNatal = natalPositions.find(pp => pp.planet.id === 'sun');
                    const house = sunNatal ? astroHouseFor(pos.lon, sunNatal.lon) : null;
                    return (
                      <button
                        key={`natal-${pos.planet.id}`}
                        type="button"
                        onClick={() => openPlanet(pos.planet.id)}
                        style={{
                          display: 'grid', gridTemplateColumns: '80px 1fr',
                          gap: 'var(--as-3)', alignItems: 'baseline',
                          background: 'transparent', border: 'none',
                          padding: 'var(--as-2) 0', cursor: 'pointer',
                          textAlign: 'left', width: '100%',
                          transition: 'opacity 220ms ease',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                      >
                        <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 500, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--astro-ink-mute)' }}>
                          {pos.planet.id}
                        </div>
                        <div style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 15, fontWeight: 400, color: 'var(--astro-ink)', lineHeight: 1.5 }}>
                          <span style={{ fontFamily: "'Apple Symbols', 'Segoe UI Symbol', sans-serif", marginRight: 6 }}>{sd.sign.glyph}</span>
                          <span style={{ fontWeight: 500 }}>{sd.sign.name} {sd.deg.toFixed(1)}°</span>
                          <span style={{ color: 'var(--astro-ink-soft)' }}>
                            {' '}— {meaning}{house ? ` · ${astroOrdinal(house)} house` : ''}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)', marginTop: 'var(--as-6)' }}>
                  today · horoscope
                </div>
                <p
                  style={{
                    fontFamily: "'Spectral', Georgia, serif",
                    fontStyle: 'italic', fontWeight: 400,
                    fontSize: 22, lineHeight: 1.55,
                    letterSpacing: '-0.003em',
                    color: 'var(--astro-ink-soft)',
                    maxWidth: '58ch', marginTop: 'var(--as-3)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {horoscope}
                </p>
                <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)', marginTop: 'var(--as-3)' }}>
                  — just weather today against your chart. not a diagnosis.
                </div>
              </div>
            )}

            {/* PLANET READING */}
            {filterPlanet && !readingAspect && !readingMoon && (() => {
              const planet = ASTRO_PLANETS.find(p => p.id === filterPlanet);
              const natalPos = natalPositions.find(pp => pp.planet.id === filterPlanet);
              if (!planet || !natalPos) return null;
              const sd = astroToSign(natalPos.lon);
              const planetMeaning = ASTRO_PLANET_MEANINGS[planet.id] ?? '';
              const signMeaning = ASTRO_SIGN_MEANINGS_LONG[sd.sign.name] ?? '';
              const myAspects = activeAspects.filter(a => a.a.planet.id === planet.id || a.b.planet.id === planet.id);
              const comboKey = `${planet.id}-${sd.sign.name}`;
              const combo = ASTRO_PLANET_IN_SIGN[comboKey];
              const sunNatal = natalPositions.find(pp => pp.planet.id === 'sun');
              const house = sunNatal ? astroHouseFor(natalPos.lon, sunNatal.lon) : null;
              const houseMeaning = house ? (ASTRO_HOUSE_MEANINGS[house] ?? '') : '';
              return (
                <div className="astro-reading" key={planet.id}>
                  <div className="astro-reading-head">
                    <div className="astro-reading-glyph">{planet.glyph}</div>
                    <div className="astro-reading-title">
                      <div className="astro-reading-name">{planet.id}</div>
                      <div className="astro-reading-sub">in {sd.sign.glyph} {sd.sign.name} {sd.deg.toFixed(1)}°</div>
                    </div>
                    <button type="button" onClick={clearReading} className="astro-reading-close" aria-label="close reading">×</button>
                  </div>
                  <section className="astro-reading-section">
                    <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>{planet.id} · the planet</div>
                    <p className="astro-reading-para">{planetMeaning}</p>
                  </section>
                  <section className="astro-reading-section">
                    <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>{sd.sign.name} · the sign</div>
                    <p className="astro-reading-para">{signMeaning}</p>
                  </section>
                  <section className="astro-reading-section">
                    <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>your {planet.id} in {sd.sign.name}</div>
                    <p className="astro-reading-para">
                      {combo ?? (
                        `your ${planet.id} — ${(planetMeaning.split('.')[0] ?? '').trim()} — is running through ${sd.sign.name} flavor. ${sd.sign.name} is ${(signMeaning.split('.')[0] ?? '').trim()}. so wherever ${planet.id} shows up in your life, expect it to have that texture.`
                      )}
                    </p>
                  </section>
                  {house && (
                    <section className="astro-reading-section">
                      <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>your {planet.id} is in the {astroOrdinal(house)} house</div>
                      <p className="astro-reading-para">
                        the {astroOrdinal(house)} house is about {houseMeaning} so your {planet.id} lives there.
                      </p>
                      <div className="astro-mono" style={{ color: 'var(--astro-ink-faint)', marginTop: 'var(--as-2)' }}>
                        — houses computed solar whole-sign. accurate birth time would shift these a little.
                      </div>
                    </section>
                  )}
                  {myAspects.length > 0 && (
                    <section className="astro-reading-section">
                      <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>active aspects on {planet.id}</div>
                      <div className="astro-reading-aspects">
                        {myAspects.slice(0, 8).map((a, i) => {
                          const other = a.a.planet.id === planet.id ? a.b.planet : a.a.planet;
                          const meaning = ASTRO_ASPECT_MEANINGS[a.type.name] ?? '';
                          return (
                            <div key={`ra-${i}`} className="astro-reading-aspect">
                              <span className="astro-glyph" style={{ fontSize: 15 }}>{planet.glyph}</span>
                              <span style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 14, color: 'var(--astro-ink-soft)' }}>{a.type.name}</span>
                              <span className="astro-glyph" style={{ fontSize: 15 }}>{other.glyph}</span>
                              <span style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 14, color: 'var(--astro-ink)' }}>{other.id}</span>
                              <span className="astro-mono-num" style={{ color: 'var(--astro-ink-mute)' }}>{a.orb.toFixed(1)}°</span>
                              <span style={{ fontFamily: "'Spectral', Georgia, serif", fontStyle: 'italic', fontSize: 13, color: 'var(--astro-ink-soft)', gridColumn: '1 / -1', lineHeight: 1.4 }}>
                                — {meaning}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}
                  <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)', marginTop: 'var(--as-5)' }}>
                    — this is geography, not fortune. click × or the same thing to close.
                  </div>
                </div>
              );
            })()}

            {/* ASPECT READING */}
            {readingAspect && (() => {
              const a = readingAspect;
              const sdA = astroToSign(a.a.lon);
              const sdB = astroToSign(a.b.lon);
              const typeMeaning = ASTRO_ASPECT_MEANINGS[a.type.name] ?? '';
              return (
                <div className="astro-reading" key="asp-reading">
                  <div className="astro-reading-head">
                    <div className="astro-reading-glyph" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span>{a.a.planet.glyph}</span>
                      <span>{a.b.planet.glyph}</span>
                    </div>
                    <div className="astro-reading-title">
                      <div className="astro-reading-name">{a.a.planet.id} {a.type.name} {a.b.planet.id}</div>
                      <div className="astro-reading-sub">orb {a.orb.toFixed(1)}° · tightening or loosening today</div>
                    </div>
                    <button type="button" onClick={clearReading} className="astro-reading-close" aria-label="close reading">×</button>
                  </div>
                  <section className="astro-reading-section">
                    <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>{a.type.name} · the aspect</div>
                    <p className="astro-reading-para">{typeMeaning}</p>
                  </section>
                  <section className="astro-reading-section">
                    <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>{a.a.planet.id} in {sdA.sign.name} · {sdA.deg.toFixed(1)}°</div>
                    <p className="astro-reading-para">{ASTRO_PLANET_MEANINGS[a.a.planet.id]} {ASTRO_SIGN_MEANINGS_LONG[sdA.sign.name]}</p>
                  </section>
                  <section className="astro-reading-section">
                    <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>{a.b.planet.id} in {sdB.sign.name} · {sdB.deg.toFixed(1)}°</div>
                    <p className="astro-reading-para">{ASTRO_PLANET_MEANINGS[a.b.planet.id]} {ASTRO_SIGN_MEANINGS_LONG[sdB.sign.name]}</p>
                  </section>
                  <section className="astro-reading-section">
                    <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>what this pair does, today</div>
                    <p className="astro-reading-para">
                      {a.a.planet.id} is {(ASTRO_PLANET_MEANINGS[a.a.planet.id] ?? '').split('.')[0]}. {a.b.planet.id} is {(ASTRO_PLANET_MEANINGS[a.b.planet.id] ?? '').split('.')[0]}. in {a.type.name}, those two functions are {typeMeaning.toLowerCase().replace('.', '')}. the aspect is tight for a few days either side of exact.
                    </p>
                  </section>
                  <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)', marginTop: 'var(--as-5)' }}>— transit meeting transit. click × to close.</div>
                </div>
              );
            })()}

            {/* MOON READING */}
            {readingMoon && (() => {
              const sd = astroToSign(moonLon);
              const signMeaning = ASTRO_SIGN_MEANINGS_LONG[sd.sign.name] ?? '';
              const natalMoonPos = natalPositions.find(pp => pp.planet.id === 'moon');
              const natalSd = natalMoonPos ? astroToSign(natalMoonPos.lon) : null;
              const natalMeaning = natalSd ? (ASTRO_SIGN_MEANINGS_LONG[natalSd.sign.name] ?? '') : '';
              return (
                <div className="astro-reading" key="moon-reading">
                  <div className="astro-reading-head">
                    <div className="astro-reading-glyph">☽</div>
                    <div className="astro-reading-title">
                      <div className="astro-reading-name">moon</div>
                      <div className="astro-reading-sub">{moon.name} · in {sd.sign.name} {sd.deg.toFixed(1)}°</div>
                    </div>
                    <button type="button" onClick={clearReading} className="astro-reading-close" aria-label="close reading">×</button>
                  </div>
                  <section className="astro-reading-section">
                    <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>today · {moon.name}</div>
                    <p className="astro-reading-para">the moon does a full cycle every ~29 days. right now it's in {moon.name}. read the phase as mood: new = seed, waxing = build, full = exposure, waning = release.</p>
                  </section>
                  <section className="astro-reading-section">
                    <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>the moon is in {sd.sign.name}</div>
                    <p className="astro-reading-para">{signMeaning}</p>
                  </section>
                  {natalSd && (
                    <section className="astro-reading-section">
                      <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>your natal moon · {natalSd.sign.name}</div>
                      <p className="astro-reading-para">your moon is {(ASTRO_PLANET_MEANINGS['moon'] ?? '').toLowerCase()} — and it lives in {natalSd.sign.name}: {natalMeaning}</p>
                    </section>
                  )}
                  <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)', marginTop: 'var(--as-5)' }}>— the moon moves fast. this is hours, not weeks.</div>
                </div>
              );
            })()}
          </main>
        )}

        {/* ── RIGHT RAIL ── */}
        {hasNatal && (
          <aside
            className={`astro-rail astro-stagger${loaded ? ' astro-stagger-in' : ''}`}
            style={{ '--stagger-delay': '240ms' } as React.CSSProperties}
          >
            <section className="astro-block">
              <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>
                aspects · {filterPlanet ? (ASTRO_PLANETS.find(p => p.id === filterPlanet)?.glyph ?? '') + ' ' + filterPlanet : 'active'}
              </div>
              <div className="astro-rule" />
              <div className="astro-aspects-list">
                {filteredAspects.length === 0 && (
                  <div className="astro-mono" style={{ color: 'var(--astro-ink-faint)', padding: 'var(--as-3) 0' }}>
                    no active aspects.
                  </div>
                )}
                {filteredAspects.map((asp, i) => (
                  <button
                    key={`asp-${i}`}
                    type="button"
                    className="astro-aspect-row"
                    onClick={() => (readingAspect === asp ? clearReading() : openAspect(asp))}
                  >
                    <span className="astro-glyph" style={{ fontSize: 14 }}>{asp.a.planet.glyph}</span>
                    <span className="astro-glyph" style={{ fontSize: 14 }}>{asp.b.planet.glyph}</span>
                    <span style={{ fontFamily: "'Inter Tight', sans-serif", fontSize: 13, fontWeight: 400, color: 'var(--astro-ink-soft)' }}>
                      {asp.type.name}
                    </span>
                    <span className="astro-mono-num" style={{ color: 'var(--astro-ink-mute)', textAlign: 'right' }}>
                      {asp.orb.toFixed(1)}°
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="astro-block">
              <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>legend</div>
              <div className="astro-rule" />
              {ASTRO_ASPECTS.map(a => (
                <div key={a.name} className="astro-legend-row">
                  <svg width="32" height="14" viewBox="0 0 32 14" aria-hidden="true">
                    {a.dash === 'dot' ? (
                      <circle cx="16" cy="7" r="2" fill="var(--astro-brass)" />
                    ) : (
                      <line
                        x1="4" y1="7" x2="28" y2="7"
                        stroke="var(--astro-brass-soft)" strokeWidth="0.75"
                        strokeDasharray={a.dash === 'solid' ? undefined : a.dash}
                      />
                    )}
                  </svg>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontFamily: "'Inter Tight', sans-serif", fontWeight: 500, fontSize: 14, color: 'var(--astro-ink-soft)' }}>{a.name}</span>
                    <span style={{ fontFamily: "'Spectral', Georgia, serif", fontStyle: 'italic', fontSize: 12, color: 'var(--astro-ink-mute)', lineHeight: 1.3 }}>
                      {ASTRO_ASPECT_MEANINGS[a.name]}
                    </span>
                  </div>
                  <span className="astro-mono-num" style={{ color: 'var(--astro-ink-mute)' }}>{a.angle}</span>
                </div>
              ))}
            </section>
          </aside>
        )}
      </div>

      {/* EDIT PANEL */}
      {editing && (
        <div
          className="astro-edit-veil"
          onClick={() => setEditing(false)}
          role="button"
          aria-label="close edit panel"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') setEditing(false); }}
        >
          <div className="astro-edit-panel" onClick={e => e.stopPropagation()}>
            <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)' }}>edit · birth</div>
            <div className="astro-rule" />
            {(
              [
                { key: 'date' as const,  label: 'DATE',  ph: 'YYYY-MM-DD' },
                { key: 'time' as const,  label: 'TIME',  ph: 'HH:MM · TZ' },
                { key: 'place' as const, label: 'PLACE', ph: 'city, country' },
              ] as const
            ).map(f => (
              <div key={f.key} style={{ marginTop: 'var(--as-3)' }}>
                <div className="astro-mono" style={{ color: 'var(--astro-ink-mute)', marginBottom: 4 }}>{f.label}</div>
                <input
                  value={draft[f.key] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  placeholder={f.ph}
                  className="astro-input"
                  aria-label={f.label}
                />
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--as-4)', gap: 'var(--as-3)' }}>
              <button type="button" onClick={() => setEditing(false)} className="astro-mono" style={{ background: 'transparent', border: 'none', padding: '8px 0', color: 'var(--astro-ink-mute)', cursor: 'pointer' }}>
                cancel
              </button>
              <button type="button" onClick={saveNatal} className="astro-mono" style={{ background: 'transparent', border: 'none', padding: '8px 0', color: 'var(--astro-brass)', cursor: 'pointer' }}>
                → save
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .astrology-module {
          --astro-bg:          #14130F;
          --astro-bg-deep:     #0E0D0B;
          --astro-surface:     #1C1A16;
          --astro-ink:         #F2EEE4;
          --astro-ink-soft:    rgba(242,238,228,0.62);
          --astro-ink-mute:    rgba(242,238,228,0.38);
          --astro-ink-faint:   rgba(242,238,228,0.22);
          --astro-ink-ghost:   rgba(242,238,228,0.10);
          --astro-hairline:    rgba(242,238,228,0.10);
          --astro-hairline-s:  rgba(242,238,228,0.06);
          --astro-brass:       #D9A86C;
          --astro-brass-soft:  rgba(217,168,108,0.42);
          --astro-brass-faint: rgba(217,168,108,0.18);
          --as-1: 4px; --as-2: 8px; --as-3: 16px; --as-4: 24px;
          --as-5: 32px; --as-6: 48px; --as-7: 64px; --as-8: 96px;
        }
        .astrology-module.astro-glow-dawn  .astro-glow { background: radial-gradient(ellipse 620px 500px at 50% 45%, rgba(217,168,108,0.08) 0%, transparent 70%); }
        .astrology-module.astro-glow-noon  .astro-glow { background: radial-gradient(ellipse 620px 500px at 50% 45%, rgba(242,233,216,0.05) 0%, transparent 70%); }
        .astrology-module.astro-glow-dusk  .astro-glow { background: radial-gradient(ellipse 620px 500px at 50% 45%, rgba(217,168,108,0.10) 0%, transparent 70%); }
        .astrology-module.astro-glow-night .astro-glow { background: radial-gradient(ellipse 620px 500px at 50% 45%, rgba(136,181,200,0.04) 0%, transparent 70%); }
        .astro-glow { transition: background 4000ms ease; }
        .astro-mono {
          font-family: 'DM Mono', monospace;
          font-weight: 500; font-size: 10px;
          letter-spacing: 0.18em; text-transform: uppercase; line-height: 1.5;
        }
        .astro-mono-num {
          font-family: 'DM Mono', monospace;
          font-weight: 500; font-size: 11px;
          letter-spacing: 0.02em; font-variant-numeric: tabular-nums;
        }
        .astro-caption {
          font-family: 'Inter Tight', sans-serif;
          font-weight: 500; font-size: 18px;
          letter-spacing: -0.005em; line-height: 1.3;
          color: var(--astro-ink);
        }
        .astro-glyph {
          font-family: "Apple Symbols", "Segoe UI Symbol", sans-serif;
          font-feature-settings: "liga" off;
          fill: var(--astro-ink);
          user-select: none;
        }
        .astro-rule { height: 1px; background: var(--astro-hairline); margin: var(--as-2) 0 var(--as-3); width: 100%; }
        .astro-rail { display: flex; flex-direction: column; gap: var(--as-6); padding-top: var(--as-6); }
        .astro-block { display: flex; flex-direction: column; }
        .astro-pair { display: flex; flex-direction: column; gap: var(--as-2); margin-top: var(--as-3); }
        .astro-transit-row {
          display: grid; grid-template-columns: 22px 58px 1fr auto;
          gap: var(--as-2); align-items: center;
          background: transparent; border: none; padding: var(--as-2) 0;
          cursor: pointer; text-align: left; width: 100%; color: var(--astro-ink);
          transition: background 220ms ease, color 220ms ease;
        }
        .astro-transit-row:hover { background: var(--astro-ink-ghost); }
        .astro-transit-row.astro-active { color: var(--astro-brass); }
        .astro-transit-row.astro-active .astro-mono-num { color: var(--astro-brass) !important; }
        .astro-main { padding-top: var(--as-7); min-width: 0; }
        .astro-date-row { display: flex; justify-content: space-between; align-items: baseline; }
        .astro-date-left {
          font-family: 'Inter Tight', sans-serif;
          font-weight: 500; font-size: 32px; letter-spacing: -0.01em; line-height: 1.1;
          color: var(--astro-ink);
        }
        .astro-chart-wrap { display: flex; justify-content: center; align-items: center; margin: 0; position: relative; }
        .astro-chart { display: block; max-width: 100%; height: auto; }
        .astro-zodiac-glyph { opacity: 0; animation: astro-fade-in 400ms ease forwards; }
        .astro-rim-text { font-family: 'DM Mono', monospace; font-size: 8px; letter-spacing: 0.18em; fill: var(--astro-ink-faint); }
        .astro-stroke-draw {
          stroke-dasharray: 2000; stroke-dashoffset: 2000;
          animation: astro-stroke-draw 900ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
          animation-delay: 200ms;
        }
        @keyframes astro-stroke-draw { to { stroke-dashoffset: 0; } }
        .astro-zspoke, .astro-hspoke {
          stroke-dasharray: 40; stroke-dashoffset: 40;
          animation: astro-stroke-draw 480ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
        .astro-planet-g {
          opacity: 0;
          animation: astro-planet-in 400ms cubic-bezier(0.2,0.8,0.2,1) forwards,
                     astro-planet-breathe 4s ease-in-out infinite alternate;
          transform-origin: center;
        }
        @keyframes astro-planet-in { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        @keyframes astro-planet-breathe { from { opacity: 0.92; } to { opacity: 1; } }
        .astro-planet-g.astro-planet-dim .astro-planet-glyph,
        .astro-planet-g.astro-planet-dim text { fill: var(--astro-ink-mute); }
        .astro-planet-g:hover .astro-planet-glyph { fill: var(--astro-brass); }
        .astro-planet-g:focus-visible { outline: 1px solid var(--astro-brass-soft); }
        .astro-deg-mini {
          font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: 0.02em;
          fill: var(--astro-ink-mute); font-variant-numeric: tabular-nums;
          opacity: 0; animation: astro-fade-in 300ms ease 1700ms forwards;
        }
        @keyframes astro-fade-in { to { opacity: 1; } }
        .astro-aspect-line {
          stroke-dasharray: 600; stroke-dashoffset: 600;
          animation: astro-stroke-draw 420ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
          transition: stroke 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .astro-aspect-conj { opacity: 0; animation: astro-fade-in 300ms ease forwards; }
        .astro-moon-marker { animation: astro-fade-in 300ms ease 2100ms forwards; opacity: 0; }
        .astro-star { animation: astro-twinkle 4s ease-in-out infinite alternate; }
        @keyframes astro-twinkle { 0% { opacity: 0.25; } 100% { opacity: 0.6; } }
        .astro-aspects-list { display: flex; flex-direction: column; }
        .astro-aspect-row {
          display: grid; grid-template-columns: 20px 20px 1fr auto;
          gap: var(--as-2); align-items: center;
          padding: var(--as-3) var(--as-2);
          border: none; border-bottom: 1px solid var(--astro-hairline-s);
          background: transparent;
          font-family: 'Inter Tight', sans-serif; font-size: 13px; color: var(--astro-ink);
          cursor: pointer; text-align: left; width: 100%;
          transition: background 220ms ease;
        }
        .astro-aspect-row:hover { background: var(--astro-ink-ghost); }
        .astro-aspect-row:focus-visible { outline: 1px solid var(--astro-brass-soft); }
        .astro-legend-row {
          display: grid; grid-template-columns: 32px 1fr auto;
          gap: var(--as-3); align-items: center;
          padding: var(--as-3) 0; border-bottom: 1px solid var(--astro-hairline-s);
        }
        .astro-input {
          width: 100%; background: transparent;
          border: none; border-bottom: 1px solid var(--astro-hairline);
          outline: none; padding: 8px 0;
          font-family: 'Inter Tight', sans-serif; font-weight: 500;
          font-size: 17px; color: var(--astro-ink);
          letter-spacing: -0.005em; transition: border-color 220ms ease;
        }
        .astro-input::placeholder { color: var(--astro-ink-faint); }
        .astro-input:focus { border-bottom-color: var(--astro-brass-soft); }
        .astro-edit-veil {
          position: fixed; inset: 0; z-index: 50;
          background: rgba(14,12,10,0.72); backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center;
          animation: astro-fade-in 220ms ease-out forwards;
          cursor: pointer;
        }
        .astro-edit-panel {
          background: var(--astro-bg-deep);
          border: 1px solid var(--astro-hairline);
          padding: var(--as-6); min-width: 420px;
          animation: astro-fade-in 300ms ease-out forwards;
          cursor: default;
        }
        .astro-back:hover { border-color: var(--astro-ink-mute) !important; }
        .astro-reading {
          animation: astro-reading-in 480ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
          margin-top: var(--as-6); max-width: 640px;
        }
        @keyframes astro-reading-in {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .astro-reading-head {
          display: grid; grid-template-columns: 64px 1fr auto;
          gap: var(--as-4); align-items: center;
          padding-bottom: var(--as-4); border-bottom: 1px solid var(--astro-hairline);
        }
        .astro-reading-glyph {
          font-family: 'Apple Symbols', 'Segoe UI Symbol', sans-serif;
          font-size: 56px; line-height: 1; color: var(--astro-brass);
        }
        .astro-reading-title { min-width: 0; }
        .astro-reading-name {
          font-family: 'Inter Tight', sans-serif;
          font-weight: 600; font-size: 40px; line-height: 1;
          letter-spacing: -0.02em; color: var(--astro-ink); text-transform: lowercase;
        }
        .astro-reading-sub {
          font-family: 'Inter Tight', sans-serif;
          font-weight: 400; font-size: 15px; line-height: 1.3;
          color: var(--astro-ink-soft); margin-top: 6px; letter-spacing: -0.005em;
        }
        .astro-reading-close {
          width: 36px; height: 36px; border-radius: 50%;
          background: transparent; border: 1px solid var(--astro-hairline);
          color: var(--astro-ink-soft);
          font-family: 'Inter Tight', sans-serif; font-size: 22px; line-height: 1;
          cursor: pointer; transition: border-color 220ms ease, color 220ms ease;
        }
        .astro-reading-close:hover { border-color: var(--astro-brass-soft); color: var(--astro-brass); }
        .astro-reading-close:focus-visible { outline: 1px solid var(--astro-brass-soft); }
        .astro-reading-section { margin-top: var(--as-5); }
        .astro-reading-para {
          font-family: 'Spectral', Georgia, serif;
          font-style: italic; font-weight: 400;
          font-size: 20px; line-height: 1.55; letter-spacing: -0.003em;
          color: var(--astro-ink); margin-top: var(--as-3); margin-bottom: 0;
          max-width: 58ch;
        }
        .astro-reading-aspects { display: flex; flex-direction: column; gap: var(--as-3); margin-top: var(--as-3); }
        .astro-reading-aspect {
          display: grid; grid-template-columns: 22px auto 22px 1fr auto;
          gap: var(--as-2); align-items: baseline;
          padding: var(--as-2) 0; border-bottom: 1px solid var(--astro-hairline-s);
        }
        .astro-stagger { opacity: 0; transform: translateY(8px); }
        .astro-stagger-in { animation: astro-stagger-in 600ms cubic-bezier(0.2,0.8,0.2,1) forwards; animation-delay: var(--stagger-delay, 0ms); }
        @keyframes astro-stagger-in { to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 1180px) {
          .astrology-module .astro-grid { grid-template-columns: 1fr !important; }
          .astrology-module .astro-rail { padding-top: var(--as-4); }
        }
        @media (max-width: 820px) {
          .astro-chart { width: 100%; }
          .astro-edit-panel { min-width: unset; width: calc(100vw - 48px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .astro-zodiac-ring, .astro-zodiac-glyph, .astro-planet-g,
          .astro-aspect-line, .astro-aspect-conj, .astro-star,
          .astro-stroke-draw, .astro-zspoke, .astro-hspoke,
          .astro-deg-mini, .astro-moon-marker, .astro-glow,
          .astro-stagger, .astro-stagger-in, .astro-edit-veil, .astro-edit-panel {
            animation: none !important; transform: none !important;
            opacity: 1 !important; stroke-dashoffset: 0 !important;
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}
