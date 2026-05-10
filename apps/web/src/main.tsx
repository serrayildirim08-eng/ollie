import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './design/tokens.css';
import './design/animations.css';
import './design/breakpoints.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
