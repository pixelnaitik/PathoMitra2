/**
 * Tactile feedback — a thin, native-only wrapper over `@capacitor/haptics`.
 *
 * Every helper is fire-and-forget and degrades to a no-op off-device: the
 * browser build never even loads the plugin (it is imported lazily, so its
 * bridge code stays out of the initial web chunk and is only paid for on a real
 * device), and a device without a vibrator just resolves quietly. Nothing here
 * may ever reject or block the interaction it is annotating, so every call is
 * swallowed in a try/catch.
 *
 * The intent is a small, consistent vocabulary the shared UI primitives reach
 * for — a light tick when a control is pressed, a firmer one on destructive
 * actions, and the platform's success / warning / error patterns on outcomes —
 * rather than ad-hoc buzzes scattered through the pages.
 */
import { Capacitor } from '@capacitor/core';

type HapticsModule = typeof import('@capacitor/haptics');

let mod: HapticsModule | null | undefined;
let enabled = true;

/** Load the plugin once, and only on a real device. */
async function load(): Promise<HapticsModule | null> {
  if (!Capacitor.isNativePlatform()) return null;
  if (mod === undefined) {
    try {
      mod = await import('@capacitor/haptics');
    } catch {
      mod = null;
    }
  }
  return mod;
}

/** Master switch — lets a future setting (or tests) silence all haptics. */
export function setHapticsEnabled(next: boolean): void {
  enabled = next;
}

async function run(fn: (m: HapticsModule) => Promise<unknown>): Promise<void> {
  if (!enabled) return;
  const m = await load();
  if (!m) return;
  try {
    await fn(m);
  } catch {
    /* a missing vibrator must never break a tap */
  }
}

/** Light collision — the default "you pressed something" tick. */
export const hapticTap = () => run(m => m.Haptics.impact({ style: m.ImpactStyle.Light }));
/** Firmer collision for confirmations and destructive presses. */
export const hapticMedium = () => run(m => m.Haptics.impact({ style: m.ImpactStyle.Medium }));
/**
 * Subtle tick when a selection moves (segmented control, picker, list row).
 *
 * Android is stateful here: the plugin's `selectionChanged()` only fires when a
 * selection session is open (`Haptics.java` guards it with a `selectionStarted`
 * flag), while iOS has no such state. Calling `selectionChanged()` on its own —
 * which is what this used to do — was therefore silently dropped on every
 * Android device. Open the session, tick, close it again, so the same call
 * behaves on both platforms.
 */
export const hapticSelection = () =>
  run(async m => {
    await m.Haptics.selectionStart();
    await m.Haptics.selectionChanged();
    await m.Haptics.selectionEnd();
  });
/** Platform "task done" pattern — pair with a success toast. */
export const hapticSuccess = () =>
  run(m => m.Haptics.notification({ type: m.NotificationType.Success }));
/** Platform "heads up" pattern — pair with a warning toast. */
export const hapticWarning = () =>
  run(m => m.Haptics.notification({ type: m.NotificationType.Warning }));
/** Platform "that failed" pattern — pair with an error toast. */
export const hapticError = () =>
  run(m => m.Haptics.notification({ type: m.NotificationType.Error }));
