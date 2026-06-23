/**
 * /todo · cross-module bullet list.
 *
 * The user never types into this screen. Every bullet is a row some
 * module's repo holds because the brain dump router landed an action
 * there (admin.create_phone_task → "call mom about christmas" etc.).
 * Here we just read each module's `listOpen()`, aggregate via the pure
 * helpers in `./aggregateTodos`, render bullets, and let the user check
 * items off — which writes back to the originating module.
 *
 * Coverage (see `./aggregateTodos.ts` for the full action table):
 *   admin · create_task / create_phone_task / schedule_appointment / log_renewal
 *   work  · create_task / log_deadline
 *   grocery · shopping_list_add
 *
 * Group strategy: date buckets (today / this week / later / no date).
 * Rationale per the brief: ADHD priority surfaces first. Source module
 * shows up as a quiet caption on each row, not as a section header.
 *
 * Read/write pattern mirrors AdminBox: migrate on mount, refresh on poll
 * + window focus, optimistic removal on click. No observable layer over
 * SQLite yet so the poll stays.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import { Row, Stack } from '../layout';
import { Text } from '../ui';
import { colors, durations, easings, radii, shadows } from '../theme/tokens';
import {
  migrateAdmin,
  recurringDecisions as adminDecisionsRepo,
  renewals as adminRenewalsRepo,
  tasks as adminTasksRepo,
} from '../modules/admin';
import {
  migrateFinance,
  pending as financePendingRepo,
  subscriptions as financeSubscriptionsRepo,
} from '../modules/finance';
import {
  migrateGrocery,
  shopping as groceryShoppingRepo,
} from '../modules/grocery';
import { migrateWork, tasks as workTasksRepo } from '../modules/work';
import { onTaskCompleted } from '../notify/datelessLadderHook';
import {
  aggregateTodos,
  bucketTodos,
  isoToday,
  type TodoItem,
  type TodoSource,
} from './aggregateTodos';

// ─── style atoms ──────────────────────────────────────────────────────────

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

const POLL_MS = 6000;

const BULLET_SIZE = 6;     // 6px square hairline bullet, editorial restraint
const ROW_PAD_Y = 14;      // touch target without bloating the rhythm

const FADE_OUT_MS = 200;

// ─── completion routing ──────────────────────────────────────────────────
//
// Each module exposes its own markComplete-style call. We dispatch by
// source so the screen stays one component and the modules stay isolated.
//
// Decision rows don't use markComplete — they use the decision handlers
// below. The source guards here only fire for 'task' kind rows.

async function markComplete(item: TodoItem): Promise<void> {
  if (item.source === 'admin') {
    if (item.action === 'log_renewal') {
      await adminRenewalsRepo.markComplete(item.rowId);
      return;
    }
    await adminTasksRepo.markComplete(item.rowId);
    // Completing in-app cancels any remaining date-less ladder tiers.
    await onTaskCompleted('admin', item.rowId);
    return;
  }
  if (item.source === 'work') {
    await workTasksRepo.markComplete(item.rowId);
    await onTaskCompleted('work', item.rowId);
    return;
  }
  // source === 'grocery'
  await groceryShoppingRepo.markPurchased(item.rowId);
}

// ─── decision routing ─────────────────────────────────────────────────────
//
// "cancel", "keep", "decide later" button actions for DECISION variant rows.
//
// Name fuzzy match for cancel → subscription cross-link:
//   "chatgpt subscription" → extract first word before " subscription" → "chatgpt"
//   "netflix monthly"      → first significant word                    → "netflix"
//   Strategy: take all words from `what`, filter out known suffixes
//   (subscription, monthly, yearly, plan, service), use the first
//   remaining word as the lookup key. Falls back to full `what` if nothing
//   matches. Case-insensitive LIKE query in the repo handles partial match.

const SUBSCRIPTION_SUFFIX_WORDS = new Set([
  'subscription', 'subscriptions', 'monthly', 'yearly', 'annual', 'weekly',
  'plan', 'service', 'membership', 'account',
]);

function extractSubscriptionKey(what: string): string {
  const words = what.toLowerCase().trim().split(/\s+/);
  const meaningful = words.filter((w) => !SUBSCRIPTION_SUFFIX_WORDS.has(w));
  return meaningful[0] ?? what.toLowerCase().trim();
}

async function applyDecision(
  item: TodoItem,
  decision: 'cancel' | 'keep' | 'later',
  nowMs: number,
): Promise<void> {
  if (item.source === 'admin_decision') {
    await adminDecisionsRepo.decide(item.rowId, decision, nowMs);
    if (decision === 'cancel') {
      // Cross-link: mark the matching subscription_log row as canceled.
      // Extract the subscription name key from the decision's `what`.
      // item.text is "decide: <what>" — strip the prefix to recover `what`.
      const rawWhat = item.text.replace(/^decide:\s*/i, '');
      const subKey = extractSubscriptionKey(rawWhat);
      await financeSubscriptionsRepo.markCanceled(subKey, nowMs);
    }
    return;
  }
  // source === 'finance_decision'
  if (decision === 'cancel') {
    // finance.pending_decision "cancel" maps to 'skip' on the pending repo.
    await financePendingRepo.decide(item.rowId, 'skip', nowMs);
  } else if (decision === 'keep') {
    await financePendingRepo.decide(item.rowId, 'proceed', nowMs);
  } else {
    await financePendingRepo.decide(item.rowId, 'later', nowMs);
  }
}

