import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: [
      // Subpath aliases must come before the bare-package alias.
      { find: '@ollie/logic/finance', replacement: path.resolve(__dirname, '../../packages/logic/src/finance/index.ts') },
      { find: '@ollie/logic/dissection', replacement: path.resolve(__dirname, '../../packages/logic/src/dissection/index.ts') },
      { find: '@ollie/logic/cycle', replacement: path.resolve(__dirname, '../../packages/logic/src/cycle/index.ts') },
      { find: '@ollie/logic/grocery', replacement: path.resolve(__dirname, '../../packages/logic/src/grocery/index.ts') },
      { find: '@ollie/logic/body', replacement: path.resolve(__dirname, '../../packages/logic/src/body/index.ts') },
      // Resolve workspace packages to their source so vitest can transform them.
      { find: '@ollie/store', replacement: path.resolve(__dirname, '../../packages/store/src/index.ts') },
      { find: '@ollie/logic', replacement: path.resolve(__dirname, '../../packages/logic/src/index.ts') },
      { find: '@ollie/events', replacement: path.resolve(__dirname, '../../packages/events/src/index.ts') },
      { find: '@ollie/orchestrator', replacement: path.resolve(__dirname, '../../packages/orchestrator/src/index.ts') },
      { find: '@ollie/research-stream', replacement: path.resolve(__dirname, '../../packages/research-stream/src/index.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
  },
});
