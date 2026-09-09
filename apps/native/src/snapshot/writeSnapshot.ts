/**
 * App Group snapshot writer (A7).
 *
 * After the brain picks today's noticings, serialise {picks, quietState,
 * generatedAt} plus a few precomputed "canned ASK" answers and hand them to the
 * Rust side (via the `ollie-write-snapshot` event, since the localhost webview
 * is ACL-blocked from invoking app commands). Rust writes snapshot.json into the
 * App Group container so a future WidgetKit extension / Siri App Intent can read
 * today's state WITHOUT launching the app.
 *
 * Best-effort: every source is wrapped so one failure can't break the snapshot,
 * and outside a Tauri runtime the whole thing is a silent no-op.
 */

export interface SnapshotPick {
  text: string;
  hasAction: boolean;
}

export interface OllieSnapshot {
  generatedAt: number;
  quietState: boolean;
  picks: SnapshotPick[];
  answers: {
    monthSpend?: { total: number; currency: string | null } | null;
    pantry?: { count: number; items: string[] } | null;
    nextBill?: { merchant: string; amount: number | null; currency: string | null } | null;
  };
}

function inTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

/** Gather the cheap canned-ASK answers. Each source is independently guarded. */
async function buildAnswers(): Promise<OllieSnapshot['answers']> {
  const answers: OllieSnapshot['answers'] = {};
  try {
    const { getMonthlyBurn } = await import('../modules/finance');
    const burn = await getMonthlyBurn();
    const top = burn[0];
    if (top) answers.monthSpend = { total: top.total, currency: top.currency };
  } catch { /* finance unavailable */ }
  try {
    const { pantry } = await import('../modules/grocery');
    const items = await pantry.list();
    answers.pantry = { count: items.length, items: items.slice(0, 6).map((i) => i.name) };
  } catch { /* grocery unavailable */ }
  try {
    const { bills } = await import('../modules/finance');
    const list = await bills.list();
    const next = list[0];
    if (next) answers.nextBill = { merchant: next.merchant, amount: next.amount, currency: next.currency };
  } catch { /* bills unavailable */ }
  return answers;
}

/**
 * Build + write the snapshot. `picks` are the resolved noticing copy strings the
 * home screen is showing, paired with whether each has an offered action.
 */
export async function writeSnapshot(
  picks: SnapshotPick[],
  now: number = Date.now(),
): Promise<void> {
  if (!inTauri()) return;
  try {
    const snapshot: OllieSnapshot = {
      generatedAt: now,
      quietState: picks.length === 0,
      picks,
      answers: await buildAnswers(),
    };
    const { emit } = await import('@tauri-apps/api/event');
    await emit('ollie-write-snapshot', JSON.stringify(snapshot));
  } catch {
    /* snapshot is best-effort — never disrupt the UI */
  }
}
