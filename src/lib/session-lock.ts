/**
 * Automatic session locking.
 *
 * The lab console holds other people's medical records, and before this existed
 * the only way to lock it was the manual Log out button. Real use looks like:
 * unlock the app, look something up, hand the phone to a colleague or put it
 * down on the bench — and the patient list stays open indefinitely, with the
 * device's own screen lock doing nothing because the app was already unlocked.
 *
 * One countdown, started by either trigger:
 *   - idle: no pointer, keyboard or scroll activity for `idleMs`.
 *   - backgrounding: leaving the app restarts the *same* `idleMs` countdown
 *     instead of locking on the spot. Locking the instant the console left the
 *     foreground turned every routine detour — opening a PDF in the device
 *     viewer, the share sheet, another window on the desktop — into a sign-in,
 *     and the owner asked for the 5-minute behaviour instead (2026-10-11,
 *     desktop first, then the app). An abandoned console is still covered:
 *     the clock keeps running while the app is away.
 *
 * Backgrounded JS timers are unreliable — Android freezes them and a hidden tab
 * throttles them — so the elapsed time is also measured against the wall clock
 * on the way back in. Without that, a timer that never got to fire while the
 * process was frozen would hand the session straight back after an hour away.
 *
 * `idleMs = 0` (the "Never" option in Settings) disables the countdown on both
 * paths, so backgrounding does not lock either.
 */
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { isDesktopShell } from './desktop-bridge';

export interface SessionLockOptions {
  onLock: () => void;
  /** Milliseconds of inactivity before locking; 0 disables the idle timer. */
  idleMs: number;
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function installSessionLock({ onLock, idleMs }: SessionLockOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Wall-clock ms of the last background transition; null while in foreground. */
  let backgroundedAt: number | null = null;
  let disposed = false;
  const teardowns: Array<() => void> = [];

  const fire = () => {
    if (!disposed) onLock();
  };

  const cancelIdle = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const resetIdle = () => {
    if (idleMs <= 0) return;
    cancelIdle();
    timer = setTimeout(fire, idleMs);
  };

  /**
   * Coming back to the foreground.
   *
   * @returns true when the time away alone exceeded the interval, so the caller
   *   is locked out rather than resuming an unattended session.
   */
  const resume = () => {
    const awayMs = backgroundedAt === null ? 0 : Date.now() - backgroundedAt;
    backgroundedAt = null;
    cancelIdle();
    if (idleMs > 0 && awayMs >= idleMs) {
      fire();
      return true;
    }
    resetIdle();
    return false;
  };

  /** Leaving it: start the same countdown, and remember when we left. */
  const leave = () => {
    backgroundedAt = Date.now();
    resetIdle();
  };

  // Background / foreground transition.
  if (Capacitor.isNativePlatform()) {
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        leave();
        return;
      }
      resume();
    })
      .then(handle => {
        if (disposed) void handle.remove();
        else teardowns.push(() => void handle.remove());
      })
      .catch(error => console.error('SessionLock: appStateChange unavailable', error));
  } else if (isDesktopShell()) {
    // Desktop deliberately has NO visibility trigger: Chromium reports an
    // occluded window (any other window placed over ours) as hidden, so
    // `visibilitychange` locked the console the instant the operator clicked
    // another program — reported on the first desktop runs, 2026-10-11.
    // Losing focus is not leaving the app; a real desktop "background" is
    // minimize or system suspend, which need a main-process event channel
    // (powerMonitor) — tracked as a Core Functionality item. Until then the
    // idle timer below is the desktop lock.
  } else {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leave();
      else resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    teardowns.push(() => document.removeEventListener('visibilitychange', onVisibility));
  }

  // Inactivity.
  if (idleMs > 0) {
    for (const type of ACTIVITY_EVENTS) {
      document.addEventListener(type, resetIdle, { passive: true });
      teardowns.push(() => document.removeEventListener(type, resetIdle));
    }
    resetIdle();
  }

  return () => {
    disposed = true;
    cancelIdle();
    teardowns.forEach(off => off());
  };
}
