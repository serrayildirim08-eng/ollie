/**
 * apps/web · ollie-ai
 *
 * Typed JS wrapper for the `OllieAI` app-local Capacitor plugin, which
 * bridges Apple's on-device FoundationModels framework (iOS 26 Apple
 * Intelligence). See apps/ios/ios/App/App/OllieAIPlugin.swift.
 *
 * The plugin only exists on the iOS native build. On web / desktop / older
 * iOS this wrapper degrades gracefully:
 *   - aiAvailable() → false
 *   - aiRoute()     → null
 *   - aiExtract()   → null
 * Callers MUST treat null / false as "fall back to the keyword router".
 *
 * The native side is reached through `window.Capacitor.registerPlugin`.
 * `apps/web` deliberately does NOT take a static dependency on
 * `@capacitor/core` (see biometric.ts / voice-capture.ts — same pattern):
 * the global is injected by the Capacitor runtime on the iOS build only.
 * On web / desktop there is no global, so the plugin is simply absent and
 * every method below short-circuits to the not-available branch.
 */

// ─── plugin surface (mirrors OllieAIPlugin.swift) ──────────────────────────

interface OllieAIPlugin {
  available(): Promise<{ available: boolean; reason?: string }>;
  route(options: { text: string; modules: string[] }): Promise<{
    routes: { module: string; text: string; confidence: number }[];
  }>;
  extract(options: { text: string; kind: string }): Promise<
    | { items: string[] }
    | { amount: number | null; currency: string | null; direction: string | null }
  >;
  /** NLEmbedding probe — true even on devices without Apple Intelligence. */
  embedAvailable(): Promise<{ available: boolean }>;
  /** On-device sentence embedding via NaturalLanguage's NLEmbedding. */
  embed(options: { text: string }): Promise<{ vector: number[] }>;
}

// ─── runtime guards ────────────────────────────────────────────────────────

interface CapacitorGlobal {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    registerPlugin?: <T>(name: string) => T;
  };
}

function isCapacitorIOS(): boolean {
  const g = globalThis as unknown as CapacitorGlobal;
  return (
    g.Capacitor?.isNativePlatform?.() === true &&
    g.Capacitor?.getPlatform?.() === 'ios'
  );
}

/**
 * Resolve the native OllieAI plugin via the global Capacitor runtime.
 * Returns null on web / desktop, or if the runtime is missing
 * `registerPlugin` (very old Capacitor). Memoised after first resolve.
 */
let pluginCache: OllieAIPlugin | null | undefined;
function getPlugin(): OllieAIPlugin | null {
  if (pluginCache !== undefined) return pluginCache;
  const g = globalThis as unknown as CapacitorGlobal;
  const reg = g.Capacitor?.registerPlugin;
  pluginCache = typeof reg === 'function' ? reg<OllieAIPlugin>('OllieAI') : null;
  return pluginCache;
}

// ─── Electron desktop bridge (Apple Intelligence on macOS) ─────────────────
//
// The Electron desktop build loads this same web bundle but is NOT
// Capacitor — so the `OllieAI` Capacitor plugin above is absent there.
// Instead `apps/desktop/preload.js` exposes `window.ollie.ai`, which the
// Electron main process backs with a native Swift CLI that talks to Apple's
// on-device FoundationModels framework (macOS 26 Apple Intelligence).
//
// The IPC surface mirrors the FoundationModels half of the Capacitor plugin
// (available / route / extract — no embed; NLEmbedding has no desktop port
// yet, embedAvailable() stays false there). When this surface is present we
// route through it; otherwise we fall through to the not-available branch.

interface OllieElectronAI {
  available(): Promise<{ available: boolean; reason?: string }>;
  route(options: { text: string; modules: string[] }): Promise<
    { routes?: unknown } | null
  >;
  extract(options: { text: string; kind: string }): Promise<
    | { items?: unknown }
    | { amount?: unknown; currency?: unknown; direction?: unknown }
    | null
  >;
}

interface OllieElectronGlobal {
  ollie?: {
    isElectron?: boolean;
    ai?: OllieElectronAI;
  };
}

/**
 * Resolve the Electron desktop AI bridge (`window.ollie.ai`). Returns null
 * on web / iOS where the Electron preload never ran. Not memoised — the
 * lookup is a couple of property reads and the global is stable anyway.
 */
function getElectronAI(): OllieElectronAI | null {
  const g = globalThis as unknown as OllieElectronGlobal;
  const ai = g.ollie?.ai;
  return ai && typeof ai.available === 'function' ? ai : null;
}

