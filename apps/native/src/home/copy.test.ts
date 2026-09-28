import { describe, expect, it } from 'vitest';
import { buildReply, greeting, hello, whenPhrase } from './copy';

// Mon 2026-09-28 13:00 local
const NOW = new Date(2026, 8, 28, 13, 0).getTime();
const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m).getTime();

describe('greeting', () => {
  it('names the part of day, the person and today count', () => {
    expect(greeting(new Date(NOW), 'Serra', 2)).toBe('Good afternoon, Serra. Two things left today.');
    expect(greeting(new Date(2026, 8, 28, 8), 'Serra', 1)).toBe('Good morning, Serra. One thing left today.');
    expect(greeting(new Date(2026, 8, 28, 19), null, 0)).toBe('Evening. Nothing left for today.');
    expect(greeting(new Date(2026, 8, 28, 23), 'Serra', 12)).toBe('Hi, Serra. 12 things left today.');
  });
});

describe('hello', () => {
  it('is the salutation alone', () => {
    expect(hello(new Date(NOW), 'Serra')).toBe('Good afternoon, Serra.');
    expect(hello(new Date(NOW), '')).toBe('Good afternoon.');
  });
});

describe('whenPhrase', () => {
  it('is relative when soon, clock time otherwise', () => {
    expect(whenPhrase(NOW + 2 * 60_000, NOW)).toBe('in 2 minutes');
    expect(whenPhrase(at(28, 18), NOW)).toBe('at 18:00');
    expect(whenPhrase(at(29, 9), NOW)).toBe('tomorrow at 09:00');
    expect(whenPhrase(at(30, 14, 30), NOW)).toBe('on Wednesday at 14:30');
    expect(whenPhrase(new Date(2026, 9, 13, 10).getTime(), NOW)).toBe('on 13 Oct at 10:00');
  });
});

describe('buildReply', () => {
  const base = { reminders: [], receipt: null, askedWhen: false, needsConfirm: 0 };

  it('states the exact reminder time', () => {
    expect(buildReply({ ...base, reminders: [at(28, 18)], receipt: 'Saved to To-do.' }, NOW)).toBe(
      "Got it — I'll remind you at 18:00.",
    );
  });

  it('lists several reminders in time order', () => {
    expect(buildReply({ ...base, reminders: [at(29, 9), at(28, 18)] }, NOW)).toBe(
      'Got it — 2 reminders: at 18:00, tomorrow at 09:00.',
    );
  });

  it('asks when for a time-less reminder', () => {
    expect(buildReply({ ...base, askedWhen: true, receipt: 'Saved to To-do.' }, NOW)).toBe(
      'Saved. When should I remind you?',
    );
  });

  it('falls back to the receipt, then to Noted', () => {
    expect(buildReply({ ...base, receipt: 'Saved to Groceries.' }, NOW)).toBe('Saved to Groceries.');
    expect(buildReply(base, NOW)).toBe('Noted.');
  });

  it('flags parts waiting on a confirm card', () => {
    expect(buildReply({ ...base, receipt: 'Saved to Money.', needsConfirm: 1 }, NOW)).toBe(
      "Saved to Money. I wasn't sure about one part — check below.",
    );
  });
});
