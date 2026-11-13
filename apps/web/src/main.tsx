import React from 'react';
import { createRoot } from 'react-dom/client';
import ProjectWindows from './ProjectWindows';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><ProjectWindows /></React.StrictMode>);
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Installation remains optional when service workers are disabled.
    });
  });
}