// ─── public types ──────────────────────────────────────────────────────────

export type AiExtractKind = 'grocery' | 'finance';

/** One split-out thought from a brain-dump, routed to a single module. */
export interface AiRouteItem {
  module: string;
  /** The distinct extracted thought — just this part of the dump. */
  text: string;
  confidence: number;
}

/** The on-device router's multi-route result — one item per thought. */
export interface AiRouteResult {
  routes: AiRouteItem[];
}

export interface AiGroceryExtract {
  items: string[];
}

export interface AiFinanceExtract {
  amount: number | null;
  currency: string | null;
  direction: 'income' | 'expense' | null;
}

// ─── availability ──────────────────────────────────────────────────────────

// Cache the probe — availability does not change within a session and the
// native round-trip is cheap but not free. `undefined` = not yet probed.
let availabilityCache: boolean | undefined;

/**
 * True when an on-device Apple-Intelligence model reports `.available`:
 *   - iOS — FoundationModels via the `OllieAI` Capacitor plugin (iOS 26,
 *     Apple-Intelligence hardware, AI enabled in Settings).
 *   - macOS desktop — FoundationModels via the Electron `window.ollie.ai`
 *     bridge (macOS 26, Apple-Intelligence hardware).
 * Everywhere else → false. Never throws.
 */
export async function aiAvailable(): Promise<boolean> {
  if (availabilityCache !== undefined) return availabilityCache;

  // Tier A — Capacitor plugin (iOS native build).
  if (isCapacitorIOS()) {
    const plugin = getPlugin();
    if (plugin) {
      try {
        const res = await plugin.available();
        availabilityCache = res.available === true;
      } catch {
        availabilityCache = false;
      }
      return availabilityCache;
    }
  }

  // Tier B — Electron desktop bridge (macOS Apple Intelligence).
  const electron = getElectronAI();
  if (electron) {
    try {
      const res = await electron.available();
      availabilityCache = res?.available === true;
    } catch {
      availabilityCache = false;
    }
    return availabilityCache;
  }

  // Neither surface present — web / unsupported.
  availabilityCache = false;
  return false;
}

/** Force a re-probe (e.g. after the user enables Apple Intelligence). */
export function resetAiAvailability(): void {
  availabilityCache = undefined;
}

// ─── routing ───────────────────────────────────────────────────────────────

/**
 * Split a brain-dump into its distinct thoughts and route EACH to one of
 * `modules` using the on-device model. Returns a list of `{module,text,
 * confidence}` items (one per thought), or null when the model is
 * unavailable or the call fails — the caller then falls back to the keyword
 * router. Never throws.
 */
export async function aiRoute(
  text: string,
  modules: string[],
): Promise<AiRouteResult | null> {
  if (!text.trim() || modules.length === 0) return null;
  if (!(await aiAvailable())) return null;

  /** Normalise a raw `{routes:[...]}` response into AiRouteResult. */
  const normalise = (res: { routes?: unknown } | null): AiRouteResult | null => {
    if (!res || typeof res !== 'object') return null;
    const rawRoutes = (res as { routes?: unknown }).routes;
    if (!Array.isArray(rawRoutes)) return null;
    const routes: AiRouteItem[] = [];
    for (const raw of rawRoutes) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as {
        module?: unknown;
        text?: unknown;
        confidence?: unknown;
      };
      if (typeof r.module !== 'string' || !r.module) continue;
      if (typeof r.text !== 'string' || !r.text.trim()) continue;
      const confidence =
        typeof r.confidence === 'number' && Number.isFinite(r.confidence)
          ? Math.min(Math.max(r.confidence, 0), 1)
          : 0;
      routes.push({ module: r.module, text: r.text.trim(), confidence });
    }
    if (routes.length === 0) return null;
    return { routes };
  };

  // Tier A — Capacitor plugin (iOS native build).
  const plugin = getPlugin();
  if (plugin) {
    try {
      return normalise(await plugin.route({ text, modules }));
    } catch {
      return null;
    }
  }

  // Tier B — Electron desktop bridge (macOS Apple Intelligence).
  const electron = getElectronAI();
  if (electron) {
    try {
      return normalise(await electron.route({ text, modules }));
    } catch {
      return null;
    }
  }

  return null;
}

// ─── extraction ────────────────────────────────────────────────────────────

/**
 * Pull structured content out of a dump.
 *   kind 'grocery' → AiGroceryExtract | null
 *   kind 'finance' → AiFinanceExtract | null
 * Returns null when unavailable / failed. Never throws.
 */
