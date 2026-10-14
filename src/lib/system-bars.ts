/**
 * Keeping the Android system bars in step with the app's own light/dark mode.
 *
 * The APK draws edge-to-edge, so the status bar is transparent and its clock,
 * battery and icons sit directly on top of the dashboard header. Capacitor's
 * built-in SystemBars plugin defaults to `DEFAULT`, which follows the *device*
 * night mode — but this app owns its colour mode in Settings (see lib/theme.ts),
 * so a phone in dark mode would put white icons on our light header (i.e. an
 * invisible clock). Pushing the style from `applyTheme` keeps the bar and the
 * header in the same mode.
 *
 * Capacitor is imported lazily and only when there is a native bridge, so the
 * web build and the unit tests never load it.
 */
import type { ThemeMode } from './theme';

/**
 * Light/dark *content* for the status bar and the gesture bar. No-op off the
 * native shell; failures are swallowed — an older shell without the SystemBars
 * plugin should keep its default look rather than break the theme switch.
 */
export function syncSystemBars(mode: ThemeMode): void {
  void import('@capacitor/core')
    .then(({ Capacitor, SystemBars, SystemBarsStyle }) => {
      if (!Capacitor.isNativePlatform()) return undefined;
      return SystemBars.setStyle({
        style: mode === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
      });
    })
    .catch(() => {});
}
