/**
 * GoalCreateModal · the rich create-a-goal overlay (goals brief, 2026-05-29).
 *
 * A goal isn't a to-do — it's a thing you're trying to become true. So the
 * create flow asks for more than a name: the *why* (what gets better), the
 * obstacle you can already see, a premortem (imagine it failed — what
 * killed it?), and a ulysses contract (a note from current-you to future-you,
 * shown only if you ever try to delete the goal).
 *
 * Required: what · why · the obstacle · premortem · ulysses contract.
 * Optional: target date — labelled "no punishment for missing", because the
 * point is the direction, not the deadline.
 *
 * Save is disabled until every required field has non-empty text. On save we
 * call `goals.create(draft)`; a `GoalCapError` (five active goals already) is
 * caught and shown as a gentle inline refusal, never a hard error.
 *
 * Editorial idiom, matched to the box: cream/paper surfaces, serif display
 * header, lowercase SMCP kickers, sage accent, generous breathing room. The
 * overlay is dismissable by backdrop click, a quiet "cancel", and Esc.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Stack, Row } from '../../layout';
import { Text, Input, Textarea, Button } from '../../ui';
import { colors, fonts, fontWeights, zIndex } from '../../theme/tokens';
import { goals as goalsRepo, GoalCapError } from './repo';
import type { GoalDraft } from './types';

const SMCP_STYLE: CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

export interface GoalCreateModalProps {
  /** Dismiss without creating (cancel / backdrop / Esc). */
  onClose: () => void;
  /** Called after a successful create so the parent can refresh its list. */
  onCreated: () => void;
}