// ─── screen ───────────────────────────────────────────────────────────────

export function TodoScreen(): JSX.Element {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [ready, setReady] = useState(false);
  // Optimistic fade-out set — items mid-removal stay rendered with reduced
  // opacity for FADE_OUT_MS then drop entirely.
  const [fadingIds, setFadingIds] = useState<readonly string[]>([]);

  const refresh = useCallback(async () => {
    const now = Date.now();
    const today = isoToday();
    const [adminTasks, adminRenewals, adminDecisions, workTasks, groceryShopping, finPending] =
      await Promise.all([
        adminTasksRepo.listOpen(),
        adminRenewalsRepo.listOpen(today),
        adminDecisionsRepo.listOpen(now),
        workTasksRepo.listOpen(today),
        groceryShoppingRepo.listOpen(),
        financePendingRepo.listOpen(now),
      ]);
    const merged = aggregateTodos({
      admin: { tasks: adminTasks, renewals: adminRenewals, decisions: adminDecisions },
      work: { tasks: workTasks },
      grocery: { shopping: groceryShopping },
      finance: { pendingDecisions: finPending },
    });
    setItems(merged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Migrations are idempotent + lazy-singleton; cheap to call in
      // parallel from the screen even if the module box already triggered.
      await Promise.all([migrateAdmin(), migrateFinance(), migrateWork(), migrateGrocery()]);
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => {
      void refresh();
    }, POLL_MS);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const handleComplete = useCallback(
    async (item: TodoItem) => {
      // Start the fade-out frame; the repo write runs in parallel so the
      // user sees the slide-out at the same instant the SQL row is updated.
      setFadingIds((prev) => [...prev, item.id]);
      try {
        await markComplete(item);
      } catch {
        // Roll back the fade if the repo write failed so the user can try
        // again. Don't surface a toast — the brief calls for one focused
        // surface and the next refresh will re-show the row anyway.
        setFadingIds((prev) => prev.filter((id) => id !== item.id));
        return;
      }
      // Hold the fade for the duration, then drop the row from state.
      window.setTimeout(() => {
        setItems((prev) => prev.filter((row) => row.id !== item.id));
        setFadingIds((prev) => prev.filter((id) => id !== item.id));
      }, FADE_OUT_MS);
    },
    [],
  );

  const handleDecide = useCallback(
    async (item: TodoItem, decision: 'cancel' | 'keep' | 'later') => {
      const nowMs = Date.now();
      // Optimistic fade — same pattern as handleComplete.
      setFadingIds((prev) => [...prev, item.id]);
      try {
        await applyDecision(item, decision, nowMs);
      } catch {
        setFadingIds((prev) => prev.filter((id) => id !== item.id));
        return;
      }
      window.setTimeout(() => {
        setItems((prev) => prev.filter((row) => row.id !== item.id));
        setFadingIds((prev) => prev.filter((id) => id !== item.id));
      }, FADE_OUT_MS);
    },
    [],
  );

  const today = useMemo(() => isoToday(), []);
  // "just shit to do today": overdue + due-today + undated loose to-dos.
  // Future-dated commitments (this week / later) are intentionally hidden —
  // they live in their own modules until the day comes. One flat list, no
  // bucket headers: the to-do screen is a today-focus surface, not a backlog.
  const todayList = useMemo<TodoItem[]>(
    () =>
      bucketTodos(items, today)
        .filter((b) => b.id === 'today' || b.id === 'noDate')
        .flatMap((b) => b.items)
        // Product decision (2026-06-23): grocery shopping items live ONLY in
        // the grocery module, not the to-do surface. Buying things stays out
        // of the "today" task list to keep it uncluttered.
        .filter((it) => it.source !== 'grocery'),
    [items, today],
  );

  return (
    <Stack gap={48}>
      <Stack gap={12}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          to-do
        </Text>
        <Text
          scale="title"
          color={colors.ink}
          style={{
            fontFamily: 'var(--ollie-font-sans)',
            fontSize: '26px',
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
          }}
        >
          today
        </Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 540 }}>
          everything due today, in one place.
        </Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : todayList.length === 0 ? (
        <Text scale="body" color={colors.inkFaint} data-testid="todo-empty">
          {items.length === 0
            ? 'nothing on the list yet. brain dump something to fill it.'
            : 'nothing for today. rest easy.'}
        </Text>
      ) : (
        <Stack gap={12} as="ul" style={LIST_RESET} data-testid="bucket-today">
          {todayList.map((item, i) => (
            item.kind === 'decision' ? (
              <DecisionRow
                key={item.id}
                item={item}
                first={i === 0}
                fading={fadingIds.includes(item.id)}
                onDecide={handleDecide}
              />
            ) : (
              <TodoRow
                key={item.id}
                item={item}
                first={i === 0}
                fading={fadingIds.includes(item.id)}
                onComplete={handleComplete}
              />
            )
          ))}
        </Stack>
      )}
    </Stack>
  );
}

