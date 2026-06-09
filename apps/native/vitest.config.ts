import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // forks pool gives each test file a clean module registry — avoids
    // vi.mock hoisting collisions when multiple files mock the same module.
    pool: 'forks',
  },
});