export async function aiExtract(
  text: string,
  kind: 'grocery',
): Promise<AiGroceryExtract | null>;
export async function aiExtract(
  text: string,
  kind: 'finance',
): Promise<AiFinanceExtract | null>;
export async function aiExtract(
  text: string,
  kind: AiExtractKind,
): Promise<AiGroceryExtract | AiFinanceExtract | null> {
  if (!text.trim()) return null;
  if (!(await aiAvailable())) return null;

  /** Normalise a raw extract response (either bridge) into the typed shape. */
  const normalise = (
    res: unknown,
  ): AiGroceryExtract | AiFinanceExtract | null => {
    if (!res || typeof res !== 'object') return null;
    if (kind === 'grocery') {
      const items = (res as { items?: unknown }).items;
      if (!Array.isArray(items)) return null;
      return {
        items: items
          .filter((i): i is string => typeof i === 'string')
          .map((i) => i.trim())
          .filter(Boolean),
      };
    }
    // finance
    const f = res as {
      amount?: unknown;
      currency?: unknown;
      direction?: unknown;
    };
    const amount =
      typeof f.amount === 'number' && Number.isFinite(f.amount)
        ? f.amount
        : null;
    const currency =
      typeof f.currency === 'string' && f.currency ? f.currency : null;
    const direction =
      f.direction === 'income' || f.direction === 'expense'
        ? f.direction
        : null;
    return { amount, currency, direction };
  };

  // Tier A — Capacitor plugin (iOS native build).
  const plugin = getPlugin();
  if (plugin) {
    try {
      return normalise(await plugin.extract({ text, kind }));
    } catch {
      return null;
    }
  }

  // Tier B — Electron desktop bridge (macOS Apple Intelligence).
  const electron = getElectronAI();
  if (electron) {
    try {
      return normalise(await electron.extract({ text, kind }));
    } catch {
      return null;
    }
  }

  return null;
}

// ─── NLEmbedding routing (tier 1 — free, on-device, every iPhone) ───────────
//
// Apple's NLEmbedding.sentenceEmbedding(for:.english) is part of the
// NaturalLanguage framework — it ships with iOS 13+ and runs on EVERY
// iPhone, including the A16 iPhone 15 Plus that has no Apple Intelligence.
// It is fully offline and free.
//
// Routing strategy: one short "exemplar" sentence describes each module.
// We embed every exemplar once (cached for the session) and embed the dump,
// then cosine-similarity → the best-matching module. Confidence is derived
// from the top score AND its margin over the runner-up — a dump that is
// almost equally close to two modules is *not* confident and must escalate.

/** One canonical exemplar sentence per routable module. */
export const MODULE_EXEMPLARS: Record<string, string> = {
  grocery: 'i bought groceries food pasta milk bread vegetables from the store',
  finance: 'i got paid money salary income or spent paid a bill rent expense',
  work: 'a work task project deadline meeting feature i need to build or finish',
  goals: 'a long-term goal or milestone i want to achieve over time',
  habits: 'a daily habit or routine i want to keep up like exercise or reading',
  sleep: 'how i slept last night, bedtime, wake time, how rested i feel',
  cycle: 'my menstrual cycle, period, ovulation, cramps or pms symptoms',
  health: 'a health symptom, doctor appointment, medication or how my body feels',
  body: 'my weight, body measurements, workout or physical training session',
  pets: 'my pet — feeding, vet visit, walk, grooming or pet supplies',
  admin: 'an administrative chore — paperwork, forms, renewals, appointments to book',
  astrology: 'astrology, my horoscope, the moon phase or zodiac signs',
};

/** Cosine similarity of two equal-length numeric vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Cache the embed-availability probe and the embedded exemplars — both are
// stable for the session. `embedAvailabilityCache` undefined = not probed.
let embedAvailabilityCache: boolean | undefined;
let exemplarVectorsCache: Record<string, number[]> | null | undefined;

/**
 * True on an iOS device where NLEmbedding can produce sentence vectors.
 * Unlike aiAvailable(), this does NOT require Apple Intelligence — it is
 * true on the iPhone 15 Plus. Everywhere off-device → false. Never throws.
 */
