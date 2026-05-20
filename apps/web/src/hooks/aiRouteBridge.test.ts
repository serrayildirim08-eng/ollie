/**
 * Tests for aiRouteBrainDump — the three-tier routing bridge.
 *
 * Tiers, in order:
 *   1. cloud hybrid router  (lib/aiRoute aiRoute)        — consent-gated
 *   2. on-device router     (lib/ollie-ai  aiRoute)      — Apple Intelligence
 *   3. keyword floor        (@ollie/logic/dissection extract)
 *
 * The keyword router (`extract`) is left REAL so question-detection is
 * exercised end-to-end. The two AI tiers are mocked so we can drive each
 * branch deterministically.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the cloud hybrid router (lib/aiRoute). ───────────────────────────
vi.mock('../lib/aiRoute', () => ({
  aiRoute: vi.fn(),
}));

// ── Mock the on-device router (lib/ollie-ai). MODULE_EXEMPLARS is provided
// so ON_DEVICE_MODULES (its keys) is a sensible non-empty routable list.
vi.mock('../lib/ollie-ai', () => ({
  aiRoute: vi.fn(),
  MODULE_EXEMPLARS: {
    grocery: 'x',
    finance: 'x',
    work: 'x',
    goals: 'x',
    habits: 'x',
    sleep: 'x',
    cycle: 'x',
    health: 'x',
    body: 'x',
    pets: 'x',
    admin: 'x',
    astrology: 'x',
  },
}));

import { aiRouteBrainDump, type AiRouteOutcome } from './aiRouteBridge';
import { aiRoute as cloudRoute } from '../lib/aiRoute';
import { aiRoute as onDeviceRoute } from '../lib/ollie-ai';
import type { AiRouteResult, RouterMeta } from '../lib/aiRoute';
import type { AiRouteResult as OnDeviceResult } from '../lib/ollie-ai';
import type { Route } from '@ollie/logic/dissection';

const cloud = cloudRoute as unknown as ReturnType<typeof vi.fn>;
const onDevice = onDeviceRoute as unknown as ReturnType<typeof vi.fn>;

/** Narrow a route result to the AiRouteOutcome branch (not an AnswerRoute). */
function asOutcome(result: Route | AiRouteOutcome): AiRouteOutcome {
  if (Array.isArray(result) || 'isAnswer' in result) {
    throw new Error('expected an AiRouteOutcome, got a keyword Route');
  }
  return result;
}

/** A cloud router result with one work-task call. */
function cloudResult(meta: Partial<RouterMeta> = {}): AiRouteResult {
  return {
    calls: [{ tool: 'add_work_task', input: { title: 'ship the router' } }],
    meta: { path: 'slow', ...meta },
  };
}

/** A single-thought on-device result whose text is the whole dump. */
function onDeviceResult(
  module: string,
  confidence: number,
  text = 'on-device thought',
): OnDeviceResult {
  return { routes: [{ module, text, confidence }] };
}

beforeEach(() => {
  cloud.mockReset();
  onDevice.mockReset();
});

describe('aiRouteBrainDump · question bypass', () => {
  it('returns the keyword AnswerRoute and never touches either AI tier', async () => {
    const result = await aiRouteBrainDump('how much did i spend on groceries?');
    expect(Array.isArray(result)).toBe(false);
    expect(result).toMatchObject({ isAnswer: true, type: 'answer' });
    expect(cloud).not.toHaveBeenCalled();
    expect(onDevice).not.toHaveBeenCalled();
  });
});

describe('aiRouteBrainDump · cloud tier wins', () => {
  it('uses the cloud router when it returns calls — on-device never runs', async () => {
    cloud.mockResolvedValue(cloudResult({ path: 'fast' }));
    const result = asOutcome(await aiRouteBrainDump('build the new feature tomorrow'));
    expect(result.usedAi).toBe(true);
    expect(result.tier).toBe('hybrid-fast');
    expect(result.actions).toEqual([
      { module: 'work', action: 'add', data: 'ship the router' },
    ]);
    expect(onDevice).not.toHaveBeenCalled();
  });
});

