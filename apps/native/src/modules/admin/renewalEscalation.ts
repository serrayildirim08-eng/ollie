/**
 * apps/native · modules/admin/renewalEscalation.ts  —  wave-2 renewal tiers
 *
 * The orchestrator (packages/orchestrator/src/admin.ts) decides the TIER of a
 * renewal by proximity and EMITS — it cannot import native notify / SQLite (no
 * native dep). This is the native consumer that performs the side effects for
 * the two non-card tiers:
 *
 *   • admin:renewal_notify_due  (~1 month out) → schedule a REAL app-closed
 *     local notification via the EVENT path (scheduleAt → emit
 *     'ollie-schedule-notif', NEVER invoke() — ACL-safe over iOS localhost),
 *     fanned out to the server-push path too (mirrors scheduleTaskReminder).
 *   • admin:renewal_autotodo_due (~1 week out) → AUTOMATICALLY add the renewal
 *     to /todo via the wave-1 add_admin_task executor (no offer, no tap — the
 *     one tier-D place, because a week-out ID/legal renewal is too important to
 *     wait on a card).
 *
 * IDEMPOTENCY (harness rule): each side effect is gated on a persisted marker
 * set (mirroring admin.ts's `_appointmentCompletedIds`), so re-subscribing on
 * HMR / re-emitting on recompute never double-schedules or double-inserts.
 * Notification scheduling additionally uses a stable id (`renewal-notify:<id>`)
 * so even if the marker is lost the OS/dispatcher dedupes.
 *
 * GO-DARK / quiet respect: the 1-month notification rides the SAME fan-out as
 * every other reminder — the OS scheduler + the cron dispatcher both honor the
 * user's quiet-hours / focus-session suppression and the dedupe_key. The
 * tier-D auto-add is a /todo ROW insert (not a push), so it surfaces silently
 * and disturbs nothing.
 */

import { onEvent, type Unsubscribe } from '@ollie/orchestrator';
import type { Store } from '@ollie/store';

import { scheduleAt } from '../../notify/systemNotify';
import { scheduleServerReminder } from '../../notify/serverReminder';
import { OLLIE_REMINDER_CATEGORY } from '../../notify/notificationActions';
import { executeAction } from '../brain/actions';
import { partnerRepo } from '../partner/repo';

/**
 * Is the user "taking today off" (go-dark)? Best-effort — any read failure
 * resolves to NOT dark so a broken partner read never silences a real renewal.
 */
async function isTakingDayOff(): Promise<boolean> {
  try {
    const state = await partnerRepo.load();
    return partnerRepo.isDarkToday(state);
  } catch {
    return false;
  }
}

/** Persisted "already handled" marker sets — one per tier, capped defensively. */
const NOTIFIED_KEY = '_renewalNotifiedIds';
const AUTOTODO_KEY = '_renewalAutoTodoIds';
/** Auto-adds DEFERRED because the user is taking the day off. The orchestrator
 *  emits admin:renewal_autotodo_due exactly ONCE per renewal, so a go-dark day
 *  must PARK the payload here (not drop it) and drain it once the user resumes. */
const AUTOTODO_PENDING_KEY = '_renewalAutoTodoPending';
const MARKER_CAP = 200;

/** A parked auto-add payload — the minimum the executor needs to add the task. */
interface PendingAutoTodo {
  id: string;
  type: string;
  dueDate: string | null;
}

/** A renewal that should fire its 1-month local notification. */
interface RenewalNotifyPayload {
  renewal_id?: unknown;
  renewalType?: unknown;
  dueDate?: unknown;
  days_left?: unknown;
}

/** A renewal that should be auto-added to /todo (1-week tier). */
interface RenewalAutoTodoPayload {
  renewal_id?: unknown;
  renewalType?: unknown;
  dueDate?: unknown;
}

/** Read a persisted marker set from the store. Best-effort. */
function readMarkers(store: Store, key: string): Set<string> {
  const arr = store.get<string[]>('admin', key, []) ?? [];
  return new Set(arr.filter((s): s is string => typeof s === 'string'));
}

/** Persist a marker set (newest-kept cap). Best-effort. */
function writeMarkers(store: Store, key: string, set: Set<string>): void {
  const arr = [...set].slice(-MARKER_CAP);
  store.set('admin', key, arr);
}

/**
 * 1-month tier: schedule the renewal heads-up as an app-closed local
 * notification. Fires soon (a small lead) so the user gets the ~1-month notice;
 * mirrors scheduleTaskReminder's OS-local + server fan-out under one stable id.
 */
function onRenewalNotifyDue(store: Store, raw: unknown): void {
  try {
    const p = (raw ?? {}) as RenewalNotifyPayload;
    const id = typeof p.renewal_id === 'string' ? p.renewal_id : '';
    if (!id) return;
    const type = typeof p.renewalType === 'string' && p.renewalType.trim()
      ? p.renewalType.trim()
      : 'a renewal';

    const notified = readMarkers(store, NOTIFIED_KEY);
    if (notified.has(id)) return; // already scheduled for this renewal.

    const dedupeId = `renewal-notify:${id}`;
    // Fire shortly after detection — the value is the heads-up itself, not a
    // precise future moment; a small lead avoids scheduleAt's "<1s → fire now"
    // path swallowing the notification before the OS is ready.
    const fireAt = Date.now() + 5 * 60 * 1000; // ~5 min lead
    const title = 'renewal coming up';
    const body = `${type} renews in about a month`;

    // OS-local (app-quit-safe) via the EVENT path — scheduleAt emits
    // 'ollie-schedule-notif', never invoke().
    scheduleAt(
      fireAt,
      {
        title,
        body,
        actionTypeId: OLLIE_REMINDER_CATEGORY,
        extra: { module: 'admin', refId: id },
      },
      dedupeId,
    );
    // Server-push (app-fully-closed) under the SAME dedupe key — whichever
    // lands first wins; the cron honors quiet-hours + dedupe.
    scheduleServerReminder(
      {
        title,
        body,
        category: 'REMINDER',
        dedupe_key: dedupeId,
        action_url: 'ollie://todo',
        notification_category: OLLIE_REMINDER_CATEGORY,
      },
      fireAt,
    );

    notified.add(id);
    writeMarkers(store, NOTIFIED_KEY, notified);
  } catch (err) {
    console.error('[admin] renewal notify-due failed (non-fatal):', err);
  }
}

