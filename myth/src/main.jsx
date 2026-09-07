import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/spotlight/styles.css';
import './styles.css';

import { theme } from './theme';
import App from './App';
import { useStore } from './store/useStore';
import { useUI } from './store/useUI';

dayjs.extend(customParseFormat);

// Exposed for the smoke tests and screenshot scripts (scripts/*.mjs) — this is a
// private single-user app, so there is nothing to hide from the console.
window.__myth = { useStore, useUI };

// Service worker: required for app-like notifications (iOS home-screen installs
// only deliver notifications through a service worker, never `new Notification`).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </React.StrictMode>
);
