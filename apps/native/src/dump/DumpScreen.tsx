/**
 * DumpScreen · home screen / brain-dump landing.
 *
 * The dump UX is fire-and-forget: user dumps, Ollie acknowledges with a
 * brief "okay!" and the module handlers update silently in the background.
 * No journal feed, no list of past dumps, no AI commentary surface — see
 * memory `feedback-ollie-dump-ux-silent`. The actual state changes show up
 * inside the affected modules when the user navigates to them.
 *
 * Crisis is the one exception: when the router flags crisis, the dispatch
 * is short-circuited (no module updates) and a quiet banner surfaces.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Stack } from '../layout';
import { Text } from '../ui';
import { colors } from '../theme/tokens';
import { BrainDumpInput } from './BrainDumpInput';
import { dumpArchive } from './archive';
import { tagDumpMood } from './mood-lexicon';
import { dispatchRouterOutput, applyFragment } from '../modules';
import type { DispatchEntry } from '../modules';
import type { CrisisSignal, RouterOutput } from '../router/schema';
import { useAppLang } from '../settings/appLang';
import { useFeature } from '../settings/features';
import { crisisBannerCopy } from './crisisCopy';
import { NeedsConfirmCard } from './NeedsConfirmCard';
import { TodayNoticings } from '../modules/brain/TodayNoticings';
import { GoalCreateModal } from '../modules/goals/GoalCreateModal';
import { PartnerCard } from '../modules/partner';
import styles from './DumpScreen.module.css';

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

// Matches the total duration of the `ollie-ack` keyframe in DumpScreen.module.css.
// Bumped a hair so the cleanup unmount lands just after the fade-out finishes
// and the user never sees a hard cut.
const ACK_FADE_MS = 2500;

/** One pending confirmation card — keyed by fragment index in the last dispatch. */
interface PendingConfirm {
  /** Stable id: dumpId + fragment index in that dispatch. */
  id: string;
  fragmentPreview: string;
  routeLabel: string;
  /** Called when user clicks keep — applies a draft fragment (#9), else a no-op. */
  onKeep: () => void;
  /** Called when user clicks undo — drop a draft, or remove a written row. */
  onUndo: () => void;
  /** True when the source RouterOutput had visionUsed === true. */
  fromPhoto: boolean;
}

function buildRouteLabel(entry: DispatchEntry): string {
  const { module, payload } = entry.fragment;
  // Every ActionPayload variant carries an `action` string discriminant.
  // We narrow via `in` first; the index access is safe because the union
  // guarantees `action` is always a string when the key exists.
  const action =
    'action' in payload && typeof payload.action === 'string' ? payload.action : '';
  return action ? `${module} · ${action}` : module;
}

