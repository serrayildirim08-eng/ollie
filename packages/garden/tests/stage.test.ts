import { describe, it, expect } from 'vitest';
import { getStage } from '../src/stage.js';

describe('getStage', () => {
  it('0 → seedling', () => expect(getStage(0)).toBe('seedling'));
  it('6 → seedling', () => expect(getStage(6)).toBe('seedling'));
  it('7 → sapling',  () => expect(getStage(7)).toBe('sapling'));
  it('29 → sapling', () => expect(getStage(29)).toBe('sapling'));
  it('30 → young',   () => expect(getStage(30)).toBe('young'));
  it('89 → young',   () => expect(getStage(89)).toBe('young'));
  it('90 → mature',  () => expect(getStage(90)).toBe('mature'));
  it('364 → mature', () => expect(getStage(364)).toBe('mature'));
  it('365 → ancient', () => expect(getStage(365)).toBe('ancient'));
  it('1000 → ancient', () => expect(getStage(1000)).toBe('ancient'));
});
