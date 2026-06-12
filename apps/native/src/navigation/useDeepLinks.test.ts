import { describe, it, expect } from 'vitest';
import { resolveDeepLink } from './useDeepLinks';

describe('resolveDeepLink', () => {
  it('ollie://dump → / with focus', () => {
    expect(resolveDeepLink('ollie://dump')).toEqual({ path: '/', focusDump: true });
  });
  it('ollie://todo → /todo', () => {
    expect(resolveDeepLink('ollie://todo')).toEqual({ path: '/todo' });
  });
  it('ollie://box/grocery → /box/grocery', () => {
    expect(resolveDeepLink('ollie://box/grocery')).toEqual({ path: '/box/grocery' });
  });
  it('ollie://box/work → /box/work', () => {
    expect(resolveDeepLink('ollie://box/work')).toEqual({ path: '/box/work' });
  });
  it('rejects wrong scheme', () => {
    expect(resolveDeepLink('https://example.com/box/grocery')).toBeNull();
  });
  it('rejects unknown host', () => {
    expect(resolveDeepLink('ollie://nope')).toBeNull();
  });
  it('rejects box without id', () => {
    expect(resolveDeepLink('ollie://box')).toBeNull();
  });
  it('rejects garbage', () => {
    expect(resolveDeepLink('not a url')).toBeNull();
  });
});
