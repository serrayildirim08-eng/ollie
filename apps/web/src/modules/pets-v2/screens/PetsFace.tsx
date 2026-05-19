/**
 * pets-v2 · PetsFace — the pets submodule face (Level 2)
 *
 * Mirrors pets.html (a care task is due → the next/overdue care thing is
 * the calm hero, the roster of pets each with a tailored 30-day care strip
 * below, the observe / health / patterns drill rows) and pets-cold.html
 * (no pets → the same FACE, never blank: an empty paw-disc, an honest
 * "the notebook's empty" invitation, a worked example of the 10 species).
 * One face, two states — picked by `petsFaceVM().hasPets`.
 *
 * Real data: every line comes from `selectors.ts` over the live `pets.*`
 * slices via `usePetsSlices`. The roster rows drill to a pet profile; the
 * drill rows route to the leaf screens.
 */
import { useMemo } from 'react';
import {
  Screen,
  NavRow,
  AmberButton,
  IconPlus,
  IconPaw,
  IconChevronRight,
  v2,
} from '../../money-v2/v2';
import { usePetsSlices } from '../usePetsSlices';
import { usePetsActions } from '../usePetsActions';
import { petsFaceVM, weeklyPreface, speciesLabel } from '../selectors';
import { CareStrip } from '../components/CareStrip';
import type { PetsRoute } from '../PetsApp';
import type { RosterEntryVM } from '../selectors';

export interface PetsFaceProps {
  now: number;
  navigate: (to: PetsRoute) => void;
  onOpenProfile: (id: string) => void;
  /** open log-care, optionally pre-targeted at the hero's pet + task */
  onLogCare: (petId?: string, task?: string) => void;
  onSafe: () => void;
}

const DISC_FILL = '#F2EEDF';
const UMBER = '#A8703C';

