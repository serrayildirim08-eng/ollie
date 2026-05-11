/**
 * OnboardingScreen — 8-screen first-launch setup flow.
 *
 * Screens (in order):
 *   0  Welcome       — name input
 *   1  Pets          — yes/no; if yes: add pets
 *   2  Pantry        — tap-to-remove staples chips
 *   3  Subscriptions — tap-to-confirm subscription chips
 *   4  SpendResearch — anonymous spending-research opt-in
 *   5  WorkTime      — best-work-time chips
 *   6  Cycle         — cycle tracking opt-in
 *   7  Burhan        — seedling intro + "let's go" CTA
 *
 * Props:
 *   onComplete — called after screen 7 or after Skip. Sets onboarded = true.
 */

import React, { useReducer, useRef, useEffect } from 'react';
import { Burhan3D } from '../components/Burhan3D';
import { store } from '../store';

// ─── types ──────────────────────────────────────────────────────────────────

interface PetDraft {
  id: string;
  name: string;
  species: string;
}

interface State {
  screen: number;
  name: string;
  hasPets: boolean | null;
  petDrafts: PetDraft[];
  pantryItems: string[];
  subscriptions: string[];
  spendResearch: boolean | null;
  workTime: string;
  cycleTracking: string;
  // transition
  visible: boolean;
}

type Action =
  | { type: 'SET_NAME'; value: string }
  | { type: 'SET_HAS_PETS'; value: boolean }
  | { type: 'ADD_PET' }
  | { type: 'UPDATE_PET'; index: number; field: 'name' | 'species'; value: string }
  | { type: 'REMOVE_PET'; index: number }
  | { type: 'TOGGLE_PANTRY'; item: string }
  | { type: 'TOGGLE_SUB'; item: string }
  | { type: 'SET_SPEND_RESEARCH'; value: boolean }
  | { type: 'SET_WORK_TIME'; value: string }
  | { type: 'SET_CYCLE'; value: string }
  | { type: 'NEXT' }
  | { type: 'FADE_IN' };

// ─── defaults ────────────────────────────────────────────────────────────────

const DEFAULT_PANTRY = [
  'eggs', 'milk', 'bread', 'rice', 'pasta',
  'onions', 'garlic', 'tomatoes', 'olive oil', 'salt', 'butter', 'cheese',
];

const DEFAULT_SUBS = [
  'Netflix', 'Spotify', 'Canva', 'Notion', 'YouTube Premium',
  'iCloud', 'Apple Music', 'Disney+', 'Amazon Prime', 'ChatGPT',
];

const WORK_TIMES = [
  { id: 'morning',    label: 'morning' },
  { id: 'afternoon',  label: 'afternoon' },
  { id: 'evening',    label: 'evening' },
  { id: 'late_night', label: 'late night' },
  { id: 'all_over',   label: 'all over the place' },
];

// ─── reducer ─────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_NAME':
      return { ...state, name: action.value };
    case 'SET_HAS_PETS':
      return { ...state, hasPets: action.value };
    case 'ADD_PET':
      return {
        ...state,
        petDrafts: [...state.petDrafts, { id: uid(), name: '', species: '' }],
      };
    case 'UPDATE_PET': {
      const drafts = state.petDrafts.map((p, i) =>
        i === action.index ? { ...p, [action.field]: action.value } : p,
      );
      return { ...state, petDrafts: drafts };
    }
    case 'REMOVE_PET':
      return {
        ...state,
        petDrafts: state.petDrafts.filter((_, i) => i !== action.index),
      };
    case 'TOGGLE_PANTRY': {
      const has = state.pantryItems.includes(action.item);
      return {
        ...state,
        pantryItems: has
          ? state.pantryItems.filter((x) => x !== action.item)
          : [...state.pantryItems, action.item],
      };
    }
    case 'TOGGLE_SUB': {
      const has = state.subscriptions.includes(action.item);
      return {
        ...state,
        subscriptions: has
          ? state.subscriptions.filter((x) => x !== action.item)
          : [...state.subscriptions, action.item],
      };
    }
    case 'SET_SPEND_RESEARCH':
      return { ...state, spendResearch: action.value };
    case 'SET_WORK_TIME':
      return { ...state, workTime: action.value };
    case 'SET_CYCLE':
      return { ...state, cycleTracking: action.value };
    case 'NEXT':
      return { ...state, screen: state.screen + 1, visible: false };
    case 'FADE_IN':
      return { ...state, visible: true };
    default:
      return state;
  }
}

