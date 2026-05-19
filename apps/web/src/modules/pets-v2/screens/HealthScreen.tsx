/**
 * pets-v2 · HealthScreen — the welfare panel (pets-health.html)
 *
 * A "when you have a moment" welfare surface — never an alarm, never a
 * verdict, never pushed. Each health flag is a calm hairline block: a sage
 * dot, an uppercase pet line, the observation, a sage days-observed line,
 * the sourced species welfare note, a calm "consider a vet" framing, a
 * barely-there italic citation, and a quiet reviewed / dismiss row. Old
 * pending flags collapse behind a quiet drawer line. NEVER red.
 *
 * Real data: `petsHealthVM` reads the live `pets.health_flags` slice; the
 * reviewed / dismiss actions write back through `usePetsActions`, the SAME
 * keys the live `PetsModule` flips.
 */
import { useMemo } from 'react';
import { Screen, IconInfo, IconChevronRight, v2 } from '../../money-v2/v2';
import { usePetsSlices } from '../usePetsSlices';
import { usePetsActions } from '../usePetsActions';
import { petsHealthVM } from '../selectors';
import type { HealthFlagVM } from '../selectors';

export interface HealthScreenProps {
  now: number;
  onBack: () => void;
}

export function HealthScreen({ now, onBack }: HealthScreenProps) {
  const slices = usePetsSlices();
  const actions = usePetsActions(now);
  const vm = useMemo(() => petsHealthVM(slices, now), [slices, now]);
  const empty = vm.flags.length === 0 && vm.olderCount === 0;

  return (
    <Screen label="health" onBack={onBack} scroll contentStyle={{ paddingTop: 0 }}>
      {/* the framing line — a calm welfare surface */}
      <div style={{ marginTop: 44 }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 300,
            color: v2.ink,
            letterSpacing: '-0.02em',
            lineHeight: 1.3,
          }}
        >
          <b style={{ fontWeight: 500 }}>a couple of things</b> worth a closer
          look
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 14,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.5,
          }}
        >
          none of this is urgent, and none of it is a diagnosis. it&rsquo;s here
          for when you have a moment &mdash; quiet notes from what you recorded,
          not a verdict on your care.
        </div>
      </div>

      {empty ? (
        <div
          style={{
            marginTop: 24,
            fontSize: 14,
            color: v2.mute,
            fontWeight: 400,
            lineHeight: 1.55,
          }}
        >
          nothing noted right now &mdash; ollie will surface a welfare note here
          if a sign shows up across a few days.
        </div>
      ) : (
        <>
          {vm.flags.map((flag, i) => (
            <FlagBlock
              key={flag.id}
              flag={flag}
              first={i === 0}
              onReview={() => actions.reviewFlag(flag.id)}
              onDismiss={() => actions.dismissFlag(flag.id)}
            />
          ))}

          {vm.olderCount > 0 && (
            <div
              style={{
                boxSizing: 'border-box',
                marginTop: 22,
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '14px 2px',
                borderBottom: `1px solid ${v2.line}`,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: v2.line,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, fontSize: 13, color: v2.mute, fontWeight: 500 }}>
                {vm.olderCount} older note{vm.olderCount === 1 ? '' : 's'} from
                before this week
              </span>
              <span style={{ display: 'inline-flex' }} aria-hidden>
                <IconChevronRight stroke={v2.mute} />
              </span>
            </div>
          )}
        </>
      )}

      {/* the closing note — this surface is screen-only */}
      <div style={{ marginTop: 26, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}>
          <IconInfo size={15} weight={1.8} stroke={v2.mute} />
        </span>
        <span style={{ fontSize: 12, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
          ollie is a logbook, not a vet. these welfare notes live here quietly
          &mdash; they are deliberately never sent as a notification. a real
          diagnosis only ever comes from a vet who can see your pet.
        </span>
      </div>
    </Screen>
  );
}

// ─── one health-flag block ───────────────────────────────────────────────────

interface FlagBlockProps {
  flag: HealthFlagVM;
  first: boolean;
  onReview: () => void;
  onDismiss: () => void;
}

function FlagBlock({ flag, first, onReview, onDismiss }: FlagBlockProps) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        marginTop: first ? 24 : 0,
        borderTop: `1px solid ${v2.line}`,
        borderBottom: `1px solid ${v2.line}`,
        padding: '18px 0',
        // collapse the shared hairline between stacked blocks
        marginBottom: -1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: v2.sage,
            flexShrink: 0,
            marginTop: 6,
          }}
        />
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 11,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            {flag.petName}
            {flag.speciesDisplay ? ` · ${flag.speciesDisplay}` : ''}
          </div>
          <div
            style={{
              fontSize: 15,
              color: v2.ink,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              lineHeight: 1.4,
            }}
          >
            {flag.line}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: v2.sage,
              fontWeight: 600,
              letterSpacing: '-0.005em',
            }}
          >
            {flag.daysLine}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              color: v2.mute,
              fontWeight: 400,
              lineHeight: 1.5,
            }}
          >
            {flag.note}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 13,
              color: v2.ink,
              fontWeight: 500,
              letterSpacing: '-0.005em',
              lineHeight: 1.5,
            }}
          >
            {flag.vetLine}
          </div>
          <div
            style={{
              marginTop: 7,
              fontSize: 11,
              color: v2.mute,
              fontWeight: 500,
              fontStyle: 'italic',
              letterSpacing: '0.01em',
              opacity: 0.85,
            }}
          >
            {flag.cite}
          </div>
          {/* a calm reviewed / dismiss row — quiet text, real buttons */}
          <div style={{ marginTop: 11, display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onReview}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: 12,
                color: v2.sage,
                fontWeight: 600,
                letterSpacing: '0.01em',
                cursor: 'pointer',
                padding: '11px 12px 11px 0',
                minHeight: 44,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              mark reviewed
            </button>
            <button
              type="button"
              onClick={onDismiss}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: 12,
                color: v2.mute,
                fontWeight: 600,
                letterSpacing: '0.01em',
                cursor: 'pointer',
                padding: '11px 12px',
                minHeight: 44,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
