import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to their source so vitest can transform them.
      '@ollie/store': path.resolve(__dirname, '../../packages/store/src/index.ts'),
      '@ollie/logic': path.resolve(__dirname, '../../packages/logic/src/index.ts'),
      '@ollie/events': path.resolve(__dirname, '../../packages/events/src/index.ts'),
      '@ollie/orchestrator': path.resolve(__dirname, '../../packages/orchestrator/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
  },
});