export function PetsFace({
  now,
  navigate,
  onOpenProfile,
  onLogCare,
  onSafe,
}: PetsFaceProps) {
  const slices = usePetsSlices();
  const actions = usePetsActions(now);
  const face = useMemo(() => petsFaceVM(slices, now), [slices, now]);
  const preface = useMemo(() => weeklyPreface(now), [now]);

  return (
    <Screen label="pets" onSafe={onSafe} scroll contentStyle={{ paddingTop: 0 }}>
      {/* the editorial preface — one quiet italic line */}
      <p
        style={{
          marginTop: 26,
          fontSize: 13,
          fontStyle: 'italic',
          color: v2.mute,
          fontWeight: 400,
          lineHeight: 1.5,
          letterSpacing: '0.01em',
        }}
      >
        {preface}
      </p>

      <div
        style={{
          marginTop: 14,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {face.hasPets ? (
          face.hero ? (
            <CareHero
              petInitial={face.hero.petInitial}
              title={`${face.hero.petName} · ${face.hero.taskDisplay}`}
              sinceLine={face.hero.sinceLine}
              speciesFact={face.hero.speciesFact}
              reframe={face.hero.reframe}
              onLog={() => onLogCare(face.hero!.petId, face.hero!.task)}
            />
          ) : (
            <AllCurrentHero onLog={() => onLogCare()} />
          )
        ) : (
          <ColdHero onAdd={() => navigate('add')} />
        )}
      </div>

      {/* the away banner — care reminders paused */}
      {face.away && (
        <div
          style={{
            boxSizing: 'border-box',
            marginTop: 24,
            background: '#F2EEDF',
            border: `1px solid ${v2.line}`,
            borderLeft: `3px solid ${v2.ink}`,
            borderRadius: 12,
            padding: '12px 15px',
            fontSize: 13,
            color: v2.ink,
            fontWeight: 500,
            lineHeight: 1.5,
            letterSpacing: '-0.005em',
          }}
        >
          away until {face.awayUntil || 'soon'} — care reminders are paused.
        </div>
      )}

      {face.hasPets ? (
        <>
          {/* the roster — each pet, a tailored 30-day care strip */}
          <div
            style={{
              marginTop: 42,
              fontSize: 11,
              color: v2.mute,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            in the notebook
          </div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column' }}>
            {face.roster.map((pet, i) => (
              <RosterRow
                key={pet.petId}
                pet={pet}
                last={i === face.roster.length - 1}
                onOpen={() => onOpenProfile(pet.petId)}
              />
            ))}
          </div>

          {/* the calm drill rows — observe, health, see-the-rest */}
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column' }}>
            <NavRow
              first
              rowKey="observe"
              value="weight, what you noticed today"
              onOpen={() => navigate('observe')}
            />
            <NavRow
              rowKey="health"
              value={face.healthLine}
              dim={face.healthPendingCount === 0}
              last={!face.hasPatterns}
              onOpen={() => navigate('health')}
            />
            {face.hasPatterns && (
              <NavRow
                flag
                last
                rowKey="see the rest"
                value="a few things ollie noticed about the care"
                onOpen={() => navigate('patterns')}
              />
            )}
          </div>

          {/* a quiet add-a-pet affordance + away toggle */}
          <div
            style={{
              marginTop: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 18,
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => navigate('add')}
              style={faceLinkStyle}
            >
              add a pet
            </button>
            <span aria-hidden style={{ color: v2.line, fontSize: 12 }}>
              ·
            </span>
            <button
              type="button"
              onClick={actions.toggleAway}
              style={faceLinkStyle}
            >
              {face.away ? 'end away mode' : 'away mode'}
            </button>
          </div>
        </>
      ) : (
        <ColdExample />
      )}

      {/* a quiet way to preview the notification voice */}
      <button
        type="button"
        onClick={() => navigate('notifications')}
        style={{ ...faceLinkStyle, marginTop: 24, alignSelf: 'center' }}
      >
        what pets sends &mdash; and what it never does
      </button>
    </Screen>
  );
}

const faceLinkStyle = {
  background: 'transparent',
  border: 'none',
  fontSize: 12,
  color: v2.mute,
  fontWeight: 500,
  letterSpacing: '0.02em',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
  padding: '6px 2px',
} as const;

// ─── the care hero (pets.html) ───────────────────────────────────────────────

interface CareHeroProps {
  petInitial: string;
  title: string;
  sinceLine: string;
  speciesFact: string;
  reframe: string;
  onLog: () => void;
}

function CareHero({
  petInitial,
  title,
  sinceLine,
  speciesFact,
  reframe,
  onLog,
}: CareHeroProps) {
  return (
    <>
      {/* the pet disc — a soft initial token */}
      <div
        aria-hidden
        style={{
          width: 62,
          height: 62,
          borderRadius: '50%',
          background: DISC_FILL,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <span
          style={{
            fontSize: 25,
            fontWeight: 700,
            color: v2.ink,
            letterSpacing: '-0.02em',
          }}
        >
          {petInitial}
        </span>
      </div>

      <div
        style={{
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        next for the pets
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 38,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.03em',
          lineHeight: 1.1,
          textAlign: 'center',
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 13,
          fontSize: 14,
          color: v2.ink,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          textAlign: 'center',
        }}
      >
        <b style={{ fontWeight: 600 }}>{sinceLine}</b>
        <span style={{ color: v2.line, margin: '0 7px' }}>·</span>
        {speciesFact}
      </div>
      <div
        style={{
          marginTop: 9,
          fontSize: 13,
          color: v2.mute,
          fontWeight: 400,
          letterSpacing: '-0.005em',
          textAlign: 'center',
          maxWidth: 270,
          lineHeight: 1.45,
        }}
      >
        {reframe}
      </div>

      <AmberButton
        icon={<IconPlus size={18} weight={2.4} />}
        onClick={onLog}
        style={{ marginTop: 24, height: 50, borderRadius: 25 }}
      >
        log care
      </AmberButton>
    </>
  );
}

// ─── the all-current hero (pets, nothing due) ────────────────────────────────

function AllCurrentHero({ onLog }: { onLog: () => void }) {
  return (
    <>
      <div
        aria-hidden
        style={{
          width: 62,
          height: 62,
          borderRadius: '50%',
          background: DISC_FILL,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <IconPaw size={28} stroke={v2.sage} weight={1.6} />
      </div>
      <div
        style={{
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        nothing due
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 32,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.025em',
          lineHeight: 1.15,
          textAlign: 'center',
          maxWidth: 280,
        }}
      >
        the care is all current
      </div>
      <div
        style={{
          marginTop: 9,
          fontSize: 13,
          color: v2.mute,
          fontWeight: 400,
          textAlign: 'center',
          maxWidth: 270,
          lineHeight: 1.45,
        }}
      >
        nothing to chase right now — log anything you do anyway, it keeps the
        strip honest.
      </div>
      <AmberButton
        icon={<IconPlus size={18} weight={2.4} />}
        onClick={onLog}
        style={{ marginTop: 24, height: 50, borderRadius: 25 }}
      >
        log care
      </AmberButton>
    </>
  );
}

// ─── the cold hero (pets-cold.html) ──────────────────────────────────────────

function ColdHero({ onAdd }: { onAdd: () => void }) {
  return (
    <>
      {/* the empty paw-disc — a bare ink-outline ring, a paw waiting */}
      <div
        aria-hidden
        style={{
          width: 78,
          height: 78,
          borderRadius: '50%',
          border: `1.5px solid ${v2.line}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 22,
        }}
      >
        <IconPaw size={34} stroke={v2.mute} weight={1.6} />
      </div>

      <div
        style={{
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        no pets yet
      </div>
      <div
        style={{
          marginTop: 9,
          fontSize: 30,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.025em',
          lineHeight: 1.25,
          textAlign: 'center',
          maxWidth: 288,
        }}
      >
        the notebook&rsquo;s empty &mdash; add your first pet
      </div>

      <div
        style={{
          marginTop: 22,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          maxWidth: 300,
        }}
      >
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
        <span
          style={{
            fontSize: 14,
            color: v2.ink,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            lineHeight: 1.5,
            textAlign: 'left',
          }}
        >
          this is a <b style={{ fontWeight: 600 }}>keeper&rsquo;s notebook</b>{' '}
          &mdash; whoever you look after, ollie carries their care cadences so
          you don&rsquo;t have to hold the dates in your head.
        </span>
      </div>

      <AmberButton
        icon={<IconPlus size={18} weight={2.4} />}
        onClick={onAdd}
        style={{ marginTop: 30, height: 50, borderRadius: 25 }}
      >
        add your first pet
      </AmberButton>
    </>
  );
}

// ─── the cold worked example (pets-cold.html) ────────────────────────────────

const EXAMPLE_SPECIES: { name: string; care: string }[] = [
  { name: 'a guinea pig', care: 'hay daily' },
  { name: 'a dog', care: 'walks & checkups' },
  { name: 'a bearded dragon', care: 'UVB & warmth' },
];

function ColdExample() {
  return (
    <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          fontSize: 11,
          color: v2.mute,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        ollie knows 10 species
      </div>
      {EXAMPLE_SPECIES.map((eg, i) => (
        <div
          key={eg.name}
          style={{
            boxSizing: 'border-box',
            borderTop: `1px solid ${v2.line}`,
            borderBottom:
              i === EXAMPLE_SPECIES.length - 1 ? `1px solid ${v2.line}` : 'none',
            padding: '14px 2px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <IconPaw size={16} stroke={v2.mute} weight={1.6} />
          <span
            style={{
              flex: 1,
              fontSize: 14,
              color: v2.mute,
              fontWeight: 400,
              letterSpacing: '-0.01em',
            }}
          >
            {eg.name}
          </span>
          <span style={{ fontSize: 12, color: v2.mute, fontWeight: 500, flexShrink: 0 }}>
            {eg.care}
          </span>
        </div>
      ))}
      <div
        style={{
          marginTop: 24,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
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
            marginTop: 5,
          }}
        />
        <span style={{ fontSize: 12, color: v2.mute, fontWeight: 400, lineHeight: 1.5 }}>
          once a pet&rsquo;s in, the care strip, observations and the health
          notes all fill in on their own &mdash; nothing to set up.
        </span>
      </div>
    </div>
  );
}

// ─── one roster row ──────────────────────────────────────────────────────────

interface RosterRowProps {
  pet: RosterEntryVM;
  last: boolean;
  onOpen: () => void;
}

function RosterRow({ pet, last, onOpen }: RosterRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        background: 'transparent',
        border: 'none',
        borderTop: `1px solid ${v2.line}`,
        borderBottom: last ? `1px solid ${v2.line}` : 'none',
        padding: '16px 2px',
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        cursor: 'pointer',
        textAlign: 'left',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          background: DISC_FILL,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: v2.ink }}>
          {pet.petInitial}
        </span>
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              fontSize: 15,
              color: v2.ink,
              fontWeight: 600,
              letterSpacing: '-0.01em',
            }}
          >
            {pet.petName}
          </span>
          <span style={{ fontSize: 12, color: v2.mute, fontWeight: 500 }}>
            {pet.speciesDisplay || speciesLabel(pet.species)}
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              fontWeight: pet.allCurrent ? 600 : 500,
              color: pet.allCurrent ? v2.sage : UMBER,
              letterSpacing: '-0.01em',
              flexShrink: 0,
            }}
          >
            {pet.allCurrent ? 'all current' : pet.careTask}
          </span>
        </span>
        <CareStrip days={pet.strip} size="sm" />
      </span>
      <span style={{ display: 'inline-flex', flexShrink: 0 }} aria-hidden>
        <IconChevronRight stroke={v2.mute} />
      </span>
    </button>
  );
}