describe('aiRouteBrainDump · on-device tier', () => {
  it('fires when the cloud returns null and on-device gives a confident module', async () => {
    cloud.mockResolvedValue(null);
    onDevice.mockResolvedValue(
      onDeviceResult('finance', 0.82, 'paid the electricity bill'),
    );
    const result = asOutcome(await aiRouteBrainDump('paid the electricity bill'));
    expect(result.usedAi).toBe(true);
    expect(result.tier).toBe('on-device');
    expect(result.meta).toBeNull();
    // finance is not a LOG_MODULE, so routerCallToAction emits an 'add'.
    // The action carries the item's own split-out text.
    expect(result.actions).toEqual([
      { module: 'finance', action: 'add', data: 'paid the electricity bill' },
    ]);
    // It was passed the canonical routable-module list.
    expect(onDevice).toHaveBeenCalledTimes(1);
    const [text, modules] = onDevice.mock.calls[0] as [string, string[]];
    expect(text).toBe('paid the electricity bill');
    expect(modules).toContain('finance');
    expect(modules).toContain('work');
  });

  it('splits a multi-thought dump into one action per thought', async () => {
    cloud.mockResolvedValue(null);
    onDevice.mockResolvedValue({
      routes: [
        { module: 'finance', text: 'spent 40 on lunch', confidence: 0.9 },
        { module: 'admin', text: 'call the dentist', confidence: 0.85 },
        { module: 'grocery', text: 'buy oat milk', confidence: 0.92 },
      ],
    });
    const result = asOutcome(
      await aiRouteBrainDump(
        'i spent 40 on lunch, need to call the dentist, buy oat milk',
      ),
    );
    expect(result.usedAi).toBe(true);
    expect(result.tier).toBe('on-device');
    expect(result.actions).toHaveLength(3);
    // Each action lands in the right module, carrying its own split-out text.
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ module: 'finance', data: 'spent 40 on lunch' }),
        expect.objectContaining({ module: 'admin', data: 'call the dentist' }),
        expect.objectContaining({ module: 'grocery', data: 'buy oat milk' }),
      ]),
    );
  });

  it('returns a single action for a single-thought dump', async () => {
    cloud.mockResolvedValue(null);
    onDevice.mockResolvedValue(
      onDeviceResult('work', 0.88, 'ship the router'),
    );
    const result = asOutcome(await aiRouteBrainDump('gotta ship the router'));
    expect(result.tier).toBe('on-device');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      module: 'work',
      data: 'ship the router',
    });
  });

  it('routes a low-confidence item to the dump module instead of dropping it', async () => {
    cloud.mockResolvedValue(null);
    onDevice.mockResolvedValue({
      routes: [
        { module: 'finance', text: 'spent 40 on lunch', confidence: 0.9 },
        { module: 'work', text: 'some vague half-thought', confidence: 0.2 },
      ],
    });
    const result = asOutcome(
      await aiRouteBrainDump('spent 40 on lunch and some vague half-thought'),
    );
    expect(result.tier).toBe('on-device');
    expect(result.actions).toHaveLength(2);
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ module: 'finance', data: 'spent 40 on lunch' }),
        expect.objectContaining({
          module: 'dump',
          data: 'some vague half-thought',
        }),
      ]),
    );
  });

  it('accepts a classification exactly at the 0.4 confidence threshold', async () => {
    cloud.mockResolvedValue(null);
    onDevice.mockResolvedValue(
      onDeviceResult('habits', 0.4, 'went for a run this morning'),
    );
    const result = asOutcome(await aiRouteBrainDump('went for a run this morning'));
    expect(result.tier).toBe('on-device');
    expect(result.actions[0].module).toBe('habits');
  });

  it('routes the "notebook" no-fit fallback to the dump module', async () => {
    cloud.mockResolvedValue(null);
    onDevice.mockResolvedValue(
      onDeviceResult('notebook', 0.9, 'a stray thought with no clear home'),
    );
    const result = asOutcome(
      await aiRouteBrainDump('a stray thought with no clear home'),
    );
    expect(result.tier).toBe('on-device');
    expect(result.actions[0].module).toBe('dump');
    expect(result.actions[0].data).toBe('a stray thought with no clear home');
  });

  it('routes a BELOW-threshold single item to the dump module (on-device tier)', async () => {
    cloud.mockResolvedValue(null);
    onDevice.mockResolvedValue(
      onDeviceResult('finance', 0.39, 'something vague'),
    );
    const result = asOutcome(await aiRouteBrainDump('something vague'));
    // A returned-but-low-confidence item still routes — to the notebook.
    expect(result.usedAi).toBe(true);
    expect(result.tier).toBe('on-device');
    expect(result.actions).toEqual([
      { module: 'dump', action: 'log', data: 'something vague' },
    ]);
  });

  it('falls to the keyword floor when on-device returns an empty route list', async () => {
    cloud.mockResolvedValue(null);
    onDevice.mockResolvedValue({ routes: [] });
    const result = asOutcome(await aiRouteBrainDump('something vague'));
    expect(result.usedAi).toBe(false);
    expect(result.tier).toBe('keyword');
  });

  it('falls to the keyword floor when on-device is unavailable (null)', async () => {
    cloud.mockResolvedValue(null);
    onDevice.mockResolvedValue(null);
    const result = asOutcome(await aiRouteBrainDump('something vague'));
    expect(result.usedAi).toBe(false);
    expect(result.tier).toBe('keyword');
    expect(onDevice).toHaveBeenCalledTimes(1);
  });

  it('falls to the keyword floor when on-device throws', async () => {
    cloud.mockResolvedValue(null);
    onDevice.mockRejectedValue(new Error('native bridge exploded'));
    // aiRouteBrainDump must not reject — the floor catches everything.
    await expect(
      aiRouteBrainDump('something vague'),
    ).resolves.toMatchObject({ tier: 'keyword', usedAi: false });
  });
});

describe('aiRouteBrainDump · keyword floor', () => {
  it('ships keyword actions verbatim when both AI tiers produce nothing', async () => {
    cloud.mockResolvedValue(null);
    onDevice.mockResolvedValue(null);
    const result = asOutcome(await aiRouteBrainDump('buy milk'));
    expect(result.usedAi).toBe(false);
    expect(result.tier).toBe('keyword');
    expect(result.actions.length).toBeGreaterThan(0);
  });
});
