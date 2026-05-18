/**
 * @ollie/logic · work · matter — Phase 1 container tests.
 */

import { describe, it, expect } from 'vitest';
import {
  createMatter,
  normalizeAliases,
  matterKeys,
  attachDumpRef,
  detachDumpRef,
  matterDumpCount,
  isMatter,
} from '../src/work/matter';
import type { Matter, MatterDumpRef } from '../src/work/matter';

const T0 = new Date('2026-05-18T09:00:00Z').getTime();

function ref(id: string, origin: MatterDumpRef['origin'] = 'clear'): MatterDumpRef {
  return { dump_id: id, source_slice: 'dump', origin, routed_at: T0 };
}

describe('createMatter', () => {
  it('builds a fully-formed matter with defaults', () => {
    const m = createMatter({ id: 'm1', name: 'Yılmaz E-2', created_at: T0 });
    expect(m).toEqual<Matter>({
      id: 'm1',
      name: 'Yılmaz E-2',
      aliases: [],
      type: '',
      status: 'active',
      created_at: T0,
      dumps: [],
    });
  });

  it('trims the name and normalises aliases', () => {
    const m = createMatter({
      id: 'm1',
      name: '  Acme Corp  ',
      aliases: [' Acme ', 'ACME', 'acme', 'the acme thing'],
      created_at: T0,
    });
    expect(m.name).toBe('Acme Corp');
    expect(m.aliases).toEqual(['acme', 'the acme thing']);
  });

  it('drops an alias equal to the matter name', () => {
    const m = createMatter({
      id: 'm1',
      name: 'Yılmaz',
      aliases: ['yılmaz', 'yilmaz dosyası'],
      created_at: T0,
    });
    expect(m.aliases).toEqual(['yilmaz dosyası']);
  });

  it('respects an explicit type and status', () => {
    const m = createMatter({
      id: 'm1',
      name: 'X',
      type: 'E-2 case',
      status: 'archived',
      created_at: T0,
    });
    expect(m.type).toBe('E-2 case');
    expect(m.status).toBe('archived');
  });
});

describe('normalizeAliases', () => {
  it('lower-cases, trims, de-dupes and drops blanks', () => {
    expect(normalizeAliases(['  A ', 'a', 'B', '', '   '])).toEqual(['a', 'b']);
  });
  it('excludes the name key', () => {
    expect(normalizeAliases(['Foo', 'Bar'], 'foo')).toEqual(['bar']);
  });
  it('tolerates non-string entries', () => {
    expect(normalizeAliases(['ok', 123 as unknown as string])).toEqual(['ok']);
  });
});

describe('matterKeys', () => {
  it('returns name + aliases lower-cased and de-duped', () => {
    const m = createMatter({
      id: 'm1',
      name: 'Yılmaz E-2',
      aliases: ['yılmaz dosyası'],
      created_at: T0,
    });
    expect(matterKeys(m).sort()).toEqual(['yılmaz dosyası', 'yılmaz e-2'].sort());
  });
});

describe('attachDumpRef / detachDumpRef', () => {
  it('appends a ref immutably', () => {
    const m = createMatter({ id: 'm1', name: 'X', created_at: T0 });
    const m2 = attachDumpRef(m, ref('d1'));
    expect(m.dumps).toHaveLength(0);
    expect(m2.dumps).toHaveLength(1);
    expect(m2).not.toBe(m);
  });

  it('is idempotent on dump_id', () => {
    const m = attachDumpRef(createMatter({ id: 'm1', name: 'X', created_at: T0 }), ref('d1'));
    const m2 = attachDumpRef(m, ref('d1', 'guess'));
    expect(m2).toBe(m);
    expect(m2.dumps).toHaveLength(1);
  });

  it('detaches a ref immutably', () => {
    let m = createMatter({ id: 'm1', name: 'X', created_at: T0 });
    m = attachDumpRef(m, ref('d1'));
    m = attachDumpRef(m, ref('d2'));
    const m2 = detachDumpRef(m, 'd1');
    expect(m2.dumps.map((d) => d.dump_id)).toEqual(['d2']);
    expect(m).not.toBe(m2);
  });

  it('detach is a no-op for an absent id', () => {
    const m = attachDumpRef(createMatter({ id: 'm1', name: 'X', created_at: T0 }), ref('d1'));
    expect(detachDumpRef(m, 'nope')).toBe(m);
  });

  it('matterDumpCount counts refs', () => {
    let m = createMatter({ id: 'm1', name: 'X', created_at: T0 });
    expect(matterDumpCount(m)).toBe(0);
    m = attachDumpRef(m, ref('d1'));
    expect(matterDumpCount(m)).toBe(1);
  });
});

describe('isMatter', () => {
  it('accepts a well-formed matter', () => {
    expect(isMatter(createMatter({ id: 'm1', name: 'X', created_at: T0 }))).toBe(true);
  });
  it('rejects junk', () => {
    expect(isMatter(null)).toBe(false);
    expect(isMatter({})).toBe(false);
    expect(isMatter({ id: 'm1', name: 'X' })).toBe(false);
    expect(isMatter({ id: 'm1', name: 'X', aliases: [], type: '', status: 'weird', created_at: T0, dumps: [] })).toBe(false);
  });
});
