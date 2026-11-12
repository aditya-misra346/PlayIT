/// <reference types="vite/client" />
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Register installable PWA service worker in production / supported contexts
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