const INITIAL: State = {
  screen: 0,
  name: '',
  hasPets: null,
  petDrafts: [],
  pantryItems: [...DEFAULT_PANTRY],
  subscriptions: [],
  spendResearch: null,
  workTime: '',
  cycleTracking: '',
  visible: true,
};

// ─── commit helpers ──────────────────────────────────────────────────────────

function commitAll(state: State): void {
  const ts = Date.now();

  // shared.settings — dotted namespace matches the keys other surfaces read.
  // Credibility audit NC4: previously these were written as flat keys
  // (`has_pets`, `consent_spending_research`) and silently lost.
  store.set('shared', 'name', state.name.trim() || null);
  store.set('shared', 'settings.has_pets', state.hasPets ?? false);
  store.set('shared', 'settings.work_time', state.workTime || null);
  store.set('shared', 'settings.cycle_tracking', state.cycleTracking || null);
  store.set('shared', 'onboarded', true);

  // shared.consent — dotted keys match Garden gate + research-stream client.
  store.set('shared', 'consent.spending_research', state.spendResearch ?? false);
  store.set('shared', 'consent.cycle', state.cycleTracking === 'yes');

  // pets.pets
  if (state.hasPets && state.petDrafts.length > 0) {
    const pets = state.petDrafts
      .filter((p) => p.name.trim())
      .map((p) => ({
        id: p.id,
        name: p.name.trim(),
        species: p.species.trim() || 'unknown',
        ts,
      }));
    store.set('pets', 'pets', pets);
  } else {
    store.set('pets', 'pets', []);
  }

  // grocery.pantry
  const pantry = state.pantryItems.map((name) => ({
    id: uid(),
    name,
    ts,
  }));
  store.set('grocery', 'pantry', pantry);

  // finance.subscriptions
  const subs = state.subscriptions.map((name) => ({
    id: uid(),
    name,
    ts,
  }));
  store.set('finance', 'subscriptions', subs);
}

// ─── shared sub-components ───────────────────────────────────────────────────

const TOTAL_SCREENS = 8;

function ProgressDots({ current }: { current: number }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={current + 1}
      aria-valuemin={1}
      aria-valuemax={TOTAL_SCREENS}
      aria-label={`step ${current + 1} of ${TOTAL_SCREENS}`}
      style={{
        display: 'flex',
        gap: '6px',
        justifyContent: 'center',
        paddingBottom: '32px',
      }}
    >
      {Array.from({ length: TOTAL_SCREENS }, (_, i) => (
        <span
          key={i}
          style={{
            width: i === current ? '20px' : '6px',
            height: '6px',
            borderRadius: '3px',
            background: i === current ? 'var(--accent)' : 'var(--rule)',
            display: 'inline-block',
            transition: 'all 300ms ease',
          }}
        />
      ))}
    </div>
  );
}

function ScreenShell({
  children,
  visible,
  reducedMotion,
}: {
  children: React.ReactNode;
  visible: boolean;
  reducedMotion: boolean;
}) {
  const style: React.CSSProperties = reducedMotion
    ? { opacity: visible ? 1 : 0, transition: 'opacity 200ms ease' }
    : {
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        transition: 'opacity 400ms ease-out, transform 400ms ease-out',
      };

  return (
    <div
      style={{
        ...style,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 0 24px',
        overflowY: 'auto',
      }}
    >
      {children}
    </div>
  );
}

interface ChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  variant?: 'tap-remove' | 'tap-confirm' | 'single-select';
}

