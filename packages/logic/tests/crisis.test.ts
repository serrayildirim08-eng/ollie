import { describe, it, expect } from 'vitest';
import { CRISIS_RE, detectCrisis } from '../src/crisis';
// TR_UNICODE_CRISIS_RE is internal — tested via detectCrisis, not exported directly.

// ─── CRISIS_RE direct tests ───────────────────────────────────────────────────

describe('CRISIS_RE', () => {
  it('matches "kill myself"', () => {
    expect(CRISIS_RE.test('i want to kill myself')).toBe(true);
  });

  it('matches "suicide" and variants', () => {
    expect(CRISIS_RE.test('thinking about suicide')).toBe(true);
    expect(CRISIS_RE.test('suicidal thoughts keep coming')).toBe(true);
    expect(CRISIS_RE.test('suicidality is exhausting')).toBe(true);
  });

  it('matches "end my life"', () => {
    expect(CRISIS_RE.test("i want to end my life")).toBe(true);
  });

  it('matches "end it"', () => {
    expect(CRISIS_RE.test("i just want to end it")).toBe(true);
  });

  it('matches "self-harm" and variants', () => {
    expect(CRISIS_RE.test('struggling with self-harm')).toBe(true);
    expect(CRISIS_RE.test('self harm urges')).toBe(true);
    expect(CRISIS_RE.test('selfharm')).toBe(true);
  });

  it('matches "hurt myself"', () => {
    expect(CRISIS_RE.test("thinking about hurting myself... wait — hurt myself")).toBe(true);
  });

  it('matches "harming myself"', () => {
    expect(CRISIS_RE.test('i keep harming myself')).toBe(true);
  });

  it('matches TR "intihar"', () => {
    expect(CRISIS_RE.test('intihar etmek istiyorum')).toBe(true);
  });

  it('matches TR "kendimi öldürmek istiyorum" via detectCrisis (non-ASCII — not in CRISIS_RE)', () => {
    // "öldürmek" starts with ö — JS \b is ASCII-only, so it lives in the TR
    // unicode branch tested via detectCrisis, not directly via CRISIS_RE.
    expect(detectCrisis('kendimi öldürmek istiyorum').match).toBe(true);
  });

  it('matches TR "kendime zarar"', () => {
    expect(CRISIS_RE.test('kendime zarar vermek istiyorum')).toBe(true);
  });

  // ─── non-matching cases ───────────────────────────────────────────────────

  it('does NOT match "kill it on the dance floor"', () => {
    expect(CRISIS_RE.test('kill it on the dance floor')).toBe(false);
  });

  it('does NOT match "this code is so dead"', () => {
    expect(CRISIS_RE.test('this code is so dead')).toBe(false);
  });

  it('does NOT match "my computer is killing me"', () => {
    expect(CRISIS_RE.test('my computer is killing me')).toBe(false);
  });

  it('matches "i can\'t take it anymore"', () => {
    expect(CRISIS_RE.test("i can't take it anymore")).toBe(true);
  });

  it('matches "i want to die"', () => {
    expect(CRISIS_RE.test("i want to die")).toBe(true);
  });

  it('does NOT match empty string', () => {
    expect(CRISIS_RE.test('')).toBe(false);
  });
});

// ─── detectCrisis ─────────────────────────────────────────────────────────────

describe('detectCrisis', () => {
  it('returns match:true + first matching line for EN crisis text', () => {
    const result = detectCrisis('i want to die\ni want to kill myself');
    expect(result.match).toBe(true);
    // "i want to die" matches first (want\s+to\s+die)
    expect(result.line).toBe('i want to die');
  });

  it('returns match:true for TR crisis text', () => {
    const result = detectCrisis('kendimi öldürmek istiyorum');
    expect(result.match).toBe(true);
    expect(result.line).toBe('kendimi öldürmek istiyorum');
  });

  it('returns match:false + empty line for normal text', () => {
    const result = detectCrisis('had a rough day at work, everything is killing my vibe');
    expect(result.match).toBe(false);
    expect(result.line).toBe('');
  });

  it('returns match:false for empty string', () => {
    const result = detectCrisis('');
    expect(result.match).toBe(false);
    expect(result.line).toBe('');
  });

  it('returns match:false for non-string input (type guard)', () => {
    // @ts-expect-error intentional misuse to test runtime guard
    const result = detectCrisis(null);
    expect(result.match).toBe(false);
  });

  it('returns first matching line when multiple lines exist', () => {
    const result = detectCrisis('good morning\nsuicidal thoughts again\nbad day');
    expect(result.match).toBe(true);
    expect(result.line).toBe('suicidal thoughts again');
  });

  it('is case-insensitive', () => {
    expect(detectCrisis('KILL MYSELF').match).toBe(true);
    expect(detectCrisis('Suicidal').match).toBe(true);
  });
});
