import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './design/tokens.css';
import './design/animations.css';
import './design/breakpoints.css';

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
