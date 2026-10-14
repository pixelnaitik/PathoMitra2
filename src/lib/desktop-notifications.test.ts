import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bannerIdFor,
  currentPermission,
  dismissBanner,
  isSupported,
  mapPermission,
  pickBackend,
  showBanner,
} from './desktop-notifications';

/**
 * jsdom implements neither `Notification` nor a Capacitor bridge, so the whole
 * module is supposed to collapse to "unsupported / did nothing" here. That is
 * exactly the failure mode the WebView used to have, so it is worth pinning:
 * the module must never throw at a caller that only wanted a banner.
 */
describe('desktop-notifications backend selection', () => {
  const originalNotification = (globalThis as { Notification?: unknown }).Notification;

  beforeEach(() => {
    delete (globalThis as { Notification?: unknown }).Notification;
  });

  afterEach(() => {
    if (originalNotification === undefined) {
      delete (globalThis as { Notification?: unknown }).Notification;
    } else {
      (globalThis as { Notification?: unknown }).Notification = originalNotification;
    }
    vi.restoreAllMocks();
  });

  it('reports no backend when the platform offers none', () => {
    expect(pickBackend()).toBe('none');
    expect(isSupported()).toBe(false);
  });

  it('reads the current permission as unsupported rather than throwing', async () => {
    await expect(currentPermission()).resolves.toBe('unsupported');
  });

  it('fails a banner quietly instead of rejecting', async () => {
    await expect(showBanner({ key: 'overdue:p1', title: 'T', body: 'B' })).resolves.toBe(false);
  });

  it('ignores a dismiss for a banner that never existed', async () => {
    await expect(dismissBanner('overdue:p1')).resolves.toBeUndefined();
  });

  it('uses the page constructor on a desktop browser with no service worker', async () => {
    const constructed: unknown[][] = [];
    class FakeNotification {
      static permission = 'granted';
      static requestPermission = vi.fn();
      constructor(title: string, options: unknown) {
        constructed.push([title, options]);
      }
    }
    (globalThis as { Notification?: unknown }).Notification = FakeNotification;
    // jsdom has no `navigator.serviceWorker`, so the SW path is skipped.
    expect(pickBackend()).toBe('page');
    await expect(
      showBanner({ key: 'draft:r1', title: 'Draft', body: 'never issued' }),
    ).resolves.toBe(true);
    expect(constructed).toEqual([['Draft', { body: 'never issued', tag: 'draft:r1' }]]);
  });

  it('reads the browser permission when one exists', async () => {
    class FakeNotification {
      static permission = 'denied';
      static requestPermission = vi.fn();
    }
    (globalThis as { Notification?: unknown }).Notification = FakeNotification;
    await expect(currentPermission()).resolves.toBe('denied');
  });
});

describe('bannerIdFor', () => {
  it('is stable for the same alert key', () => {
    expect(bannerIdFor('overdue:abc')).toBe(bannerIdFor('overdue:abc'));
  });

  it('stays inside the signed 32-bit range Android hands to a Java Int', () => {
    for (const key of ['overdue:abc', 'draft:xyz', 'due:1', 'amended:', 'x'.repeat(200)]) {
      const id = bannerIdFor(key);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThan(0x7fffffff);
    }
  });

  it('separates alerts that differ only in their entity id', () => {
    expect(bannerIdFor('overdue:p1')).not.toBe(bannerIdFor('overdue:p2'));
  });

  it('never returns 0, which would collide across every empty key', () => {
    expect(bannerIdFor('')).toBeGreaterThan(0);
  });
});

describe('mapPermission', () => {
  it('passes the two decisive answers through', () => {
    expect(mapPermission('granted')).toBe('granted');
    expect(mapPermission('denied')).toBe('denied');
  });

  it('treats every not-yet-answered state as prompt', () => {
    expect(mapPermission('prompt')).toBe('prompt');
    expect(mapPermission('prompt-with-rationale')).toBe('prompt');
    expect(mapPermission('default')).toBe('prompt');
    expect(mapPermission(undefined)).toBe('prompt');
  });
});
