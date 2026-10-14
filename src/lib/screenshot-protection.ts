/**
 * Screenshot / screen-recording protection — the JS half of `WindowSecurityPlugin`.
 *
 * Android's FLAG_SECURE makes the window uncapturable: screenshots and recordings
 * come out blank, the Recents thumbnail is a placeholder, and screen-sharing apps
 * capture nothing. For a console whose every list is a patient name next to a
 * diagnosis, on a phone that gets passed across a bench, that is the safe default —
 * so the native side sets the flag in `MainActivity.onCreate` before the WebView
 * loads, and this module only ever *removes* it, when the lab explicitly asks.
 *
 * Two rules this file keeps:
 *   - It never rejects. A security affordance failing must not break the settings
 *     save that triggered it, and the native default is already the safe state.
 *   - It reports the state actually applied, not the state requested, so the UI
 *     cannot claim protection it did not get.
 *
 * In a browser tab there is no window flag to set, so it is a no-op and reports
 * `true` (nothing here is unprotected by an opted-out lab).
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

interface WindowSecurityPlugin {
  setScreenshotProtection(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
}

const WindowSecurity = registerPlugin<WindowSecurityPlugin>('WindowSecurity');

/**
 * Apply the persisted `screenshotsAllowed` preference to the native window.
 *
 * @param allowScreenshots `false` (the default) keeps the screen uncapturable.
 * @returns `true` when the window is now protected, `false` when it is capturable.
 */
export async function applyScreenshotProtection(allowScreenshots: boolean): Promise<boolean> {
  const protect = !allowScreenshots;
  if (!Capacitor.isNativePlatform()) return true;

  try {
    await WindowSecurity.setScreenshotProtection({ enabled: protect });
    return protect;
  } catch (error) {
    // The flag was set by MainActivity and this call only clears it, so a failure
    // here leaves the screen protected — which is the state to report.
    console.error('screenshot-protection: native call failed, leaving protection on', error);
    return true;
  }
}