/**
 * Read the parked-while-dark queue. Best-effort; drops malformed rows.
 */
function readPending(store: Store): PendingAutoTodo[] {
  const arr = store.get<PendingAutoTodo[]>('admin', AUTOTODO_PENDING_KEY, []) ?? [];
  return arr.filter(
    (r): r is PendingAutoTodo => !!r && typeof r.id === 'string' && r.id.length > 0,
  );
}

function writePending(store: Store, list: PendingAutoTodo[]): void {
  store.set('admin', AUTOTODO_PENDING_KEY, list.slice(-MARKER_CAP));
}

/**
 * Actually add ONE renewal to /todo via the wave-1 add_admin_task executor, and
 * stamp the done-marker. Returns true if added (or already added). Shared by the
 * live event handler and the deferred-queue drain.
 */
async function performAutoTodo(store: Store, item: PendingAutoTodo): Promise<boolean> {
  const added = readMarkers(store, AUTOTODO_KEY);
  if (added.has(item.id)) return true; // already auto-added this renewal.
  const ok = await executeAction({
    kind: 'add_admin_task',
    label: '',
    payload: { kind: 'add_admin_task', text: `renew ${item.type}`, dueDate: item.dueDate },
  });
  if (!ok) return false; // executor failed — leave unmarked so a retry can land it.
  added.add(item.id);
  writeMarkers(store, AUTOTODO_KEY, added);
  return true;
}

/**
 * Drain any renewals parked while the user was taking the day off. No-op while
 * still dark. Called at boot and on every renewal event so a parked auto-add
 * lands the moment the user resumes — the orchestrator only emits each once, so
 * this queue (not a re-emit) is what guarantees a go-dark day never drops it.
 */
async function drainPendingAutoTodo(store: Store): Promise<void> {
  const pending = readPending(store);
  if (pending.length === 0) return;
  if (await isTakingDayOff()) return; // still off — leave everything parked.
  const stillPending: PendingAutoTodo[] = [];
  for (const item of pending) {
    const ok = await performAutoTodo(store, item).catch(() => false);
    if (!ok) stillPending.push(item); // keep failures parked for the next drain.
  }
  writePending(store, stillPending);
}

/**
 * 1-week tier: AUTO-add the renewal to /todo via the wave-1 add_admin_task
 * executor. No offer, no tap. Gated on a persisted marker so it inserts ONCE
 * per renewal even across re-emits / restarts.
 *
 * Go-dark respect: this is the one tier-D AUTOMATIC action. While the user is
 * "taking today off", PARK the payload (the orchestrator emits each renewal only
 * once, so dropping it would lose it) and drain on resume.
 */
function onRenewalAutoTodoDue(store: Store, raw: unknown): void {
  void (async () => {
    try {
      const p = (raw ?? {}) as RenewalAutoTodoPayload;
      const id = typeof p.renewal_id === 'string' ? p.renewal_id : '';
      if (!id) return;
      const type = typeof p.renewalType === 'string' && p.renewalType.trim()
        ? p.renewalType.trim()
        : 'renewal';
      const dueDate = typeof p.dueDate === 'string' && p.dueDate.trim() ? p.dueDate.trim() : null;

      if (readMarkers(store, AUTOTODO_KEY).has(id)) return; // already done.

      // First, drain anything previously parked (resume case).
      await drainPendingAutoTodo(store);

      const item: PendingAutoTodo = { id, type, dueDate };
      if (await isTakingDayOff()) {
        // Park (deduped by id) — do NOT auto-mutate /todo while resting.
        const pending = readPending(store);
        if (!pending.some((q) => q.id === id)) writePending(store, [...pending, item]);
        return;
      }

      await performAutoTodo(store, item);
    } catch (err) {
      console.error('[admin] renewal auto-todo failed (non-fatal):', err);
    }
  })();
}

/**
 * Register the two renewal-escalation event consumers. Called once from the app
 * composition root (store.ts). Returns an unsubscribe fn for teardown on quit.
 */
export function installRenewalEscalation(store: Store): Unsubscribe {
  const unsubs: Unsubscribe[] = [
    onEvent('admin:renewal_notify_due', (raw) => onRenewalNotifyDue(store, raw)),
    onEvent('admin:renewal_autotodo_due', (raw) => onRenewalAutoTodoDue(store, raw)),
  ];
  // Resume case: a renewal parked on a previous (dark) day lands on next boot
  // once the user is no longer taking the day off. Best-effort; never throws.
  void drainPendingAutoTodo(store).catch(() => {});
  return () => unsubs.splice(0).forEach((fn) => fn());
}
