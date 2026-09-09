import { describe, it, expect } from 'vitest';
import { serializeExport, exportFilename } from './exportData';

describe('serializeExport', () => {
  it('wraps tables in the ollie export envelope', () => {
    const json = serializeExport(
      { grocery_pantry: [{ id: '1', name: 'milk' }] },
      '2026-07-02T10:00:00.000Z',
    );
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({
      app: 'ollie',
      schemaVersion: 1,
      exportedAt: '2026-07-02T10:00:00.000Z',
      tables: { grocery_pantry: [{ id: '1', name: 'milk' }] },
    });
  });

  it('handles an empty database', () => {
    const parsed = JSON.parse(serializeExport({}, '2026-07-02T10:00:00.000Z'));
    expect(parsed.tables).toEqual({});
    expect(parsed.app).toBe('ollie');
  });
});

describe('exportFilename', () => {
  it('is date-stamped', () => {
    expect(exportFilename(new Date('2026-07-02T23:59:00.000Z'))).toBe(
      'ollie-export-2026-07-02.json',
    );
  });
});
