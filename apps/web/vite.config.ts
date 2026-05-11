import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
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
