/**
 * v2-shell · HomeHome — the home module homepage (home.html)
 *
 * Level 2. DIRECTION.md: home has 3 submodules — admin · pets · grocery.
 * With only three, thin rows would read barren, so each card is a TALL
 * preview block: a bigger visual, the glance line, and 2-3 lines of real
 * previewed content at rest.
 *
 * Tapping a card (or its `open …` cue) mounts that submodule's real
 * `*-v2` app. grocery's three modes (shop · feed me · pantry) all open
 * the grocery app — its own face picks the mode.
 */
import { HomepageShell } from './HomepageShell';
import { SubmoduleRow, ObservedNote } from './SubmoduleRow';
import { TaskStack, PetRings, GroceryNote } from './visuals';
import { v2 } from '../../money-v2/v2';
import type { SubmoduleKey } from '../types';

const box = { boxSizing: 'border-box' as const };

export interface HomeHomeProps {
  onBack: () => void;
  onFind: () => void;
  onSafe: () => void;
  onOpenSubmodule: (submodule: SubmoduleKey) => void;
}

const b = (t: string) => <b style={{ fontWeight: 600 }}>{t}</b>;

/** admin — a quiet upcoming-item row */
function UpRow({ name, when, due = false, first = false }: { name: string; when: string; due?: boolean; first?: boolean }) {
  return (
    <div
      style={{
        ...box,
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        padding: '8px 0',
        borderTop: first ? 'none' : `1px solid ${v2.line}`,
        paddingTop: first ? 2 : 8,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 2,
          border: `1.4px solid ${due ? v2.umber : v2.mute}`,
          background: due ? v2.umber : 'transparent',
          flexShrink: 0,
          alignSelf: 'center',
        }}
      />
      <span style={{ flex: 1, fontSize: 14, color: v2.ink, fontWeight: due ? 600 : 400, letterSpacing: '-.01em' }}>
        {name}
      </span>
      <span style={{ fontSize: 13, color: due ? v2.umber : v2.mute, fontWeight: due ? 600 : 500, flexShrink: 0 }}>
        {when}
      </span>
    </div>
  );
}

/** pets — a per-pet row with its next care item */
function PetRow({ initial, name, care, ok = false, first = false }: { initial: string; name: string; care: React.ReactNode; ok?: boolean; first?: boolean }) {
  return (
    <div
      style={{
        ...box,
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '9px 0',
        borderTop: first ? 'none' : `1px solid ${v2.line}`,
        paddingTop: first ? 2 : 9,
      }}
    >
      <span
        aria-hidden
        style={{ width: 26, height: 26, borderRadius: '50%', background: v2.tile, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: v2.ink }}>{initial}</span>
      </span>
      <span style={{ fontSize: 14, color: v2.ink, fontWeight: 600, flexShrink: 0 }}>{name}</span>
      <span style={{ flex: 1, fontSize: 13, color: ok ? v2.sage : v2.mute, fontWeight: ok ? 600 : 500, textAlign: 'right', letterSpacing: '-.01em' }}>
        {care}
      </span>
    </div>
  );
}

/** grocery — a calm mode content-row (shop · feed me · pantry) */
function ModeRow({ name, stat, low = false, first = false }: { name: string; stat: React.ReactNode; low?: boolean; first?: boolean }) {
  return (
    <div
      style={{
        ...box,
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        padding: '13px 0',
        borderTop: first ? 'none' : `1px solid ${v2.line}`,
        paddingTop: first ? 3 : 13,
      }}
    >
      <span style={{ fontSize: 14, color: v2.ink, fontWeight: 600, letterSpacing: '-.01em', flexShrink: 0 }}>{name}</span>
      <span style={{ flex: 1, fontSize: 13, color: low ? v2.umber : v2.mute, fontWeight: low ? 600 : 500, textAlign: 'right', letterSpacing: '-.01em' }}>
        {stat}
      </span>
    </div>
  );
}

export function HomeHome({ onBack, onFind, onSafe, onOpenSubmodule }: HomeHomeProps) {
  return (
    <HomepageShell label="home" onBack={onBack} onFind={onFind} onSafe={onSafe}>
      <SubmoduleRow
        first
        label="admin"
        vizWidth={62}
        visual={<TaskStack />}
        glance={<>{b('2')} due this week · renew passport soonest</>}
        openCue="open admin"
        onOpen={() => onOpenSubmodule('admin')}
        preview={
          <>
            <UpRow first due name="renew passport" when="4 days" />
            <UpRow name="dentist cleaning" when="next week" />
            <UpRow name="car registration" when="in 2 weeks" />
          </>
        }
      />
      <SubmoduleRow
        label="pets"
        vizWidth={62}
        visual={<PetRings />}
        glance={<>{b('2')} in the notebook · 1 thing waiting</>}
        openCue="open pets"
        onOpen={() => onOpenSubmodule('pets')}
        preview={
          <>
            <PetRow first initial="M" name="Mango" care={<>flea drops · {b('tomorrow')}</>} />
            <PetRow initial="T" name="Tonti" care="all current" ok />
          </>
        }
      />
      <SubmoduleRow
        last
        label="grocery"
        vizWidth={62}
        visual={<GroceryNote />}
        glance={<>3 ways in · {b('shop')}, feed me, pantry</>}
        openCue="open grocery"
        onOpen={() => onOpenSubmodule('grocery')}
        preview={
          <>
            <ModeRow first name="shop" stat={<>{b('4')} on the list</>} />
            <ModeRow name="feed me" stat={<>{b('3')} meals from what you have</>} />
            <ModeRow name="pantry" stat="olive oil running low" low />
          </>
        }
      />

      <ObservedNote>pet care tends to slip on your low-sleep days</ObservedNote>
    </HomepageShell>
  );
}
