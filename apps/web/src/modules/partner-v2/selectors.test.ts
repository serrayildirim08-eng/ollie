/**
 * partner-v2 · selectors — unit tests
 *
 * The selectors are the pure view-model layer over the partner stub state.
 * partner-v2 is a NEW feature with no backend (see selectors.ts header) —
 * these tests verify the stub-driven view-models: the my-partner face, the
 * invite code shaping, the ask-flow note composition, and the sharing
 * opt-in preview derivation. Mirrors habits-v2/selectors.test.ts in spirit.
 */
import { describe, it, expect } from 'vitest';
import {
  whenLabel,
  partnerInitial,
  myPartnerVM,
  inviteVM,
  emptyAskSelection,
  askSelectionCount,
  composeAskNote,
  askFlowVM,
  sharingVM,
  SEED_PARTNER_STATE,
  ASK_CATEGORIES,
  SHARING_ROWS,
  type PartnerState,
  type AskSelection,
} from './selectors';

const NOW = new Date('2026-05-18T09:00:00').getTime();
const DAY = 86_400_000;

/** the seeded stub state with sane test offsets */
function seed(over: Partial<PartnerState> = {}): PartnerState {
  return {
    ...SEED_PARTNER_STATE,
    sharedPatterns: SEED_PARTNER_STATE.sharedPatterns.map((p) => ({ ...p })),
    asks: SEED_PARTNER_STATE.asks.map((a) => ({ ...a })),
    sharing: { ...SEED_PARTNER_STATE.sharing },
    ...over,
  };
}

describe('small helpers', () => {
  it('whenLabel reads as a calm recency phrase, never exact', () => {
    expect(whenLabel(NOW, NOW)).toBe('today');
    expect(whenLabel(NOW - DAY, NOW)).toBe('yesterday');
    expect(whenLabel(NOW - 3 * DAY, NOW)).toBe('3 days ago');
    expect(whenLabel(NOW - 9 * DAY, NOW)).toBe('last week');
    expect(whenLabel(NOW - 20 * DAY, NOW)).toBe('2 weeks ago');
  });

  it('partnerInitial takes the uppercase first letter', () => {
    expect(partnerInitial('Sam')).toBe('S');
    expect(partnerInitial('alex')).toBe('A');
    expect(partnerInitial('')).toBe('?');
  });
});

describe('myPartnerVM', () => {
  it('renders the linked partner — name, initial, soft states, asks', () => {
    const vm = myPartnerVM(seed(), NOW);
    expect(vm.hasPartner).toBe(true);
    expect(vm.name).toBe('Sam');
    expect(vm.initial).toBe('S');
    expect(vm.linkedSince).toBe('linked since march');
    expect(vm.patterns).toHaveLength(3);
    expect(vm.patterns[0].line).toBe('low on sleep this week');
  });

  it('the most recent ask is the focus row; older asks sit in history', () => {
    const vm = myPartnerVM(seed(), NOW);
    expect(vm.asks.latest?.kind).toBe('touch');
    expect(vm.asks.latest?.state).toBe('seen');
    // two older asks, newest-first
    expect(vm.asks.past).toHaveLength(2);
    expect(vm.asks.past[0].kind).toBe('labor');
  });

  it('an unlinked state has hasPartner false — drives the invite floor', () => {
    const vm = myPartnerVM(seed({ linkedPartner: null }), NOW);
    expect(vm.hasPartner).toBe(false);
  });

  it('with no asks the focus row is null', () => {
    const vm = myPartnerVM(seed({ asks: [] }), NOW);
    expect(vm.asks.latest).toBeNull();
    expect(vm.asks.past).toHaveLength(0);
  });
});

describe('inviteVM', () => {
  it('shapes the bare code into a display code + a share link', () => {
    const vm = inviteVM(seed({ inviteCode: 'k4m9' }));
    expect(vm.code).toBe('K4M9');
    expect(vm.displayCode).toBe('OLLIE·K4M9');
    expect(vm.shareLink).toContain('K4M9');
  });
});

describe('ask flow', () => {
  it('an empty selection counts zero and gates the send', () => {
    const sel = emptyAskSelection();
    expect(askSelectionCount(sel)).toBe(0);
    const vm = askFlowVM(seed(), sel);
    expect(vm.canSend).toBe(false);
    expect(vm.note).toContain('pick a few');
  });

  it('composeAskNote folds picks into ollie’s calm note', () => {
    const sel: AskSelection = {
      material: ['heat_pad'],
      touch: ['sit_close'],
      labor: ['dishes'],
      emotional: ['listen'],
    };
    const note = composeAskNote(sel);
    expect(note).toContain('a heat pad');
    expect(note).toContain('just sit close');
    expect(note).toContain('the dishes handled');
    expect(note).toContain('you to just listen');
    expect(note.endsWith('.')).toBe(true);
  });

  it('a single-category pick still composes a sane note + unlocks send', () => {
    const sel: AskSelection = {
      ...emptyAskSelection(),
      touch: ['hug'],
    };
    expect(askSelectionCount(sel)).toBe(1);
    const vm = askFlowVM(seed(), sel);
    expect(vm.canSend).toBe(true);
    expect(vm.note).toContain('a hug');
    expect(vm.partnerName).toBe('Sam');
  });

  it('every ask category exposes 4 options with note fragments', () => {
    expect(ASK_CATEGORIES).toHaveLength(4);
    for (const cat of ASK_CATEGORIES) {
      expect(cat.options).toHaveLength(4);
      for (const opt of cat.options) {
        expect(opt.fragment.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('sharingVM', () => {
  it('folds each toggle’s persisted bit onto its row', () => {
    const vm = sharingVM(seed());
    expect(vm.rows).toHaveLength(SHARING_ROWS.length);
    const on = vm.rows.filter((r) => r.on).map((r) => r.key);
    expect(on).toEqual(['cycle', 'sleep', 'stress']);
  });

  it('the preview shows only the lines whose toggle is on', () => {
    const vm = sharingVM(seed());
    expect(vm.preview.map((p) => p.key)).toEqual(['cycle', 'sleep', 'stress']);
    // energy + mood are off — the note names them
    expect(vm.previewNote).toContain('energy');
    expect(vm.previewNote).toContain('mood');
  });

  it('all-off → an empty preview with a calm note', () => {
    const vm = sharingVM(
      seed({ sharing: { cycle: false, sleep: false, stress: false, energy: false, mood: false } }),
    );
    expect(vm.preview).toHaveLength(0);
    expect(vm.previewNote).toContain('everything is off');
  });

  it('all-on → a full preview with no off-rows note', () => {
    const vm = sharingVM(
      seed({ sharing: { cycle: true, sleep: true, stress: true, energy: true, mood: true } }),
    );
    expect(vm.preview).toHaveLength(5);
    expect(vm.previewNote).toContain('every soft state is on');
  });
});
