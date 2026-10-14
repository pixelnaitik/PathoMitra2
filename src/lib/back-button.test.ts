/**
 * The Android back-button unwind contract.
 *
 * Two failure modes are being guarded, and both were real:
 *
 *   - With no `@capacitor/app` plugin registered, Back finished the activity, so
 *     a swipe from an open sheet killed the app and the unsaved work in it.
 *   - With the plugin registered but *no* JS listener, Capacitor's
 *     OnBackPressedCallback swallows the press when the WebView has no history,
 *     so the app could then never be exited at all.
 *
 * The stack has to close the topmost layer first, fall through to the route, and
 * only quit on a deliberate second press.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import {
  BACK_PRIORITY,
  __clearBackHandlersForTests,
  installAndroidBackButton,
  registerBackHandler,
  unwindOneLayer,
} from './back-button';

const addListener = vi.fn();
const exitApp = vi.fn();

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn() } }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener,
    exitApp,
  },
}));

/** The listener Capacitor hands back to be removed on teardown. */
let backListener: ((event: { canGoBack: boolean }) => void) | null = null;

function nativeShell(canGoBack = false) {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  addListener.mockImplementation((_event, handler) => {
    backListener = handler;
    return Promise.resolve({ remove: () => {} });
  });
  return { press: () => backListener?.({ canGoBack }) };
}

afterEach(() => {
  backListener = null;
  vi.clearAllMocks();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  __clearBackHandlersForTests();
});

describe('registerBackHandler', () => {
  it('asks the highest-priority layer first and stops at the one that handled it', () => {
    const page = vi.fn(() => false);
    const panel = vi.fn(() => false);
    const overlay = vi.fn(() => true);

    const off = [
      registerBackHandler(page, BACK_PRIORITY.PAGE),
      registerBackHandler(panel, BACK_PRIORITY.PANEL),
      registerBackHandler(overlay, BACK_PRIORITY.OVERLAY),
    ];

    expect(unwindOneLayer()).toBe(true);
    expect(overlay).toHaveBeenCalled();
    // The dialog consumed the press; the drawer and the route must not move.
    expect(panel).not.toHaveBeenCalled();
    expect(page).not.toHaveBeenCalled();

    off.forEach(dispose => dispose());
    expect(unwindOneLayer()).toBe(false);
  });

  it('falls through a layer that has nothing open', () => {
    const closed = registerBackHandler(() => false, BACK_PRIORITY.OVERLAY);
    const drawer = registerBackHandler(() => true, BACK_PRIORITY.PANEL);

    expect(unwindOneLayer()).toBe(true);

    closed();
    drawer();
  });

  it('does not let a throwing handler trap the user on the screen', () => {
    const boom = registerBackHandler(() => {
      throw new Error('bad handler');
    }, BACK_PRIORITY.OVERLAY);
    const drawer = registerBackHandler(() => true, BACK_PRIORITY.PANEL);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(unwindOneLayer()).toBe(true);
    expect(spy).toHaveBeenCalled();

    boom();
    drawer();
    spy.mockRestore();
  });
});

describe('installAndroidBackButton', () => {
  it('attaches nothing in a browser', async () => {
    const teardown = await installAndroidBackButton({
      goBack: () => {},
      onExitHint: () => {},
    });
    expect(addListener).not.toHaveBeenCalled();
    expect(teardown()).toBeUndefined();
  });

  it('closes an open layer before touching the router', async () => {
    const { press } = nativeShell(true);
    const goBack = vi.fn();
    await installAndroidBackButton({ goBack, onExitHint: () => {} });

    const closeSheet = registerBackHandler(() => true, BACK_PRIORITY.OVERLAY);
    press();

    expect(goBack).not.toHaveBeenCalled();
    closeSheet();
  });

  it('goes back a route when there is nowhere else to unwind', async () => {
    const { press } = nativeShell(true);
    const goBack = vi.fn();
    await installAndroidBackButton({ goBack, onExitHint: () => {} });

    press();
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('never reaches the quit gesture while the WebView still has history', async () => {
    const { press } = nativeShell(true);
    const goBack = vi.fn();
    await installAndroidBackButton({ goBack, onExitHint: () => {} });

    press();
    press();
    expect(goBack).toHaveBeenCalledTimes(2);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('requires a second press to quit, and only inside the window', async () => {
    const { press } = nativeShell(false);
    const goBack = vi.fn();
    const hint = vi.fn();
    await installAndroidBackButton({ goBack, onExitHint: hint });

    press();
    expect(hint).toHaveBeenCalledWith(expect.stringContaining('again'));
    expect(exitApp).not.toHaveBeenCalled();

    // Still within the 2s window: this one is the quit.
    press();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it('resets the quit gesture when anything happened in between', async () => {
    vi.useFakeTimers();
    try {
      const { press } = nativeShell(false);
      const hint = vi.fn();
      await installAndroidBackButton({ goBack: () => {}, onExitHint: hint });

      press();
      vi.advanceTimersByTime(5000);
      press();

      expect(exitApp).not.toHaveBeenCalled();
      expect(hint).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