function Chip({ label, selected, onClick, variant = 'tap-confirm' }: ChipProps) {
  const isActive = variant === 'tap-remove' ? selected : selected;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      style={{
        padding: '10px 16px',
        minHeight: '44px',
        border: isActive
          ? '1px solid var(--accent)'
          : '1px solid var(--rule)',
        borderRadius: '22px',
        background: isActive
          ? 'rgba(46,93,67,0.08)'
          : 'transparent',
        color: isActive ? 'var(--accent)' : 'var(--ink-soft)',
        fontFamily: "'DM Mono', monospace",
        fontSize: 'var(--t-caption)',
        letterSpacing: '0.04em',
        cursor: 'pointer',
        transition: 'all 200ms ease',
        textDecoration: variant === 'tap-remove' && !selected ? 'line-through' : 'none',
        opacity: variant === 'tap-remove' && !selected ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  );
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h1
      style={{
        fontFamily: "'DM Serif Display', Georgia, serif",
        fontSize: 'var(--t-h1)',
        fontWeight: 400,
        lineHeight: 'var(--lh-headline)',
        letterSpacing: 'var(--ls-h1)',
        color: 'var(--ink)',
        margin: '0 0 32px',
      }}
    >
      {children}
    </h1>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontSize: 'var(--t-body)',
        color: 'var(--ink-soft)',
        margin: '0 0 32px',
        lineHeight: 'var(--lh-body)',
        maxWidth: '46ch',
      }}
    >
      {children}
    </p>
  );
}

function PrimaryBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '14px 32px',
        minHeight: '48px',
        border: '1px solid var(--ink)',
        borderRadius: '24px',
        background: 'transparent',
        color: 'var(--ink)',
        fontFamily: "'DM Mono', monospace",
        fontSize: 'var(--t-caption)',
        letterSpacing: '0.08em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'opacity 200ms ease',
        alignSelf: 'flex-start',
      }}
    >
      {label}
    </button>
  );
}

// ─── Screen 0: Welcome ───────────────────────────────────────────────────────

function WelcomeScreen({
  state,
  dispatch,
  onNext,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onNext: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <>
      <Headline>hi.</Headline>
      <Sub>
        ollie sorts what's in your head into the right places. seven small questions before we
        start — all skippable.
      </Sub>
      <input
        ref={inputRef}
        type="text"
        value={state.name}
        onChange={(e) => dispatch({ type: 'SET_NAME', value: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') onNext(); }}
        placeholder="what should i call you?"
        aria-label="your name"
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 'var(--t-caption)',
          padding: '14px 0',
          border: 'none',
          borderBottom: '1px solid var(--rule)',
          background: 'transparent',
          color: 'var(--ink)',
          outline: 'none',
          width: '100%',
          maxWidth: '360px',
          marginBottom: '32px',
          letterSpacing: '0.04em',
        }}
      />
      <PrimaryBtn label="let's go" onClick={onNext} />
    </>
  );
}

// ─── Screen 1: Pets ──────────────────────────────────────────────────────────

function PetsScreen({
  state,
  dispatch,
  onNext,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onNext: () => void;
}) {
  return (
    <>
      <Headline>any pets?</Headline>
      {state.hasPets === null && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '32px' }}>
          <Chip
            label="yes"
            selected={false}
            variant="tap-confirm"
            onClick={() => dispatch({ type: 'SET_HAS_PETS', value: true })}
          />
          <Chip
            label="no"
            selected={false}
            variant="tap-confirm"
            onClick={() => {
              dispatch({ type: 'SET_HAS_PETS', value: false });
              onNext();
            }}
          />
        </div>
      )}
      {state.hasPets === true && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px', maxWidth: '400px' }}>
            {state.petDrafts.map((pet, i) => (
              <div key={pet.id} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="text"
                  value={pet.name}
                  onChange={(e) => dispatch({ type: 'UPDATE_PET', index: i, field: 'name', value: e.target.value })}
                  placeholder="name"
                  aria-label={`pet ${i + 1} name`}
                  style={inputStyle}
                />
                <input
                  type="text"
                  value={pet.species}
                  onChange={(e) => dispatch({ type: 'UPDATE_PET', index: i, field: 'species', value: e.target.value })}
                  placeholder="species"
                  aria-label={`pet ${i + 1} species`}
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'REMOVE_PET', index: i })}
                  aria-label={`remove pet ${i + 1}`}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--ink-faint)',
                    cursor: 'pointer',
                    fontSize: '18px',
                    lineHeight: 1,
                    padding: '4px',
                    flexShrink: 0,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => dispatch({ type: 'ADD_PET' })}
              style={{
                padding: '10px 16px',
                minHeight: '44px',
                border: '1px dashed var(--rule)',
                borderRadius: '22px',
                background: 'transparent',
                color: 'var(--ink-faint)',
                fontFamily: "'DM Mono', monospace",
                fontSize: 'var(--t-caption)',
                cursor: 'pointer',
              }}
            >
              + add pet
            </button>
            <PrimaryBtn label="next" onClick={onNext} />
          </div>
          {state.petDrafts.length === 0 && (
            <button
              type="button"
              onClick={() => dispatch({ type: 'ADD_PET' })}
              style={{ display: 'none' }}
              aria-hidden="true"
            />
          )}
          {state.petDrafts.length === 0 && (
            <p
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 'var(--t-caption)',
                color: 'var(--ink-faint)',
                marginTop: '8px',
              }}
            >
              tap "+ add pet" to add one, or skip.
            </p>
          )}
        </>
      )}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: "'DM Mono', monospace",
  fontSize: 'var(--t-caption)',
  padding: '10px 0',
  border: 'none',
  borderBottom: '1px solid var(--rule)',
  background: 'transparent',
  color: 'var(--ink)',
  outline: 'none',
  flex: 1,
  minWidth: '80px',
  letterSpacing: '0.02em',
};

