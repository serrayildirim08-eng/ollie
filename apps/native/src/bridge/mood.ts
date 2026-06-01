/**
 * apps/native · bridge/mood.ts  —  the mood-signal hook point
 *
 * Several Layer-2 features depend on a mood signal that, per the audit, has
 * ZERO callers today — so `goals_mood_log` is always empty and the features
 * fail open / never fire:
 *   - goals' low-mood delete lock (don't let a user nuke a goal on a bad day)
 *   - finance doom-buying detector (low mood + spend burst)
 *   - a few cross-module bridges
 *
 * This is the single wiring point: the dump dispatch flow calls
 * recordMoodFromDump(store, dumpText) on every dump (see dispatch.ts). The
 * dump module agent fills the body: tag the dump text with a mood reading and
 * append it to the mood log the orchestrator reads (e.g. `goals_mood_log` /
 * the recordMoodSignal path in packages/orchestrator).
 *
 * Stub is a NO-OP so it compiles and the call site exists. Never throw — it
 * runs inside the dispatch path.
 *
 * Edit: dump module agent fills this; bridge owner keeps the call site.
 */

import type { Store } from '@ollie/store';
import { tagDumpMood } from '../dump/mood-lexicon';
import { goals as goalsRepo } from '../modules/goals/repo';

export async function recordMoodFromDump(store: Store, dumpText: string): Promise<void> {
  // `store` is unused: the two mood consumers don't need a store write here.
  //   • finance doom-buying reads `dump.items` directly (written by the dump
  //     bridge, modules/dump/bridge.ts) and re-applies its own LOW_MOOD_RE —
  //     so persisting the dump archive already feeds it; nothing to do here.
  //   • the goals low-mood delete lock reads the SQLite `goals_mood_log` table
  //     (goals/repo.ts canDelete → detectLowMood). That table had ZERO writers
  //     (audit: lock always failed open). We feed it below.
  void store;

  try {
    const text = typeof dumpText === 'string' ? dumpText.trim() : '';
    if (!text) return;

    // Tag with the SAME local lexicon the goals detector uses (offline, no
    // model, no cloud) so the tag and the lock agree by construction.
    const mood = tagDumpMood(text);

    // Only low-mood dumps are signal for the delete lock — detectLowMood needs
    // ≥3 low-mood markers in 7d (or ≥2 in 48h) before it locks, and it
    // re-tests each stored row with LOW_MOOD_RE. Recording only low-mood texts
    // keeps the (capped, self-pruning) log dense and the threshold honest;
    // neutral/high dumps would never match LOW_MOOD_RE anyway.
    if (mood !== 'low') return;

    // recordMoodSignal appends to goals_mood_log + self-prunes (≤50 rows /
    // 14 days). This is the ONLY writer of that table — wiring it activates the
    // low-mood delete lock + the gentle hold surface in GoalsBox.
    await goalsRepo.recordMoodSignal(text);
  } catch {
    // Never throw — this runs inside the dispatch path (see dispatch.ts).
  }
}
