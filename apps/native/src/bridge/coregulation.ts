/**
 * apps/native · bridge/coregulation.ts  —  the dump pet-mention / mood flow
 *
 * WHY THIS EXISTS (audit S8 · gap 3)
 * ──────────────────────────────────
 * The pets co-regulation detector (packages/logic/src/pets/patterns.ts →
 * `pet-co-regulator`) reads `pets.coregulation_log` — a stream of
 * CoregulationEntry { ts, pet_present, sentiment, pet_id? }. It compares how
 * often the user's dumps read "calm" WITH a pet around vs WITHOUT, and surfaces
 * the bond if calmer dumps cluster near the pets.
 *
 * pets/bridge.ts deliberately READ-MERGES that key (it never owns it) and its
 * header says the log is "fed by the dump mood/pet-mention flow" — but that
 * flow was never built, so the log stayed empty forever and the detector ran on
 * empty input. This is that flow: on every dump we append ONE entry tagging the
 * dump's sentiment (via the same local mood lexicon the rest of the app uses)
 * and whether a pet was present (a pets fragment in the routed output).
 *
 * No model, no cloud — offline lexicon only, so it agrees with the goals
 * low-mood lock + finance doom-buying by construction.
 */

import type { Store } from '@ollie/store';
import type { CoregulationEntry, CoregSentiment } from '@ollie/logic/pets';
import type { RouterOutput } from '../router/schema';
import { tagDumpMood } from '../dump/mood-lexicon';
import { normalisePetName } from '../modules/pets/types';

/** Keep the log bounded — the detector only ever looks back 30 days. */
const COREG_CAP = 500;
const COREG_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Map the dump mood lexicon ('low' | 'neutral' | 'high') onto the detector's
 * sentiment vocabulary. The detector's "calm" bucket is calm|neutral; a
 * distressed (low) dump is the agitated counter-signal. A high/energised dump
 * is treated as calm-adjacent for the binary calm-vs-agitated lift.
 */
function moodToSentiment(mood: 'low' | 'neutral' | 'high'): CoregSentiment {
  if (mood === 'low') return 'agitated';
  if (mood === 'high') return 'calm';
  return 'neutral';
}

/**
 * Derive a roster-matching pet_id from a pets fragment, if one carries a
 * petName. Mirrors pets/bridge.ts's `petIdFor(normalisePetName(name))` so the
 * detector's per-pet attribution lines up with the synthesized roster.
 */
function petIdFromOutput(output: RouterOutput): string | undefined {
  for (const f of output.fragments) {
    if (f.module !== 'pets') continue;
    const payload = f.payload as { petName?: unknown };
    const raw = typeof payload?.petName === 'string' ? payload.petName : null;
    const norm = normalisePetName(raw);
    if (norm) return `pet:${norm}`;
  }
  return undefined;
}

/**
 * Append one CoregulationEntry for this dump. Read-merge + cap + age-prune so a
 * re-run never wipes prior entries and the slice can't grow unbounded.
 * Never throws — runs inside the dispatch path.
 */
export function recordCoregulationFromDump(store: Store, output: RouterOutput): void {
  try {
    if (!output || !Array.isArray(output.fragments)) return;
    const ts = typeof output.timestamp === 'number' ? output.timestamp : Date.now();
    const sentiment = moodToSentiment(tagDumpMood(output.originalDump ?? ''));
    const petPresent = output.fragments.some((f) => f.module === 'pets');
    const petId = petPresent ? petIdFromOutput(output) : undefined;

    const entry: CoregulationEntry = {
      ts,
      pet_present: petPresent,
      sentiment,
      ...(petId ? { pet_id: petId } : {}),
    };

    const prev = store.get<CoregulationEntry[]>('pets', 'coregulation_log', []) ?? [];
    const cutoff = ts - COREG_MAX_AGE_MS;
    const next = [...prev.filter((e) => e && typeof e.ts === 'number' && e.ts >= cutoff), entry];
    // Cap to the most-recent COREG_CAP entries.
    const capped = next.length > COREG_CAP ? next.slice(next.length - COREG_CAP) : next;
    store.set('pets', 'coregulation_log', capped);
  } catch {
    // Never throw inside dispatch.
  }
}