// ─── Screen 2: Pantry Staples ────────────────────────────────────────────────

function PantryScreen({
  state,
  dispatch,
  onNext,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onNext: () => void;
}) {
  return (
    <>
      <Headline>pantry staples.</Headline>
      <Sub>these are in by default. tap to remove any you don't keep.</Sub>
      <div
        role="group"
        aria-label="pantry staples"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '32px' }}
      >
        {DEFAULT_PANTRY.map((item) => {
          const included = state.pantryItems.includes(item);
          return (
            <Chip
              key={item}
              label={item}
              selected={included}
              variant="tap-remove"
              onClick={() => dispatch({ type: 'TOGGLE_PANTRY', item })}
            />
          );
        })}
      </div>
      <PrimaryBtn label="next" onClick={onNext} />
    </>
  );
}

// ─── Screen 3: Subscriptions ─────────────────────────────────────────────────

function SubscriptionsScreen({
  state,
  dispatch,
  onNext,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onNext: () => void;
}) {
  return (
    <>
      <Headline>subscriptions?</Headline>
      <Sub>tap the ones you have. i'll track renewal dates.</Sub>
      <div
        role="group"
        aria-label="subscriptions"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '32px' }}
      >
        {DEFAULT_SUBS.map((item) => (
          <Chip
            key={item}
            label={item}
            selected={state.subscriptions.includes(item)}
            variant="tap-confirm"
            onClick={() => dispatch({ type: 'TOGGLE_SUB', item })}
          />
        ))}
      </div>
      <PrimaryBtn label="next" onClick={onNext} />
    </>
  );
}

// ─── Screen 4: Spending Research ─────────────────────────────────────────────

function SpendResearchScreen({
  state,
  dispatch,
  onNext,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onNext: () => void;
}) {
  return (
    <>
      <Headline>one more thing.</Headline>
      <Sub>
        you can help us understand how adhd brains spend. anonymous. off by default. change
        this anytime in settings.
      </Sub>
      {state.spendResearch === null && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '32px' }}>
          <Chip
            label="yes, help out"
            selected={false}
            variant="tap-confirm"
            onClick={() => {
              dispatch({ type: 'SET_SPEND_RESEARCH', value: true });
              onNext();
            }}
          />
          <Chip
            label="no thanks"
            selected={false}
            variant="tap-confirm"
            onClick={() => {
              dispatch({ type: 'SET_SPEND_RESEARCH', value: false });
              onNext();
            }}
          />
        </div>
      )}
    </>
  );
}

// ─── Screen 5: Work Time ─────────────────────────────────────────────────────

function WorkTimeScreen({
  state,
  dispatch,
  onNext,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onNext: () => void;
}) {
  return (
    <>
      <Headline>when do you do your best work?</Headline>
      <div
        role="group"
        aria-label="best work time"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '32px' }}
      >
        {WORK_TIMES.map(({ id, label }) => (
          <Chip
            key={id}
            label={label}
            selected={state.workTime === id}
            variant="single-select"
            onClick={() => {
              dispatch({ type: 'SET_WORK_TIME', value: id });
            }}
          />
        ))}
      </div>
      <PrimaryBtn label="next" onClick={onNext} />
    </>
  );
}

// ─── Screen 6: Cycle Tracking ────────────────────────────────────────────────

