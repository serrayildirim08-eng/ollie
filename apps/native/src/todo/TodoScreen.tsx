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
import { colors, durations, easings } from '../theme/tokens';
import {
  migrateAdmin,
  renewals as adminRenewalsRepo,
  tasks as adminTasksRepo,
} from '../modules/admin';
import {
  migrateGrocery,
  shopping as groceryShoppingRepo,
} from '../modules/grocery';
import { migrateWork, tasks as workTasksRepo } from '../modules/work';
import {
  aggregateTodos,
  bucketTodos,
  isoToday,
  type TodoBucket,
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

async function markComplete(item: TodoItem): Promise<void> {
  if (item.source === 'admin') {
    if (item.action === 'log_renewal') {
      await adminRenewalsRepo.markComplete(item.rowId);
      return;
    }
    await adminTasksRepo.markComplete(item.rowId);
    return;
  }
  if (item.source === 'work') {
    await workTasksRepo.markComplete(item.rowId);
    return;
  }
  // source === 'grocery'
  await groceryShoppingRepo.markPurchased(item.rowId);
}

// ─── screen ───────────────────────────────────────────────────────────────

export function TodoScreen(): JSX.Element {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [ready, setReady] = useState(false);
  // Optimistic fade-out set — items mid-removal stay rendered with reduced
  // opacity for FADE_OUT_MS then drop entirely.
  const [fadingIds, setFadingIds] = useState<readonly string[]>([]);

  const refresh = useCallback(async () => {
    const today = isoToday();
    const [adminTasks, adminRenewals, workTasks, groceryShopping] =
      await Promise.all([
        adminTasksRepo.listOpen(),
        adminRenewalsRepo.listOpen(today),
        workTasksRepo.listOpen(today),
        groceryShoppingRepo.listOpen(),
      ]);
    const merged = aggregateTodos({
      admin: { tasks: adminTasks, renewals: adminRenewals },
      work: { tasks: workTasks },
      grocery: { shopping: groceryShopping },
    });
    setItems(merged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Migrations are idempotent + lazy-singleton; cheap to call in
      // parallel from the screen even if the module box already triggered.
      await Promise.all([migrateAdmin(), migrateWork(), migrateGrocery()]);
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

  const today = useMemo(() => isoToday(), []);
  const buckets = useMemo<TodoBucket[]>(
    () => bucketTodos(items, today),
    [items, today],
  );

  return (
    <Stack gap={48}>
      <Stack gap={12}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          to-do
        </Text>
        <Text scale="display">To-Do</Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 540 }}>
          everything you've dumped, ready to do.
        </Text>
      </Stack>

      {!ready ? (
        <Text scale="caption" color={colors.inkFaint}>
          loading…
        </Text>
      ) : items.length === 0 ? (
        <Text scale="body" color={colors.inkFaint} data-testid="todo-empty">
          nothing on the list yet. brain dump something to fill it.
        </Text>
      ) : (
        <Stack gap={40} as="ul" style={LIST_RESET}>
          {buckets.map((bucket) => (
            <BucketSection
              key={bucket.id}
              bucket={bucket}
              fadingIds={fadingIds}
              onComplete={handleComplete}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

// ─── bucket section ───────────────────────────────────────────────────────

interface BucketSectionProps {
  readonly bucket: TodoBucket;
  readonly fadingIds: readonly string[];
  readonly onComplete: (item: TodoItem) => void | Promise<void>;
}

function BucketSection({
  bucket,
  fadingIds,
  onComplete,
}: BucketSectionProps): JSX.Element {
  return (
    <li style={LIST_ITEM_RESET}>
      <Stack gap={12}>
        <Text
          scale="caption"
          color={colors.inkFaint}
          style={{ ...SMCP_STYLE, letterSpacing: '0.20em' }}
        >
          {bucket.label}
        </Text>
        <Stack gap={0} as="ul" style={LIST_RESET} data-testid={`bucket-${bucket.id}`}>
          {bucket.items.map((item, i) => (
            <TodoRow
              key={item.id}
              item={item}
              first={i === 0}
              fading={fadingIds.includes(item.id)}
              onComplete={onComplete}
            />
          ))}
        </Stack>
      </Stack>
    </li>
  );
}

// ─── row ──────────────────────────────────────────────────────────────────

interface TodoRowProps {
  readonly item: TodoItem;
  readonly first: boolean;
  readonly fading: boolean;
  readonly onComplete: (item: TodoItem) => void | Promise<void>;
}

function TodoRow({ item, first, fading, onComplete }: TodoRowProps): JSX.Element {
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
        borderTop: first ? `1px solid ${colors.hairline}` : 'none',
        borderBottom: `1px solid ${colors.hairline}`,
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
          padding: `${ROW_PAD_Y}px 0`,
          outline: 'none',
        }}
      >
        <Row gap={16} align="baseline" justify="space-between">
          <Row gap={14} align="baseline" style={{ minWidth: 0, flex: 1 }}>
            <span
              aria-hidden="true"
              style={{
                width: BULLET_SIZE,
                height: BULLET_SIZE,
                background: hover ? colors.sage : colors.ink,
                display: 'inline-block',
                marginTop: 8,
                flexShrink: 0,
                transition: `background ${durations.tap} ${easings.calmOut}`,
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
  return 'grocery';
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
