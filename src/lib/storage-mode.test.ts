import { describe, it, expect, vi, beforeEach } from 'vitest';

// storageMode() reads the shell flag off the data layer; make both outcomes
// selectable without spinning up a real repository.
const h = vi.hoisted(() => ({ isShell: false }));
vi.mock('../data', () => ({
  get isShell() {
    return h.isShell;
  },
}));

import { storageMode, isProtectedStorage, isUnprotectedProductionStore } from './storage-mode';

beforeEach(() => {
  h.isShell = false;
});

describe('storage-mode (P0.1)', () => {
  it('reports browser-local outside an installed shell', () => {
    h.isShell = false;
    expect(storageMode()).toBe('browser-local');
    expect(isProtectedStorage()).toBe(false);
  });

  it('reports protected inside an installed shell (APK or Electron)', () => {
    h.isShell = true;
    expect(storageMode()).toBe('protected');
    expect(isProtectedStorage()).toBe(true);
  });

  it('flags a PRODUCTION browser build as the unsafe case that must be disclosed', () => {
    expect(isUnprotectedProductionStore('browser-local', { PROD: true })).toBe(true);
  });

  it('does not flag dev/test browser use, nor a protected shell, so those stay unbothered', () => {
    // A hosted production build in a shell is encrypted — no warning needed.
    expect(isUnprotectedProductionStore('protected', { PROD: true })).toBe(false);
    // A dev/preview browser tab is not the production path the finding is about.
    expect(isUnprotectedProductionStore('browser-local', { PROD: false })).toBe(false);
  });
});
