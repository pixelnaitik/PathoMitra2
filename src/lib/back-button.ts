/**
 * Android's back gesture / button, routed through the app instead of the OS.
 *
 * Without a listener the system's default is to finish the activity — so a back
 * swipe from a half-filled patient sheet, an open report drawer or the A4 editor
 * killed the app and the unsaved work with it. Capacitor's App plugin registers
 * the `OnBackPressedCallback`, but it only forwards the press to JS when a JS
 * listener exists; with no listener and no WebView history it swallows the press
 * entirely, leaving the app impossible to exit. Both halves are handled here.
 *
 * Unwind order is the one users expect from a phone: whatever is on top closes
 * first (dialog → drawer → in-page state), then the route, and only a deliberate
 * second press at the top level quits the app.
 *
 * Everything is lazy-imported and gated on the native bridge, so the web build
 * never loads the plugin and browser Back keeps being browser Back.
 */
import { useEffect } from 'react';

/** Returning true means "I consumed the press — stop unwinding". */
export type BackHandler = () => boolean;

/** Layers, outermost first. A handler at a higher priority runs before it. */
export const BACK_PRIORITY = {
  /** Modal dialogs and sheets: Command Search, a report sheet, confirm prompts. */
  OVERLAY: 100,
  /** Panels that slide over the page: the mobile navigation drawer. */
  PANEL: 60,
  /** Non-overlay in-page state worth keeping: an open editor, a selection. */
  PAGE: 20,
} as const;

interface Registration {
  id: number;
  priority: number;
  handler: BackHandler;
}

/**
 * Sorted high → low, so the topmost layer is asked first. Insertion order breaks
 * ties, which keeps the most recently opened overlay on top at the same level.
 */
let registrations: Registration[] = [];
let nextId = 1;

/**
 * Ask the app to close something on the next back press.
 *
 * @returns a function that unregisters. Call it on unmount.
 */
export function registerBackHandler(
  handler: BackHandler,
  priority: number = BACK_PRIORITY.PAGE,
): () => void {
  const entry: Registration = { id: nextId++, priority, handler };
  registrations = [...registrations, entry].sort((a, b) => b.priority - a.priority || a.id - b.id);
  return () => {
    registrations = registrations.filter(registered => registered.id !== entry.id);
  };
}

/** Close the topmost thing that is open. True if the press was consumed. */
export function unwindOneLayer(): boolean {
  for (const entry of registrations) {
    try {
      if (entry.handler()) return true;
    } catch (err) {
      // A broken handler must not trap the user on a screen they cannot leave.
      console.error('PathoMitra: back handler threw', err);
    }
  }
  return false;
}

/** Exposed for tests: drop every registration so no handler leaks between cases. */
export function __clearBackHandlersForTests(): void {
  registrations = [];
}

/**
 * Register `handler` for as long as the component is mounted and `enabled`.
 *
 * The dependency list is the caller's: the handler closes over live state, so it
 * has to be re-registered whenever that state changes or the back press will act
 * on a stale snapshot.
 */
export function useBackHandler(
  handler: BackHandler,
  enabled: boolean,
  priority: number = BACK_PRIORITY.OVERLAY,
): void {
  useEffect(() => {
    if (!enabled) return undefined;
    return registerBackHandler(handler, priority);
    // Re-arm on any change to the caller's state, by design.
  }, [handler, enabled, priority]);
}

export interface BackButtonOptions {
  /** Route the press on to the router (history back). */
  goBack: () => void;
  /** Tell the user to press again to quit. */
  onExitHint: (message: string) => void;
}

/** How long the second press has to arrive for it to count as "quit". */
const EXIT_WINDOW_MS = 2_000;

/**
 * Attach the native back listener. Call once, from inside the router.
 *
 * @returns a teardown function; nothing on platforms without a back button.
 */
export async function installAndroidBackButton(options: BackButtonOptions): Promise<() => void> {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return () => {};

  const { App } = await import('@capacitor/app');
  let lastPressAt = 0;

  const handle = await App.addListener('backButton', event => {
    // 1. Whatever the user is looking at on top of the page goes away first.
    if (unwindOneLayer()) {
      lastPressAt = 0;
      return;
    }
    // 2. Then the route. `canGoBack` comes from the WebView's own history, which
    //    is the honest answer — sheets and drawers add no entries, so an open
    //    dialog over the dashboard root correctly reports false here.
    if (event.canGoBack) {
      lastPressAt = 0;
      options.goBack();
      return;
    }
    // 3. At the top level: one press says "again to exit", the next quits.
    const now = Date.now();
    if (now - lastPressAt < EXIT_WINDOW_MS) {
      void App.exitApp();
      return;
    }
    lastPressAt = now;
    options.onExitHint('Press back again to close PathoMitra');
  });

  return () => {
    void handle.remove();
  };
}
