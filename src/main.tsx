import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import NProgress from 'nprogress';
import 'nprogress/nprogress.css';
import { initErrorReporting } from './lib/telemetry';
import { syncSystemBars } from './lib/system-bars';
import { applyAppearance } from './lib/theme';
import { readSettings } from './lib/settings';
import { Capacitor } from '@capacitor/core';
import { initDataStore } from './data';
import { isDesktopShell } from './lib/desktop-bridge';

// Capture un-caught errors outside the React tree (SW registration, lazy chunk
// load failures, stray promise rejections) before anything else runs.
initErrorReporting();

// Apply the stored appearance prefs (haptics on/off, reduced transparency) before
// the first interaction. index.html's bootstrap sets the color/text attributes
// pre-paint; this covers the JS-driven prefs the inline script cannot reach.
applyAppearance(readSettings());

// Configure NProgress — slim bar, no spinner (we have our own)
NProgress.configure({ showSpinner: false, speed: 400, minimum: 0.1 });

// Expose NProgress globally so lazy-loaded Suspense wrappers can call it
(window as any).__NProgress = NProgress;

// In the native (offline) app there is no service worker: Capacitor serves the
// bundle from disk and the encrypted SQLCipher store handles persistence. The
// Electron shell is the same story — served from disk over its own scheme, the
// encrypted store persists — so both skip the PWA registration and land
// directly on the auth console. Only the web build registers the service worker
// and keeps the landing page.
if (Capacitor.isNativePlatform() || isDesktopShell()) {
  // The shells have no landing page. Rewriting the entry URL before the router
  // is created means the first frame is already the auth screen, instead of an
  // empty one while `/` redirects.
  if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
    window.history.replaceState(null, '', '/auth');
  }
  // Warm up (open + decrypt) the local database as early as possible.
  void initDataStore();
  // The status bar band is an Android concept — the desktop window has no
  // status bar to tint, and the plugin call would only noise the console.
  if (Capacitor.isNativePlatform()) {
    syncSystemBars(
      document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
    );
  }
} else if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(reg => console.log('PathoMitra PWA: Service Worker registered scope:', reg.scope))
      .catch(err => console.error('PathoMitra PWA: Service Worker registration failed:', err));
  });
}

// Dismiss the HTML splash screen once React is ready to render
function removeSplash() {
  const splash = document.getElementById('app-splash');
  if (splash) {
    // Complete the progress bar then fade out
    const bar = document.getElementById('splash-bar');
    if (bar) bar.style.transform = 'scaleX(1)';
    if ((window as any).__splashInterval) clearInterval((window as any).__splashInterval);
    setTimeout(() => {
      splash.style.transition = 'opacity 0.35s ease';
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 370);
    }, 300);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App onReady={removeSplash} />
  </StrictMode>,
);
