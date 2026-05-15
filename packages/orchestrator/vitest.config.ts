import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // tests/_pending holds spec files for the goals/work notification-cue
    // feature that is not yet implemented (see tests/_pending/README.md).
    // They are excluded from CI until the implementation lands.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/_pending/**'],
  },
});
