/**
 * money-v2 · public entry
 *
 * The clean-slate v2 money module — a real, runnable parallel build
 * mounted behind the dev-only `/preview/money` route. It reuses the live
 * `finance.*` store + `@ollie/logic/finance` pure fns; it does NOT touch
 * the live `modules/finance` module or the app's main navigation.
 */
export { MoneyApp } from './MoneyApp';
export type { MoneyAppProps, MoneyRoute } from './MoneyApp';
export * from './v2';
