import { defineConfig } from 'vitest/config';
import path from 'path';

// Workspace packages are resolved to their TS source so vitest can transform
// them. The bare-package aliases use exact-match regexes (/^@ollie\/x$/) so
// that subpath imports (e.g. @ollie/logic/pets, @ollie/store/react) fall
// through to each package's own `exports` map instead of being swallowed by a
// greedy prefix alias.
const pkg = (name: string, rel: string) => ({
  find: new RegExp(`^${name}$`),
  replacement: path.resolve(__dirname, rel),
});

export default defineConfig({
  resolve: {
    alias: [
      pkg('@ollie/store', '../../packages/store/src/index.ts'),
      pkg('@ollie/logic', '../../packages/logic/src/index.ts'),
      pkg('@ollie/events', '../../packages/events/src/index.ts'),
      pkg('@ollie/orchestrator', '../../packages/orchestrator/src/index.ts'),
      pkg('@ollie/research-stream', '../../packages/research-stream/src/index.ts'),
    ],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