export async function embedAvailable(): Promise<boolean> {
  if (embedAvailabilityCache !== undefined) return embedAvailabilityCache;
  if (!isCapacitorIOS()) {
    console.log('[ollie-route] embedAvailable: not Capacitor-iOS');
    embedAvailabilityCache = false;
    return false;
  }
  const plugin = getPlugin();
  if (!plugin || typeof plugin.embedAvailable !== 'function') {
    console.log('[ollie-route] embedAvailable: plugin missing');
    embedAvailabilityCache = false;
    return false;
  }
  try {
    const res = await plugin.embedAvailable();
    console.log('[ollie-route] embedAvailable native result:', JSON.stringify(res));
    embedAvailabilityCache = res.available === true;
  } catch (e) {
    console.log('[ollie-route] embedAvailable THREW:', String((e as Error)?.message ?? e));
    embedAvailabilityCache = false;
  }
  return embedAvailabilityCache;
}

/** Force a re-probe of NLEmbedding availability. */
export function resetEmbedAvailability(): void {
  embedAvailabilityCache = undefined;
  exemplarVectorsCache = undefined;
}

/** Embed a single string on-device. Returns null on any failure. */
async function embedText(text: string): Promise<number[] | null> {
  if (!text.trim()) return null;
  const plugin = getPlugin();
  if (!plugin || typeof plugin.embed !== 'function') return null;
  try {
    const res = await plugin.embed({ text });
    const vec = res?.vector;
    if (!Array.isArray(vec) || vec.length === 0) {
      console.log('[ollie-route] embed returned empty vector for:', JSON.stringify(text.slice(0, 40)));
      return null;
    }
    if (!vec.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    return vec;
  } catch (e) {
    console.log('[ollie-route] embed THREW:', String((e as Error)?.message ?? e));
    return null;
  }
}

/** Embed every module exemplar once, memoised for the session. */
async function getExemplarVectors(): Promise<Record<string, number[]> | null> {
  if (exemplarVectorsCache !== undefined) return exemplarVectorsCache;
  const out: Record<string, number[]> = {};
  for (const [module, sentence] of Object.entries(MODULE_EXEMPLARS)) {
    const vec = await embedText(sentence);
    // If even one exemplar fails to embed the model is unusable — bail
    // out entirely rather than route against a partial exemplar set.
    if (!vec) {
      exemplarVectorsCache = null;
      return null;
    }
    out[module] = vec;
  }
  exemplarVectorsCache = out;
  return out;
}

export interface EmbedRouteResult {
  module: string;
  /** Raw top cosine score, 0..1. */
  topScore: number;
  /** Margin of the top score over the runner-up. */
  margin: number;
  /**
   * Derived confidence 0..1. Combines absolute score and the margin so a
   * dump that is close to two modules scores low even if topScore is high.
   */
  confidence: number;
}

// Confidence thresholds. A route is "confident" when confidence >= the
// threshold the caller checks (see EMBED_CONFIDENCE_THRESHOLD). These were
// picked conservatively — NLEmbedding sentence similarity rarely exceeds
// ~0.6 even for an on-topic match, so absolute scores are scaled.
export const EMBED_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Route a dump to the best module using on-device NLEmbedding cosine
 * similarity against the cached exemplars.
 *
 * Returns null when NLEmbedding is unavailable or the dump cannot be
 * embedded — the caller then escalates (Haiku) or falls back (keyword).
 * Never throws.
 */
export async function embedRoute(text: string): Promise<EmbedRouteResult | null> {
  if (!text.trim()) return null;
  if (!(await embedAvailable())) return null;

  const exemplars = await getExemplarVectors();
  if (!exemplars) return null;

  const dumpVec = await embedText(text);
  if (!dumpVec) return null;

  // Score the dump against every exemplar.
  let best = { module: '', score: -1 };
  let second = { module: '', score: -1 };
  for (const [module, vec] of Object.entries(exemplars)) {
    if (vec.length !== dumpVec.length) continue; // dimensional mismatch — skip
    const score = cosineSimilarity(dumpVec, vec);
    if (score > best.score) {
      second = best;
      best = { module, score };
    } else if (score > second.score) {
      second = { module, score };
    }
  }
  if (!best.module) return null;

  const topScore = Math.max(0, best.score);
  const margin = Math.max(0, best.score - Math.max(0, second.score));

  // Confidence model:
  //   - scaledScore: NLEmbedding similarity tops out well below 1.0 for
  //     real matches, so we scale: 0.45 raw → ~confident, 0.6 raw → strong.
  //   - marginBoost: a clear gap over the runner-up adds confidence; an
  //     ambiguous dump (tiny margin) is held back even with a high score.
  const scaledScore = Math.min(1, topScore / 0.6);
  const marginBoost = Math.min(1, margin / 0.12);
  const confidence = Math.min(1, 0.65 * scaledScore + 0.35 * marginBoost);

  return { module: best.module, topScore, margin, confidence };
}