const CYCLE_OPTIONS = [
  { id: 'yes',        label: 'yes' },
  { id: 'no',         label: 'no' },
  { id: 'not_anymore', label: 'not anymore' },
  { id: 'postpartum', label: 'postpartum / pregnant' },
];

function CycleScreen({
  state,
  dispatch,
  onNext,
}: {
  state: State;
  dispatch: React.Dispatch<Action>;
  onNext: () => void;
}) {
  return (
    <>
      <Headline>do you track a menstrual cycle?</Headline>
      <Sub>if no, the cycle module and cycle-related patterns won't show up at all.</Sub>
      <div
        role="group"
        aria-label="cycle tracking preference"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '32px' }}
      >
        {CYCLE_OPTIONS.map(({ id, label }) => (
          <Chip
            key={id}
            label={label}
            selected={state.cycleTracking === id}
            variant="single-select"
            onClick={() => {
              dispatch({ type: 'SET_CYCLE', value: id });
            }}
          />
        ))}
      </div>
      <PrimaryBtn label="next" onClick={onNext} />
    </>
  );
}

// ─── Screen 7: Burhan ────────────────────────────────────────────────────────

function BurhanIntroScreen({ onDone }: { onDone: () => void }) {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px' }}>
        <Burhan3D height={120} width={120} />
      </div>
      <Headline>meet burhan. he lives here.</Headline>
      <Sub>he'll grow as you use ollie. he's been here since the beginning.</Sub>
      <PrimaryBtn label="let's go" onClick={onDone} />
    </>
  );
}

// ─── Root component ──────────────────────────────────────────────────────────

export interface OnboardingScreenProps {
  onComplete: () => void;
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const prefersReduced = useRef(
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  ).current;

  // Trigger fade-in after mount and after each screen advance
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      dispatch({ type: 'FADE_IN' });
    });
    return () => cancelAnimationFrame(id);
  }, [state.screen]);

  function onSkipToDashboard() {
    store.set('shared', 'onboarded', true);
    onComplete();
  }

  function advance() {
    // NEXT hides current screen; FADE_IN effect runs on re-render
    dispatch({ type: 'NEXT' });
  }

  function finish() {
    commitAll(state);
    onComplete();
  }

  const SCREEN_COUNT = 8;

  let screenContent: React.ReactNode;

  switch (state.screen) {
    case 0:
      screenContent = (
        <WelcomeScreen state={state} dispatch={dispatch} onNext={advance} />
      );
      break;
    case 1:
      screenContent = (
        <PetsScreen state={state} dispatch={dispatch} onNext={advance} />
      );
      break;
    case 2:
      screenContent = (
        <PantryScreen state={state} dispatch={dispatch} onNext={advance} />
      );
      break;
    case 3:
      screenContent = (
        <SubscriptionsScreen state={state} dispatch={dispatch} onNext={advance} />
      );
      break;
    case 4:
      screenContent = (
        <SpendResearchScreen state={state} dispatch={dispatch} onNext={advance} />
      );
      break;
    case 5:
      screenContent = (
        <WorkTimeScreen state={state} dispatch={dispatch} onNext={advance} />
      );
      break;
    case 6:
      screenContent = (
        <CycleScreen state={state} dispatch={dispatch} onNext={advance} />
      );
      break;
    case 7:
      screenContent = <BurhanIntroScreen onDone={finish} />;
      break;
    default:
      // Should not happen, but guard against reducer overshoot
      screenContent = null;
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        background: 'var(--bone)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '24px 32px 0',
        }}
      >
        <button
          type="button"
          onClick={onSkipToDashboard}
          aria-label="skip onboarding"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--ink-faint)',
            fontFamily: "'DM Mono', monospace",
            fontSize: 'var(--t-kicker)',
            letterSpacing: 'var(--ls-caps)',
            textTransform: 'uppercase',
            cursor: 'pointer',
            padding: '8px',
          }}
        >
          skip
        </button>
      </div>

      {/* Content area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '600px',
          width: '100%',
          margin: '0 auto',
          padding: '48px 32px 24px',
        }}
      >
        <ScreenShell visible={state.visible} reducedMotion={prefersReduced}>
          {screenContent}
        </ScreenShell>
      </div>

      {/* Progress dots */}
      <ProgressDots current={Math.min(state.screen, SCREEN_COUNT - 1)} />
    </div>
  );
}
