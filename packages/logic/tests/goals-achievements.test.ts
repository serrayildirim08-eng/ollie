/**
 * @ollie/logic · goals · achievement gallery tests (Phase 3 · feature 4)
 */

import { describe, it, expect } from 'vitest';
import {
  buildAchievementGallery,
  isAchievedGoal,
  type Goal,
} from '../src/goals';

const DAY = 86_400_000;
const NOW = new Date('2026-05-15T12:00:00Z').getTime();

function goal(partial: Partial<Goal> & { id: string }): Goal {
  return { ...partial };
}

describe('isAchievedGoal', () => {
  it('true for status done / completed', () => {
    expect(isAchievedGoal(goal({ id: 'a', status: 'done' }))).toBe(true);
    expect(isAchievedGoal(goal({ id: 'b', status: 'completed' }))).toBe(true);
  });

  it('false for active / paused / graveyard / dropped / missing', () => {
    expect(isAchievedGoal(goal({ id: 'c', status: 'active' }))).toBe(false);
    expect(isAchievedGoal(goal({ id: 'd', status: 'paused' }))).toBe(false);
    expect(isAchievedGoal(goal({ id: 'e', status: 'graveyard' }))).toBe(false);
    expect(isAchievedGoal(goal({ id: 'f', status: 'dropped' }))).toBe(false);
    expect(isAchievedGoal(goal({ id: 'g' }))).toBe(false);
  });

  it('false for null / undefined / non-object', () => {
    expect(isAchievedGoal(null)).toBe(false);
    expect(isAchievedGoal(undefined)).toBe(false);
  });
});

describe('buildAchievementGallery', () => {
  it('empty / null goals → empty gallery', () => {
    const g = buildAchievementGallery([]);
    expect(g.items).toEqual([]);
    expect(g.total).toBe(0);
    expect(g.by_category).toEqual({});
    expect(buildAchievementGallery(null).total).toBe(0);
    expect(buildAchievementGallery(undefined).total).toBe(0);
  });

  it('only done / completed goals appear; graveyard excluded', () => {
    const goals: Goal[] = [
      goal({ id: '1', title: 'shipped beta', status: 'done', status_at: NOW }),
      goal({ id: '2', title: 'active work', status: 'active' }),
      goal({ id: '3', title: 'buried idea', status: 'graveyard', status_at: NOW }),
      goal({ id: '4', title: 'finished course', status: 'completed', status_at: NOW }),
    ];
    const gallery = buildAchievementGallery(goals);
    expect(gallery.total).toBe(2);
    expect(gallery.items.map((i) => i.id).sort()).toEqual(['1', '4']);
  });

  it('resolves title from label → title → id', () => {
    const goals: Goal[] = [
      goal({ id: 'x', label: 'lbl', title: 'ttl', status: 'done' }),
      goal({ id: 'y', title: 'ttl-only', status: 'done' }),
      goal({ id: 'z', status: 'done' }),
    ];
    const items = buildAchievementGallery(goals).items;
    const byId = new Map(items.map((i) => [i.id, i.title]));
    expect(byId.get('x')).toBe('lbl');
    expect(byId.get('y')).toBe('ttl-only');
    expect(byId.get('z')).toBe('z');
  });

  it('computes days_to_complete from created_at → completed_at', () => {
    const goals: Goal[] = [
      goal({
        id: '1',
        status: 'done',
        created_at: NOW - 10 * DAY,
        status_at: NOW,
      }),
    ];
    const item = buildAchievementGallery(goals).items[0];
    expect(item.days_to_complete).toBe(10);
    expect(item.completed_at).toBe(NOW);
    expect(item.created_at).toBe(NOW - 10 * DAY);
  });

  it('days_to_complete undefined when created_at missing', () => {
    const goals: Goal[] = [goal({ id: '1', status: 'done', status_at: NOW })];
    expect(buildAchievementGallery(goals).items[0].days_to_complete).toBeUndefined();
  });

  it('completion ts falls back to last_activity_at then created_at', () => {
    const fallbackActivity = buildAchievementGallery([
      goal({ id: '1', status: 'done', last_activity_at: NOW - DAY }),
    ]).items[0];
    expect(fallbackActivity.completed_at).toBe(NOW - DAY);

    const fallbackCreated = buildAchievementGallery([
      goal({ id: '2', status: 'done', created_at: NOW - 2 * DAY }),
    ]).items[0];
    expect(fallbackCreated.completed_at).toBe(NOW - 2 * DAY);
  });

  it('default sort is most-recent-completion first', () => {
    const goals: Goal[] = [
      goal({ id: 'old', status: 'done', status_at: NOW - 5 * DAY }),
      goal({ id: 'new', status: 'done', status_at: NOW }),
      goal({ id: 'mid', status: 'done', status_at: NOW - 2 * DAY }),
    ];
    expect(buildAchievementGallery(goals).items.map((i) => i.id)).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  it('oldest sort reverses the order', () => {
    const goals: Goal[] = [
      goal({ id: 'new', status: 'done', status_at: NOW }),
      goal({ id: 'old', status: 'done', status_at: NOW - 5 * DAY }),
    ];
    const items = buildAchievementGallery(goals, { sort: 'oldest' }).items;
    expect(items.map((i) => i.id)).toEqual(['old', 'new']);
  });

  it('category sort groups alphabetically, recent within group', () => {
    const goals: Goal[] = [
      goal({ id: 'h2', status: 'done', category: 'health', status_at: NOW - DAY }),
      goal({ id: 'c1', status: 'done', category: 'career', status_at: NOW }),
      goal({ id: 'h1', status: 'done', category: 'health', status_at: NOW }),
    ];
    const items = buildAchievementGallery(goals, { sort: 'category' }).items;
    expect(items.map((i) => i.id)).toEqual(['c1', 'h1', 'h2']);
  });

  it('category filter restricts to one bucket', () => {
    const goals: Goal[] = [
      goal({ id: '1', status: 'done', category: 'career' }),
      goal({ id: '2', status: 'done', category: 'health' }),
    ];
    const g = buildAchievementGallery(goals, { category: 'career' });
    expect(g.total).toBe(1);
    expect(g.items[0].id).toBe('1');
  });

  it('since filter drops goals completed before the cutoff', () => {
    const goals: Goal[] = [
      goal({ id: 'recent', status: 'done', status_at: NOW }),
      goal({ id: 'stale', status: 'done', status_at: NOW - 100 * DAY }),
    ];
    const g = buildAchievementGallery(goals, { since: NOW - 30 * DAY });
    expect(g.total).toBe(1);
    expect(g.items[0].id).toBe('recent');
  });

  it('by_category counts only categorized achievements', () => {
    const goals: Goal[] = [
      goal({ id: '1', status: 'done', category: 'career' }),
      goal({ id: '2', status: 'done', category: 'career' }),
      goal({ id: '3', status: 'done', category: 'health' }),
      goal({ id: '4', status: 'done' }), // uncategorized
    ];
    const g = buildAchievementGallery(goals);
    expect(g.total).toBe(4);
    expect(g.by_category).toEqual({ career: 2, health: 1 });
  });
});
