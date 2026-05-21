import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // dedupe + optimizeDeps — Sentry SF-115x (`dispatcher.useEffect` null in
  // dev chunk-6HVYKXQA.js) is the classic "more than one copy of React"
  // symptom. pnpm + the workspace's React-touching packages (zustand v4
  // AND v5 in the store, Clerk, Sentry, @react-three/*) all peer-depend
  // on React and Vite's dep optimizer occasionally bundles a second
  // prebundle of react.development.js for late-discovered deps. Pinning
  // dedupe + including react/react-dom in optimizeDeps forces a single
  // prebundle from app boot, so every importer resolves to the same
  // ReactCurrentDispatcher.current.
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          // Vendor: React runtime
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react/jsx-runtime')
          ) {
            return 'vendor-react';
          }
          // Vendor: astronomy-engine (large WASM-free pure-JS lib)
          if (id.includes('node_modules/astronomy-engine')) {
            return 'vendor-astronomy';
          }
          // Vendor: howler (audio)
          if (id.includes('node_modules/howler')) {
            return 'vendor-howler';
          }
          // Vendor: three.js + r3f + drei (loaded only on /garden)
          if (
            id.includes('node_modules/three/') ||
            id.includes('node_modules/three-stdlib/') ||
            id.includes('node_modules/@react-three/')
          ) {
            return 'vendor-three';
          }
          // Vendor: @ollie/* monorepo packages
          if (
            id.includes('packages/logic') ||
            id.includes('packages/store') ||
            id.includes('packages/events') ||
            id.includes('packages/orchestrator') ||
            id.includes('packages/router') ||
            id.includes('@ollie/')
          ) {
            return 'vendor-ollie';
          }
          return undefined;
        },
      },
    },
  },
});
