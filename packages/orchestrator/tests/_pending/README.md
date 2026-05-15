# Pending tests — goals/work notification-cue feature

These three spec files were committed in `7038ef0` (body-audit task 2
follow-up) on the `sprint-b-prime-consent-pipeline` branch **without their
implementation**. They reference exports and methods that do not exist in
`src/goals.ts` / `src/work.ts`:

- `GOALS_NOTIFICATION_COPY`, `VELOCITY_GAP_THRESHOLD` (`src/goals.ts`)
- `WORK_NOTIFICATION_COPY` (`src/work.ts`)
- a `scheduleNotification` option on `createGoalsOrchestrator` /
  `createWorkOrchestrator`
- an `orch.scanCues()` method on both orchestrators

The feature these describe — goal/work notification cues (#8 weekly
check-in, #9 deadline-30d, #10 paused-14d, work four-blocks alert) and the
`goals:convert_to_habit` cross-dispatch — has **not been built**.

They are quarantined here (excluded from `tsc` via `tsconfig.json` and from
`vitest` via `vitest.config.ts`) so the consolidated branch is CI-green.

**To re-enable:** implement the cue subsystem in `src/goals.ts` /
`src/work.ts`, then `git mv` these files back to `tests/`.