export function DumpScreen(): JSX.Element {
  const { getToken } = useAuth();
  const [ackKey, setAckKey] = useState<number | null>(null);
  // Monotonic tick that forces the <Ack> to remount so its CSS animation
  // restarts on every dump (audit #127). Component-local useRef, NOT a
  // module-scope `let`: the old global was shared across every DumpScreen
  // instance and never reset, so it leaked across HMR reloads + would collide
  // if two screens ever mounted.
  const ackTickRef = useRef(0);
  const [crisis, setCrisis] = useState<CrisisSignal | null>(null);
  const [pendingConfirms, setPendingConfirms] = useState<PendingConfirm[]>([]);
  // Partner is deferred out of v1 (audit #10) — its home ambient card only
  // shows when the feature flag is on.
  const partnerEnabled = useFeature('partner');
  // Rich goal capture from the home screen: when a dump is classified as a
  // new goal, the modal opens PRE-FILLED with what/why the AI extracted so
  // the user just completes obstacle/premortem/ulysses. Null = closed.
  const [goalDraft, setGoalDraft] = useState<{ what: string; why: string } | null>(null);

  // Auto-clear the ack so the DOM cleans up after the fade-out and the
  // screen returns to its quiet default state.
  useEffect(() => {
    if (ackKey === null) return;
    const t = setTimeout(() => setAckKey(null), ACK_FADE_MS);
    return () => clearTimeout(t);
  }, [ackKey]);

  // Fetch a Clerk session JWT for every dump request. The worker verifies
  // via JWKS at CLERK_ISSUER. Token has a short TTL (default ~60s) and
  // Clerk refreshes transparently — calling getToken() each time is the
  // documented happy path.
  const getBearer = useCallback(async () => {
    const t = await getToken();
    return t ?? '';
  }, [getToken]);

  const dismissConfirm = useCallback((id: string) => {
    setPendingConfirms((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Force-remount the Ack so its CSS animation restarts on every fire.
  const fireAck = useCallback(() => {
    ackTickRef.current += 1;
    setAckKey(ackTickRef.current);
  }, []);

  // Instant ack: fired SYNCHRONOUSLY by BrainDumpInput the moment a non-empty
  // dump is submitted, before the cloud route. Perceived latency ~0. We retract
  // it post-route in onResult/onCrisis for the two cases that can't ack yet
  // (goal-intent waits for the modal save; crisis must never ack).
  const onSubmitted = useCallback(() => {
    fireAck();
  }, [fireAck]);

  const onResult = useCallback(async (output: RouterOutput) => {
    // Goal intent → rich capture. When the AI classifies a fragment as a new
    // goal ("i want to go to greece this year"), DON'T silently file a bare
    // goal — open the create modal pre-filled with the what/why it extracted
    // so the user completes obstacle/premortem/ulysses. We strip those
    // fragments from the silent dispatch to avoid creating a duplicate row.
    const goalFragment = output.fragments.find((f) => {
      const pl = f.payload as { action?: string };
      return f.module === 'goals' && pl.action === 'create_goal';
    });
    if (goalFragment) {
      const pl = goalFragment.payload as { what?: string; why?: string };
      setGoalDraft({ what: pl.what ?? goalFragment.text, why: pl.why ?? '' });
      // Retract the optimistic instant ack: a goal-intent dump files NOTHING
      // until the user completes + saves the modal, so the "okay!" must fire
      // from onCreated instead. Goal intent is only knowable here (post-route),
      // so the ack already flashed on submit — pull it back now.
      setAckKey(null);
    }
    const dispatchOutput: RouterOutput = goalFragment
      ? {
          ...output,
          fragments: output.fragments.filter(
            (f) => !(f.module === 'goals' && (f.payload as { action?: string }).action === 'create_goal'),
          ),
        }
      : output;

    // Persist the raw dump BEFORE dispatch so the journal resurfacer + every
    // cross-module consumer (admin/finance/goals/sleep read dump.items) finally
    // see it (audit §MISSING: native discarded dump text). We archive only
    // non-crisis dumps — a crisis fragment short-circuits dispatch and must not
    // be re-surfaced later. Best-effort: archive.record swallows its own errors.
    //
    // AWAIT, not fire-and-forget (audit #86): dispatchRouterOutput's post-write
    // sweep calls the dump bridge's syncToStore, which reads dumpArchive.list()
    // to mirror dump.items / journal.entries. If the archive write is still
    // floating when that read runs, THIS dump is missing from the mirror for a
    // whole cycle (the resurfacer + finance doom-buying + goals detectors don't
    // see it until the NEXT dump triggers another sweep). Awaiting first
    // guarantees the row is on disk before the sweep reads it. record() never
    // throws, so this can't break the dump flow.
    if (!output.crisis) {
      await dumpArchive.record({
        id: output.dumpId,
        text: output.originalDump,
        modules: Array.from(new Set(output.fragments.map((f) => f.module))),
        mood: tagDumpMood(output.originalDump),
        ts: output.timestamp,
      });
    }

    // Dispatch is silent: the result entries update module-local state but
    // we do not render them. The user goes to the module to see the change.
    const dispatched = await dispatchRouterOutput(dispatchOutput);
    if (dispatched.crisisSkipped) return;

    // Surface a confirm card for each uncertain fragment. Both the fragment-
    // level flag (set by the router before dispatch) and the handler result
    // flag are checked — whichever layer sets needsConfirm wins.
    const fromPhoto = output.visionUsed === true;
    const cards: PendingConfirm[] = dispatched.entries
      .filter(
        (e) => e.fragment.needsConfirm === true || e.result.needsConfirm === true,
      )
      .map((e, i) => {
        const id = `${output.dumpId}-${i}`;
        const realUndo = e.result.undo;
        // Draft-first (audit #9): a grey-zone fragment was NOT written. "keep"
        // applies it now; "undo" just drops it (nothing to remove). Legacy
        // write-then-undo entries (handler already wrote + set needsConfirm)
        // keep their behaviour: "keep" is a no-op, "undo" removes the row.
        const isDraft = e.result.draft === true;
        return {
          id,
          fragmentPreview: e.fragment.text.slice(0, 60),
          routeLabel: buildRouteLabel(e),
          fromPhoto,
          onKeep: async () => {
            // Dismiss FIRST, synchronously (audit #53): removing the card from
            // pendingConfirms unmounts its keep/undo buttons in this same React
            // commit, so a fast double-tap can't fire applyFragment twice (which
            // would write the grey-zone fragment to the module repo twice). The
            // write then runs after the card is already gone.
            dismissConfirm(id);
            if (isDraft) {
              try {
                await applyFragment(e.fragment);
              } catch (err) {
                console.error('[dump] draft apply failed', err);
              }
            }
          },
          onUndo: async () => {
            // Dismiss FIRST (audit #53): same double-tap guard as onKeep — undo
            // dismisses synchronously so the row-removal can't run twice.
            dismissConfirm(id);
            // draft → nothing was written; just drop it. legacy → remove row.
            if (!isDraft && realUndo) {
              try {
                await realUndo();
              } catch (err) {
                console.error('[dump] undo failed', err);
              }
            }
          },
        };
      });

    if (cards.length > 0) {
      setPendingConfirms((prev) => [...prev, ...cards]);
    }

    // No ack fired here anymore — it already flashed instantly on submit (see
    // onSubmitted). Goal-intent dumps retract it above (modal owns the ack);
    // crisis dumps are hidden by the `!crisis` render guard once onCrisis sets
    // crisis state. Confirm cards (above) are additive and don't touch the ack.
  }, [dismissConfirm]);

  const onCrisis = useCallback((signal: CrisisSignal) => {
    // Crisis is only knowable post-route, so the optimistic ack already
    // flashed on submit. The `!crisis` render guard hides it reactively, but
    // we also clear it so it can't reappear if crisis is later dismissed.
    setAckKey(null);
    setCrisis(signal);
  }, []);

  return (
    <Stack gap={32}>
      <Stack gap={6}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
            <path
              d="M21 4c-10 0-16 5-16 12 0 1.4.3 2.7.8 3.8C13 19 20 13 21 4z"
              fill={colors.sageDeep}
            />
          </svg>
          <span style={{ fontWeight: 600, letterSpacing: '0.5px', color: colors.sageDeep, fontSize: 16 }}>
            ollie
          </span>
        </div>
        <Text scale="caption" color={colors.inkSoft} style={SMCP_STYLE}>
          good evening
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
          what's on your mind?
        </Text>
      </Stack>

      <BrainDumpInput
        getBearer={getBearer}
        onSubmitted={onSubmitted}
        onResult={onResult}
        onCrisis={onCrisis}
      />

      {/* The cross-life "today" surface — the PRIMARY brain surface (Sprint 2).
          Replaces the old per-module dump card here: the selection discipline
          gathers noticings across her whole life, scores them, and shows only
          the top 2–3 with a calm "not now" (postpone) + dismiss. Renders
          nothing when nothing clears the bar, so the dump UX stays silent by
          default. (Per-module PatternCards remain inside each Box as-is.) */}
      <TodayNoticings />

      {/* Level-2 ambient partner line — only when paired (decision 4) AND the
          v1 Partner feature flag is enabled (audit #10). */}
      {partnerEnabled && <PartnerCard />}

      {goalDraft && (
        <GoalCreateModal
          initialWhat={goalDraft.what}
          initialWhy={goalDraft.why}
          onClose={() => setGoalDraft(null)}
          onCreated={() => {
            setGoalDraft(null);
            // Now the goal is actually filed — ack for real.
            fireAck();
          }}
        />
      )}

      {crisis && <CrisisBanner onDismiss={() => setCrisis(null)} />}

      {!crisis && ackKey !== null && <Ack key={ackKey} />}

      {!crisis && pendingConfirms.length > 0 && (
        <Stack gap={10}>
          {pendingConfirms.map((card) => (
            <NeedsConfirmCard
              key={card.id}
              fragmentPreview={card.fragmentPreview}
              routeLabel={card.routeLabel}
              fromPhoto={card.fromPhoto}
              onKeep={card.onKeep}
              onUndo={card.onUndo}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

// ─── ack ──────────────────────────────────────────────────────────────────
// Full-viewport sage takeover with a giant serif "Okay!". Fades in, holds,
// fades back over ~2.4s. Pointer-events off so the user can keep typing
// straight through the flash — the dump UI behind it is still alive.

function Ack(): JSX.Element {
  return (
    <div className={styles.ack} role="status" aria-live="polite">
      <span className={styles.ackText}>Okay!</span>
    </div>
  );
}

// ─── crisis ───────────────────────────────────────────────────────────────

function CrisisBanner({ onDismiss }: { onDismiss: () => void }): JSX.Element {
  const lang = useAppLang();
  const copy = crisisBannerCopy(lang);
  const body = copy.body;
  return (
    <Stack
      gap={8}
      style={{
        padding: '16px 20px',
        borderRadius: 12,
        background: 'rgba(196, 64, 64, 0.06)',
        border: '1px solid rgba(196, 64, 64, 0.2)',
      }}
    >
      <Text scale="caption" color="rgb(140, 30, 30)" style={SMCP_STYLE}>
        {copy.kicker}
      </Text>
      <Text scale="body" color="rgb(80, 20, 20)">
        {body}
      </Text>
      <Text
        scale="caption"
        color={colors.inkFaint}
        as="button"
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {copy.dismiss}
      </Text>
    </Stack>
  );
}
