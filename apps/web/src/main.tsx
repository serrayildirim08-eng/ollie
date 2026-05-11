import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bootNotificationLayer } from './lib/push-register';
import { installSavingsDigestLoop } from './lib/savings-digest';
import './design/tokens.css';
import './design/animations.css';
import './design/breakpoints.css';

// Boot notifications layer (NL1-NL3). Async — install runs in
// parallel with first render; calls before backend is ready fall
// through to the noop path and are still logged + budget-checked.
void bootNotificationLayer().then(() => {
  installSavingsDigestLoop();
});

// Service worker — caches /videos/* /audio/* /fonts/* for offline + first-paint speed.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[ollie] sw registration failed:', err);
    });
  });
}

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
