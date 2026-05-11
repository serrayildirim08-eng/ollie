/**
 * apps/web · store singleton + bound React hook
 *
 * The @ollie/store package exposes a `createStore(adapter)` factory and a
 * generic React hook that takes a store argument. This file builds the
 * app's single store + cross-tab sync + a project-local hook bound to it.
 *
 * Components import `useStoreSlice` from this file, NOT from @ollie/store
 * directly, so that swapping the underlying store (e.g., for tests or a
 * future remote-sync adapter) is a one-file change.
 *
 * Astrology orchestrator (bottom of file):
 *   - Listens for changes to astrology.birth; recomputes astrology.chart.
 *   - Runs a daily tick to refresh astrology.currentTransits.
 */

import {
  browserAdapter,
  createStore,
  installCrossTabSync,
  runMigrations,
} from '@ollie/store';
import { useStoreSlice as baseUseStoreSlice } from '@ollie/store/react';
import { computeNatalChart, currentTransits } from '@ollie/logic/astrology';
import type { BirthData } from '@ollie/logic/astrology';
import { astronomyAPI } from './lib/astronomy';
import { createOrchestrator } from '@ollie/orchestrator';

runMigrations(browserAdapter);

export const store = createStore(browserAdapter);
installCrossTabSync(store, browserAdapter);

export function useStoreSlice<T>(
  mod: string,
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  return baseUseStoreSlice<T>(store, mod, key, defaultValue);
}

// ─── Astrology orchestrator ───────────────────────────────────────────────────

function recomputeChart(birth: BirthData | null | undefined): void {
  if (!birth?.date) {
    store.set('astrology', 'chart', null);
    return;
  }
  try {
    const chart = computeNatalChart(birth, astronomyAPI);
    store.set('astrology', 'chart', chart);
  } catch (err) {
    console.warn('[astrology orchestrator] computeNatalChart failed:', err);
    store.set('astrology', 'chart', null);
  }
}

function recomputeTransits(): void {
  try {
    const snapshot = currentTransits(new Date(), astronomyAPI);
    store.set('astrology', 'currentTransits', snapshot);
  } catch (err) {
    console.warn('[astrology orchestrator] currentTransits failed:', err);
  }
}

// Run once on load with whatever birth data is already stored.
recomputeChart(store.get<BirthData | null>('astrology', 'birth', null));
recomputeTransits();

// Subscribe to birth changes.
store.subscribeKey<BirthData | null>('astrology', 'birth', recomputeChart);

// Daily transit tick (every 24 h); also refresh chart in case DST shifted anything.
const TRANSIT_INTERVAL_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  recomputeTransits();
  recomputeChart(store.get<BirthData | null>('astrology', 'birth', null));
}, TRANSIT_INTERVAL_MS);

// ─── Root orchestrator boot ───────────────────────────────────────────────────
// Starts cycle, pets, body, grocery, sleep, finance, patterns.
// Astrology runs via the inline orchestrator above; createOrchestrator does not
// duplicate it. habits / work / goals / admin / dump are UI-only (no sub-orchestrator files).
createOrchestrator(store).init();

import { createReminderScheduler } from '@ollie/router';
import * as appEvents from '@ollie/events';
createReminderScheduler(store, appEvents).init();
