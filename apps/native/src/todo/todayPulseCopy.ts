/**
 * todayPulse — one calm orientation line for the home screen (report §C #5).
 *
 * NOT a planner. Just a single sentence that answers "what's today like?" at a
 * glance, built from two signals the app already has: how many things are due
 * today, and the capacity read (how you are). Deliberately no exact numbers as
 * pressure ("a few" not "7"), no shame, no urgency.
 *
 * Pure + tested. The TodayPulse component feeds it the count + capacity.
 */

export type Capacity = 'low' | 'medium' | 'high' | null;

export function buildTodayPulse(input: {
  taskCount: number;
  capacity: Capacity;
}): string {
  const { taskCount, capacity } = input;
  const soft = capacity === 'low';

  if (taskCount <= 0) {
    return soft ? 'a soft day. nothing needs you yet.' : "today's clear. nothing needs you yet.";
  }
  if (taskCount === 1) {
    return soft ? 'one thing for today. no rush.' : 'one thing for today.';
  }
  if (taskCount <= 3) {
    return soft ? 'a few things for today. keep it gentle.' : 'a few things for today.';
  }
  return soft ? 'a fuller day. just take the top one.' : 'a fuller day today. one at a time.';
}
