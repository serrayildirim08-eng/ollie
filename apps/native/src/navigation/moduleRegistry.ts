/**
 * Module registry — attaches Box components to the lightweight metadata in
 * moduleManifest.ts (audit #178). The Router imports THIS (it renders the
 * components anyway); useDeepLinks / any id-only consumer imports
 * moduleManifest.ts instead, so it does not eagerly load every Box → repo →
 * storage adapter at module load (that broke test collection: audit #16/#131).
 *
 * Adding a module = one entry in moduleManifest.ts + one line in COMPONENTS here.
 */
import type { ComponentType } from 'react';
import { GroceryBox } from '../modules/grocery';
import { PetsBox } from '../modules/pets';
import { BodyBox } from '../modules/body';
import { MoodBox } from '../modules/mood';
import { WorkBox } from '../modules/work';
import { FinanceBox } from '../modules/finance';
import { SleepBox } from '../modules/sleep';
import { AdminBox } from '../modules/admin';
import { HabitsBox } from '../modules/habits';
import { GoalsBox } from '../modules/goals';
import { MedicationBox } from '../modules/medication';
import { CycleBox } from '../modules/cycle';
import { PartnerBox } from '../modules/partner';
import { MODULE_META, type ModuleMeta } from './moduleManifest';

// Re-export the lightweight metadata so existing Router imports keep working.
export { MODULE_IDS, MODULE_GROUP_META, type ModuleGroupId } from './moduleManifest';

const COMPONENTS: Record<string, ComponentType> = {
  body: BodyBox,
  mood: MoodBox,
  sleep: SleepBox,
  cycle: CycleBox,
  medication: MedicationBox,
  habits: HabitsBox,
  goals: GoalsBox,
  partner: PartnerBox,
  grocery: GroceryBox,
  pets: PetsBox,
  work: WorkBox,
  admin: AdminBox,
  finance: FinanceBox,
};

export interface ModuleManifestEntry extends ModuleMeta {
  /** Box screen component mounted at `/box/<id>`. */
  Component: ComponentType;
}

export const MODULE_MANIFEST: ModuleManifestEntry[] = MODULE_META.map((m) => ({
  ...m,
  Component: COMPONENTS[m.id],
}));
