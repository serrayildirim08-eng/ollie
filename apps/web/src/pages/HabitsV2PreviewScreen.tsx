/**
 * HabitsV2PreviewScreen — dev-only preview of the clean-slate v2 habits
 * submodule
 *
 * Mounted at `/preview/habits` (hash route `index.html#/preview/habits`).
 * This is a DEV PREVIEW: it lets Serra open and click through the real,
 * runnable v2 habits rebuild on the iPhone WITHOUT replacing the working
 * app. The full migration/swap is a later decision.
 *
 * It is mounted OUTSIDE `GatedLayout` (like `/crisis`, `/preview/money`,
 * `/preview/cycle`, `/preview/sleep`, `/preview/body` and
 * `/preview/medication`) so it is reachable directly, and it does NOT
 * appear in any main-flow navigation — you only land here by
 * typing/opening the URL. The live `modules/habits` module and the app's
 * current navigation are untouched.
 *
 * The v2 module reads + writes the SAME `shared.habits_v2` +
 * `habits.patterns` store the live module uses — so it shows Serra's real
 * habits, and anything checked in here is real.
 */
import { HabitsApp } from '../modules/habits-v2/HabitsApp';

export interface HabitsV2PreviewScreenProps {
  /** return out of the preview (the router passes a navigate-home) */
  onExit: () => void;
  /** open the crisis surface from the Safe dot */
  onSafe: () => void;
}

export function HabitsV2PreviewScreen({
  onExit,
  onSafe,
}: HabitsV2PreviewScreenProps) {
  return <HabitsApp onExit={onExit} onSafe={onSafe} />;
}
