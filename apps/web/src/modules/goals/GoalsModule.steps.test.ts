/**
 * GoalsModule · step-completion key stability (audit-fix #11)
 *
 * The bug: step completion was tracked in a parallel `boolean[]` keyed by
 * ARRAY POSITION (`steps_done[i]`), and the list rendered with `key={i}`.
 * Deleting or reordering a step then mis-marked a DIFFERENT step as done.
 *
 * The fix: completion is keyed by step TEXT (a stable key). These tests
 * exercise the two pure helpers the component now uses — `isStepDone`
 * (read) and `toggleStepDone` (write, incl. legacy-shape migration).
 */

import { describe, it, expect } from 'vitest';
import { isStepDone, toggleStepDone } from './GoalsModule';

describe('toggleStepDone', () => {
  it('toggles a step on, keyed by text', () => {
    const next = toggleStepDone({}, ['a', 'b', 'c'], 'b');
    expect(next).toEqual({ b: true });
  });

  it('toggles a step back off', () => {
    const next = toggleStepDone({ b: true }, ['a', 'b', 'c'], 'b');
    expect(next).toEqual({ b: false });
  });

  it('does not mutate the input record', () => {
    const input = { a: true };
    const next = toggleStepDone(input, ['a', 'b'], 'b');
    expect(input).toEqual({ a: true });
    expect(next).not.toBe(input);
  });

  it('migrates a legacy boolean[] to a text-keyed record', () => {
    // legacy: steps ['a','b','c'], position 0 + 2 done
    const next = toggleStepDone([true, false, true], ['a', 'b', 'c'], 'b');
    // a + c stay done (now keyed by text), b toggled on
    expect(next).toEqual({ a: true, c: true, b: true });
  });
});

describe('isStepDone — read tolerates both shapes', () => {
  it('reads the record shape by text', () => {
    expect(isStepDone({ b: true }, 'b', 1)).toBe(true);
    expect(isStepDone({ b: true }, 'a', 0)).toBe(false);
  });

  it('reads the legacy array shape by index', () => {
    expect(isStepDone([false, true], 'b', 1)).toBe(true);
    expect(isStepDone([false, true], 'a', 0)).toBe(false);
  });

  it('treats undefined as nothing-done', () => {
    expect(isStepDone(undefined, 'a', 0)).toBe(false);
  });
});

describe('regression: deleting a step does NOT mis-mark another', () => {
  it('the WRONG step would be marked under the old index scheme', () => {
    // Steps: ['buy paint', 'tape edges', 'apply coat']. User marks the
    // LAST step ('apply coat') done.
    const steps = ['buy paint', 'tape edges', 'apply coat'];
    const done = toggleStepDone({}, steps, 'apply coat');
    expect(done).toEqual({ 'apply coat': true });

    // Now the user deletes the FIRST step. New step list:
    const afterDelete = ['tape edges', 'apply coat'];

    // Old behavior: done[2] -> shifts; index 2 no longer exists, and
    // index 1 ('apply coat') would read done[1] === undefined => the
    // checkmark would VANISH off the correct step. Worse, had a 4th step
    // existed, a different step would have inherited the checkmark.
    // New behavior: completion is keyed by TEXT, so the checkmark stays
    // on 'apply coat' exactly.
    expect(isStepDone(done, afterDelete[0], 0)).toBe(false); // 'tape edges'
    expect(isStepDone(done, afterDelete[1], 1)).toBe(true); // 'apply coat'
  });

  it('reordering steps keeps completion on the right step', () => {
    const steps = ['draft outline', 'write intro', 'edit pass'];
    let done = toggleStepDone({}, steps, 'write intro');
    done = toggleStepDone(done, steps, 'edit pass');

    // Reorder: move 'edit pass' to the front.
    const reordered = ['edit pass', 'draft outline', 'write intro'];
    expect(isStepDone(done, reordered[0], 0)).toBe(true); // 'edit pass'
    expect(isStepDone(done, reordered[1], 1)).toBe(false); // 'draft outline'
    expect(isStepDone(done, reordered[2], 2)).toBe(true); // 'write intro'
  });

  it('legacy array survives a delete after migration', () => {
    // A goal persisted under the OLD shape: 3 steps, middle one done.
    const steps = ['one', 'two', 'three'];
    const legacy = [false, true, false];

    // User toggles 'three' — this migrates the whole record.
    const migrated = toggleStepDone(legacy, steps, 'three');
    expect(migrated).toEqual({ two: true, three: true });

    // User deletes 'one'.
    const afterDelete = ['two', 'three'];
    expect(isStepDone(migrated, afterDelete[0], 0)).toBe(true); // 'two'
    expect(isStepDone(migrated, afterDelete[1], 1)).toBe(true); // 'three'
  });
});
