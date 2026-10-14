/**
 * Palette + color-mode management.
 *
 * The actual color values live in src/index.css as [data-palette] and
 * [data-theme] blocks — this file only flips the two attributes on <html>
 * and exposes swatch metadata for the Settings theme picker. Keeping the
 * hexes in CSS means there is exactly one source of truth for colors.
 */

import { syncSystemBars } from './system-bars';
import { setHapticsEnabled } from './haptics';

export interface ThemeOption {
  id: string;
  name: string;
  /** Swatches shown in the picker (light-mode brand ramp). */
  swatches: string[];
  /** Representative color for chips / splash fallbacks. */
  previewColor: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'navy',
    name: 'Pacific Blue',
    swatches: ['#08477e', '#0a5ea6', '#0e8c7f'],
    previewColor: '#0a5ea6',
  },
  {
    id: 'teal',
    name: 'Clinical Teal',
    swatches: ['#085c52', '#0b7265', '#0a5ea6'],
    previewColor: '#0b7265',
  },
  {
    id: 'amethyst',
    name: 'Royal Amethyst',
    swatches: ['#57309e', '#6d3fc4', '#8c2db0'],
    previewColor: '#6d3fc4',
  },
  {
    id: 'slate',
    name: 'Graphite',
    swatches: ['#2c2c2e', '#3a3a3c', '#6e6e73'],
    previewColor: '#3a3a3c',
  },
  {
    id: 'maroon',
    name: 'Hematology Crimson',
    swatches: ['#8e1f2e', '#b02a3a', '#c2453d'],
    previewColor: '#b02a3a',
  },
];

export type ThemeMode = 'light' | 'dark';

/**
 * Apply the palette + mode by flipping data attributes on <html>.
 * Unknown ids fall back to the default palette block in CSS.
 */
export function applyTheme(themeId: string, mode: ThemeMode = 'light') {
  const root = document.documentElement;
  const theme = THEME_OPTIONS.find(t => t.id === themeId) || THEME_OPTIONS[0];

  root.setAttribute('data-palette', theme.id);
  root.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
  root.style.colorScheme = mode === 'dark' ? 'dark' : 'light';

  // Keep the browser chrome / PWA status bar in sync with the mode.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mode === 'dark' ? '#0a0a0c' : '#f5f5f7');

  // …and the APK's status / gesture bar icons, which the WebView now draws under.
  syncSystemBars(mode);
}

export interface AppearancePrefs {
  textSize?: string;
  reduceMotion?: boolean;
  reduceTransparency?: boolean;
  cornerStyle?: string;
  hapticsEnabled?: boolean;
}

/**
 * Apply the non-color appearance prefs (text scale, motion, transparency,
 * corner style) by flipping data attributes on <html> — the matching blocks in
 * index.css do the rest. Unknown values fall back to the defaults, same as
 * applyTheme. Haptics is a JS flag rather than a CSS attribute, so it is pushed
 * to lib/haptics here; running this at boot makes the stored choices take
 * effect before the first interaction.
 */
export function applyAppearance(prefs: AppearancePrefs) {
  const root = document.documentElement;
  root.setAttribute(
    'data-text-size',
    prefs.textSize === 'sm' || prefs.textSize === 'lg' ? prefs.textSize : 'md',
  );
  root.setAttribute('data-motion', prefs.reduceMotion ? 'reduced' : 'full');
  root.setAttribute('data-transparency', prefs.reduceTransparency ? 'reduced' : 'full');
  root.setAttribute('data-radius', prefs.cornerStyle === 'sharp' ? 'sharp' : 'rounded');
  setHapticsEnabled(prefs.hapticsEnabled !== false);
}