// ─── row ──────────────────────────────────────────────────────────────────

interface TodoRowProps {
  readonly item: TodoItem;
  readonly first: boolean;
  readonly fading: boolean;
  readonly onComplete: (item: TodoItem) => void | Promise<void>;
}

function TodoRow({ item, fading, onComplete }: TodoRowProps): JSX.Element {
  const [hover, setHover] = useState(false);
  const handleClick = useCallback(() => {
    void onComplete(item);
  }, [item, onComplete]);
  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        void onComplete(item);
      }
    },
    [item, onComplete],
  );

  return (
    <li
      style={{
        ...LIST_ITEM_RESET,
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_OUT_MS}ms ${easings.calmOut}`,
      }}
      data-testid={`todo-row-${item.id}`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`mark complete: ${item.text}`}
        onClick={handleClick}
        onKeyDown={handleKey}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          cursor: 'pointer',
          padding: '16px 18px',
          outline: 'none',
          background: colors.cream,
          borderRadius: radii.card,
          boxShadow: shadows.raised,
        }}
      >
        <Row gap={16} align="center" justify="space-between">
          <Row gap={14} align="center" style={{ minWidth: 0, flex: 1 }}>
            <span
              aria-hidden="true"
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: colors.cream,
                boxShadow: hover
                  ? `inset 2px 2px 5px rgba(120,140,122,0.5), inset -2px -2px 5px rgba(255,255,255,0.8)`
                  : `inset 3px 3px 6px rgba(120,140,122,0.55), inset -3px -3px 6px rgba(255,255,255,0.85)`,
                display: 'inline-block',
                flexShrink: 0,
                transition: `box-shadow ${durations.tap} ${easings.calmOut}`,
              }}
            />
            <Text
              scale="body"
              style={{
                textDecoration: hover ? 'line-through' : 'none',
                color: hover ? colors.inkFaint : colors.ink,
                transition: `color ${durations.tap} ${easings.calmOut}`,
                wordBreak: 'break-word',
              }}
            >
              {item.text}
            </Text>
          </Row>
          <Row gap={12} align="baseline" style={{ flexShrink: 0 }}>
            <Text
              scale="caption"
              color={colors.inkFaint}
              style={SMCP_STYLE}
            >
              {sourceLabel(item.source)}
            </Text>
            {hover ? (
              <Text
                scale="caption"
                color={colors.sage}
                style={SMCP_STYLE}
                data-testid="todo-done-affordance"
              >
                done
              </Text>
            ) : null}
          </Row>
        </Row>
      </div>
    </li>
  );
}

function sourceLabel(source: TodoSource): string {
  // Lowercase, matches DNA "no shouting" tone.
  if (source === 'admin') return 'admin';
  if (source === 'work') return 'work';
  if (source === 'admin_decision') return 'decide';
  if (source === 'finance_decision') return 'finance';
  return 'grocery';
}

// ─── decision row ─────────────────────────────────────────────────────────
//
// DECISION variant: same hairline bullet + body text as a standard row,
// plus 3 smcp buttons below the text — cancel (sage) / keep (ink) /
// decide later (inkSoft). One click = decision, optimistic slide-out.
// No icons, no confirmation modal, no toast.

interface DecisionRowProps {
  readonly item: TodoItem;
  readonly first: boolean;
  readonly fading: boolean;
  readonly onDecide: (item: TodoItem, decision: 'cancel' | 'keep' | 'later') => void | Promise<void>;
}

const DECISION_BTN_STYLE: CSSProperties = {
  ...SMCP_STYLE,
  fontSize: 11,
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  outline: 'none',
  fontFamily: 'inherit',
};

function DecisionRow({ item, first, fading, onDecide }: DecisionRowProps): JSX.Element {
  const handleCancel = useCallback(() => { void onDecide(item, 'cancel'); }, [item, onDecide]);
  const handleKeep = useCallback(() => { void onDecide(item, 'keep'); }, [item, onDecide]);
  const handleLater = useCallback(() => { void onDecide(item, 'later'); }, [item, onDecide]);

  return (
    <li
      style={{
        ...LIST_ITEM_RESET,
        borderTop: first ? `1px solid ${colors.hairline}` : 'none',
        borderBottom: `1px solid ${colors.hairline}`,
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_OUT_MS}ms ${easings.calmOut}`,
      }}
      data-testid={`todo-row-${item.id}`}
    >
      <div style={{ padding: `${ROW_PAD_Y}px 0` }}>
        <Row gap={16} align="baseline" justify="space-between">
          <Row gap={14} align="baseline" style={{ minWidth: 0, flex: 1 }}>
            <span
              aria-hidden="true"
              style={{
                width: BULLET_SIZE,
                height: BULLET_SIZE,
                background: colors.ink,
                display: 'inline-block',
                marginTop: 8,
                flexShrink: 0,
              }}
            />
            <Text
              scale="body"
              style={{ color: colors.ink, wordBreak: 'break-word' }}
            >
              {item.text}
            </Text>
          </Row>
          <Text
            scale="caption"
            color={colors.inkFaint}
            style={SMCP_STYLE}
          >
            {sourceLabel(item.source)}
          </Text>
        </Row>
        <Row
          gap={16}
          align="baseline"
          style={{ paddingLeft: BULLET_SIZE + 14, paddingTop: 8 }}
          data-testid={`decision-actions-${item.id}`}
        >
          <button
            type="button"
            aria-label={`cancel: ${item.text}`}
            style={{ ...DECISION_BTN_STYLE, color: colors.sage }}
            onClick={handleCancel}
            data-testid={`decision-cancel-${item.id}`}
          >
            cancel
          </button>
          <button
            type="button"
            aria-label={`keep: ${item.text}`}
            style={{ ...DECISION_BTN_STYLE, color: colors.ink }}
            onClick={handleKeep}
            data-testid={`decision-keep-${item.id}`}
          >
            keep
          </button>
          <button
            type="button"
            aria-label={`decide later: ${item.text}`}
            style={{ ...DECISION_BTN_STYLE, color: colors.inkSoft }}
            onClick={handleLater}
            data-testid={`decision-later-${item.id}`}
          >
            decide later
          </button>
        </Row>
      </div>
    </li>
  );
}

// ─── style atoms shared by list nodes ─────────────────────────────────────

const LIST_RESET: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const LIST_ITEM_RESET: CSSProperties = {
  margin: 0,
  padding: 0,
};
