import '@testing-library/jest-dom/vitest';

/**
 * jsdom's `matchMedia` is environment-featured, not guaranteed: `<Sheet>` calls
 * it on mount to decide between a bottom sheet (mobile) and a centred dialog
 * (desktop), and a suite run under load has been seen to mount components
 * before jsdom's own implementation was reachable (`window.matchMedia is not a
 * function` — PrintDialog.test flaked 6/6 on 2026-10-12). Assign the stub
 * unconditionally: `matches: false` is the desktop answer, which is the case
 * those components are tested as, and jsdom's media queries never changed the
 * answer anyway.
 */
const stub = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});
window.matchMedia = stub as unknown as typeof window.matchMedia;