/** Parse a `<input type="date">` value (yyyy-mm-dd) to ms-epoch, or null. */
function dateToMs(value: string): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value}T00:00:00`);
  return Number.isNaN(ms) ? null : ms;
}

export function GoalCreateModal({
  onClose,
  onCreated,
}: GoalCreateModalProps): JSX.Element {
  const [what, setWhat] = useState('');
  const [why, setWhy] = useState('');
  const [targetDate, setTargetDate] = useState(''); // yyyy-mm-dd or ''
  const [obstacle, setObstacle] = useState('');
  const [premortem, setPremortem] = useState('');
  const [ulysses, setUlysses] = useState('');

  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  // every required field must hold non-empty text; target date may be blank.
  const canSave =
    what.trim() !== '' &&
    why.trim() !== '' &&
    obstacle.trim() !== '' &&
    premortem.trim() !== '' &&
    ulysses.trim() !== '';

  // Esc closes the overlay (unless mid-save).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  // Move focus into the card on mount so keyboard users land inside it.
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const handleSave = useCallback(async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setRefusal(null);
    const draft: GoalDraft = {
      name: what.trim(),
      why: why.trim(),
      targetDate: dateToMs(targetDate),
      obstacle: obstacle.trim(),
      premortem: premortem.trim(),
      ulyssesContract: ulysses.trim(),
    };
    try {
      await goalsRepo.create(draft);
      onCreated();
      onClose();
    } catch (err) {
      if (err instanceof GoalCapError || (err as { code?: string })?.code === 'goal_cap') {
        setRefusal(
          'five active goals is the ceiling. finish or release one before adding another.',
        );
      } else {
        setRefusal('something went sideways saving this. your words are still here — try again.');
      }
      setSaving(false);
    }
  }, [canSave, saving, what, why, targetDate, obstacle, premortem, ulysses, onCreated, onClose]);

  return (
    <div
      // backdrop — clicking it dismisses (but not mid-save)
      onClick={() => {
        if (!saving) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: zIndex.modal,
        background: `rgba(20, 20, 15, 0.32)`,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflowY: 'auto',
        padding: '48px 20px',
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        // stop clicks inside the card from bubbling to the backdrop
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 460,
          background: colors.cream,
          border: `1px solid ${colors.hairline}`,
          borderRadius: 14,
          boxShadow: '0 12px 40px rgba(20, 25, 20, 0.10)',
          padding: '32px 28px',
          outline: 'none',
        }}
      >
        <Stack gap={28}>
          {/* header */}
          <Stack gap={8}>
            <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
              new goal
            </Text>
            <div
              id={titleId}
              style={{
                fontFamily: fonts.serif,
                fontSize: 28,
                fontWeight: fontWeights.regular,
                color: colors.ink,
                letterSpacing: '-0.022em',
                lineHeight: 1.15,
              }}
            >
              something you&rsquo;re trying to make true
            </div>
          </Stack>

          {/* the fields */}
          <Stack gap={24}>
            <Field
              label="what"
              hint="the goal, in your words"
            >
              <Input
                label="what"
                labelHidden
                value={what}
                onChange={setWhat}
                placeholder="move to the netherlands"
              />
            </Field>

            <Field
              label="why"
              hint="what gets better when this is done"
            >
              <Textarea
                label="why"
                labelHidden
                value={why}
                onChange={setWhy}
                minRows={2}
                placeholder="more room to breathe, closer to the people i love"
              />
            </Field>

            <Field
              label="target date"
              hint="optional · no punishment for missing"
            >
              <Input
                label="target date"
                labelHidden
                // Input's `type` union doesn't list "date", but it forwards the
                // prop straight to the DOM input — so the native date picker
                // renders. Cast to satisfy the narrowed union.
                type={'date' as 'text'}
                value={targetDate}
                onChange={setTargetDate}
              />
            </Field>

            <Field
              label="the obstacle"
              hint="what&rsquo;s most likely to stop you"
            >
              <Textarea
                label="the obstacle"
                labelHidden
                value={obstacle}
                onChange={setObstacle}
                minRows={2}
                placeholder="the paperwork, and losing steam halfway"
              />
            </Field>

            <Field
              label="premortem"
              hint="imagine this fails in 3 months. what killed it?"
            >
              <Textarea
                label="premortem"
                labelHidden
                value={premortem}
                onChange={setPremortem}
                minRows={2}
                placeholder="i never blocked time for it, so it stayed a someday"
              />
            </Field>

            <Field
              label="ulysses contract"
              hint="a note to future-you — shown if you ever try to delete this goal"
            >
              <Textarea
                label="ulysses contract"
                labelHidden
                value={ulysses}
                onChange={setUlysses}
                minRows={2}
                placeholder="future me — you wanted this badly in may. don't let a hard week decide."
              />
            </Field>
          </Stack>

          {/* gentle inline refusal (cap reached / save error) */}
          {refusal ? (
            <div
              role="status"
              aria-live="polite"
              style={{
                padding: '14px 18px',
                borderRadius: 10,
                background: colors.paper,
                border: `1px solid ${colors.hairline}`,
                fontFamily: fonts.serif,
                fontStyle: 'italic',
                fontSize: 15,
                lineHeight: 1.5,
                color: colors.sageDeep,
              }}
            >
              {refusal}
            </div>
          ) : null}

          {/* actions */}
          <Row gap={16} justify="flex-end" align="center">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={saving}
              aria-label="cancel and close"
            >
              cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleSave()}
              disabled={!canSave}
              loading={saving}
              aria-label="save this goal"
            >
              keep this goal
            </Button>
          </Row>
        </Stack>
      </div>
    </div>
  );
}

// ─── a labelled field — SMCP kicker + a quiet hint, then the control ────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text scale="caption" color={colors.inkSoft} style={SMCP_STYLE}>
          {label}
        </Text>
        <span
          style={{
            fontFamily: fonts.serif,
            fontStyle: 'italic',
            fontSize: 13,
            color: colors.inkFaint,
            letterSpacing: '-0.005em',
            lineHeight: 1.4,
          }}
        >
          {hint}
        </span>
      </Stack>
      {children}
    </Stack>
  );
}
