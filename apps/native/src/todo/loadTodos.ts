/**
 * loadTodos — read every module's open rows and merge them into one TodoItem
 * stream (via the pure aggregateTodos). Extracted so the Today's-Few pulse can
 * reuse the exact same reads the TodoScreen does, without duplicating the
 * six-repo fan-out. Migrations are idempotent + lazy-singleton, so calling this
 * from more than one surface is cheap.
 */

import {
  migrateAdmin,
  recurringDecisions as adminDecisionsRepo,
  renewals as adminRenewalsRepo,
  tasks as adminTasksRepo,
} from '../modules/admin';
import {
  migrateFinance,
  pending as financePendingRepo,
} from '../modules/finance';
import {
  migrateGrocery,
  shopping as groceryShoppingRepo,
} from '../modules/grocery';
import { migrateWork, tasks as workTasksRepo } from '../modules/work';
import { aggregateTodos, isoToday, type TodoItem } from './aggregateTodos';

export async function loadTodayTodos(
  now: number = Date.now(),
  today: string = isoToday(),
): Promise<TodoItem[]> {
  await Promise.all([migrateAdmin(), migrateFinance(), migrateWork(), migrateGrocery()]);
  const [adminTasks, adminRenewals, adminDecisions, workTasks, groceryShopping, finPending] =
    await Promise.all([
      adminTasksRepo.listOpen(),
      adminRenewalsRepo.listOpen(today),
      adminDecisionsRepo.listOpen(now),
      workTasksRepo.listOpen(today),
      groceryShoppingRepo.listOpen(),
      financePendingRepo.listOpen(now),
    ]);
  return aggregateTodos({
    admin: { tasks: adminTasks, renewals: adminRenewals, decisions: adminDecisions },
    work: { tasks: workTasks },
    grocery: { shopping: groceryShopping },
    finance: { pendingDecisions: finPending },
  });
}
