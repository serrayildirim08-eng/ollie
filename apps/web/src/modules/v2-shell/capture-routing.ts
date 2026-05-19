/**
 * v2-shell · capture routing — where a thrown thought landed
 *
 * The real brain-dump write goes through `applyDump` (the shell's bridge
 * to `useApplyBrainDump`). That pipeline is fire-and-forget — it does NOT
 * report which drawer the thought sorted into.
 *
 * The Caught screen (caught.html) needs exactly that: "the thought you
 * threw + the drawer glyph it sorted into". So the shell ALSO runs
 * `extract()` read-only — the same keyword router, no store writes — purely
 * to name the destination. This is cheap (pure, in-memory) and keeps Caught
 * honest: it shows where the live pipeline actually routed the thought.
 *
 * `classifyThrow` returns the catch record; `dump` is the fallback drawer
 * for a thought no module claimed (the thrown-thought archive).
 */
import { extract } from '@ollie/logic/dissection';
import type { ModuleName } from '@ollie/logic/dissection';
import type { SubmoduleKey } from './types';

/** a single caught thought, as the Caught screen shows it */
export interface CaughtThought {
  /** the thought, verbatim */
  text: string;
  /** when it was thrown */
  at: number;
  /** the human drawer name shown under the card ("admin", "grocery", …) */
  drawer: string;
  /**
   * the submodule the thought belongs to, if Caught should offer a jump.
   * `null` for an archive-only catch (the `dump` drawer, or a reminder).
   */
  submodule: SubmoduleKey | null;
}

/**
 * Map a dissection `ModuleName` to a v2 submodule + a drawer label.
 * `finance` → `money`; `health` folds into `body`; `reminders` / `dump` /
 * `astrology` have no v2 submodule, so they archive under "the notebook".
 */
function mapModule(m: ModuleName): { drawer: string; submodule: SubmoduleKey | null } {
  switch (m) {
    case 'finance':
      return { drawer: 'money', submodule: 'money' };
    case 'cycle':
      return { drawer: 'cycle', submodule: 'cycle' };
    case 'sleep':
      return { drawer: 'sleep', submodule: 'sleep' };
    case 'body':
    case 'health':
      return { drawer: 'body', submodule: 'body' };
    case 'habits':
      return { drawer: 'habits', submodule: 'habits' };
    case 'admin':
      return { drawer: 'admin', submodule: 'admin' };
    case 'pets':
      return { drawer: 'pets', submodule: 'pets' };
    case 'grocery':
      return { drawer: 'grocery', submodule: 'grocery' };
    case 'work':
      return { drawer: 'work', submodule: 'work' };
    case 'goals':
      return { drawer: 'goals', submodule: 'goals' };
    case 'reminders':
      return { drawer: 'reminders', submodule: null };
    case 'astrology':
    case 'dump':
    default:
      return { drawer: 'the notebook', submodule: null };
  }
}

/**
 * Classify a thrown thought for the Caught screen — read-only, no writes.
 * Picks the FIRST routed module (the primary drawer, matching the live
 * pipeline's `actions[0]` framing); falls back to the archive drawer when
 * nothing claimed it or the input was a question.
 */
export function classifyThrow(text: string, at: number): CaughtThought {
  let drawer = 'the notebook';
  let submodule: SubmoduleKey | null = null;
  try {
    const route = extract(text);
    if (Array.isArray(route) && route.length > 0) {
      const mapped = mapModule(route[0].module);
      drawer = mapped.drawer;
      submodule = mapped.submodule;
    }
  } catch {
    // a router fault never breaks capture — the thought is still caught,
    // it just lands in the archive drawer.
  }
  return { text, at, drawer, submodule };
}
