/**
 * v2-shell · BodyHome — the body module homepage (body.html)
 *
 * Level 2. DIRECTION.md: body has 5 submodules — cycle · sleep · body ·
 * medication · habits — so the body page IS a list of 5 calm expandable
 * cards, each one real glance line + one micro-visual.
 *
 * Tapping a card mounts that submodule's real `*-v2` app — the shell does
 * the mount. The glance lines carry the example data from body.html; the
 * mockups themselves are static-shape designs (the live numbers belong on
 * the detail page, which is the real `*-v2` app).
 */
import { HomepageShell } from './HomepageShell';
import { SubmoduleRow, ObservedNote } from './SubmoduleRow';
import { CyclePhaseRing, SleepBars, WaterGlass, MedTimeline, ProgressGauge } from './visuals';
import { v2 } from '../../money-v2/v2';
import type { SubmoduleKey } from '../types';

export interface BodyHomeProps {
  onBack: () => void;
  onFind: () => void;
  onSafe: () => void;
  onOpenSubmodule: (submodule: SubmoduleKey) => void;
}

const b = (t: string) => <b style={{ fontWeight: 600 }}>{t}</b>;

export function BodyHome({ onBack, onFind, onSafe, onOpenSubmodule }: BodyHomeProps) {
  return (
    <HomepageShell label="body" onBack={onBack} onFind={onFind} onSafe={onSafe}>
      <SubmoduleRow
        first
        label="cycle"
        visual={<CyclePhaseRing />}
        glance={<>day {b('14')} · luteal</>}
        onOpen={() => onOpenSubmodule('cycle')}
      />
      <SubmoduleRow
        label="sleep"
        visual={<SleepBars />}
        glance={<>{b('7h 20m')} last night</>}
        onOpen={() => onOpenSubmodule('sleep')}
      />
      <SubmoduleRow
        label="body"
        visual={<WaterGlass />}
        glance={<>{b('4')} of 8 glasses</>}
        onOpen={() => onOpenSubmodule('body')}
      />
      <SubmoduleRow
        label="medication"
        visual={<MedTimeline />}
        glance={<>next {b('2:00pm')} · 1 of 2</>}
        onOpen={() => onOpenSubmodule('medication')}
      />
      <SubmoduleRow
        last
        label="habits"
        visual={<ProgressGauge fill={50} />}
        glance={<>{b('3')} of 6 today</>}
        onOpen={() => onOpenSubmodule('habits')}
      />

      <ObservedNote>
        <span style={{ color: v2.ink }}>luteal — your habits may dip this week</span>
      </ObservedNote>
    </HomepageShell>
  );
}
