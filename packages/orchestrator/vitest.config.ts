import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Coverage gate (audit #8). Thresholds are set a few points UNDER
    // the measured floor (2026-05-19: 82.9% stmts / 60.1% branch /
    // 95.5% funcs / 82.9% lines) so a genuine regression fails CI while
    // normal churn does not flake. Ratchet these up as coverage grows;
    // never lower them. `pnpm test:coverage` runs the v8 provider in CI.
    coverage: {
      provider: 'v8',
      thresholds: {
        statements: 78,
        branches: 55,
        functions: 90,
        lines: 78,
      },
    },
  },
});
