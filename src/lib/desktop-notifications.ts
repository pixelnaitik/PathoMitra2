/**
 * One "show a banner" API across three platforms that agree on nothing.
 *
 * The old code called `new Notification()` directly. That works in a desktop
 * browser and nowhere else:
 *   - Android WebView (the Capacitor app) does not implement the Web
 *     Notifications API at all — `window.Notification` is undefined, so the
 *     preference could never be honoured on the device most labs use.
 *   - Chrome for Android defines `Notification` but throws `Illegal
 *     constructor` when it is built from page context; on that platform banners
 *     must come from the service worker registration.
 *
 * So this module picks a backend per platform and hides the difference:
 *   native  → `@capacitor/local-notifications` (real OS notifications, works
 *             backgrounded, and the plugin's own manifest contributes
 *             POST_NOTIFICATIONS so the runtime prompt can be answered)
 *   sw      → `ServiceWorkerRegistration.showNotification()` on web
 *   page    → `new Notification()` for desktop browsers with no SW registered
 *
 * Like `lib/haptics.ts`, the native plugin is imported lazily so its bridge
 * code never enters the web bundle, and no function here may ever reject —
 * a banner is a courtesy, and a failed one must not break the alert list.
 */
import { Capacitor } from '@capacitor/core';

export type BannerPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';
export type BannerBackend = 'native' | 'service-worker' | 'page' | 'none';

type LocalNotificationsModule = typeof import('@capacitor/local-notifications');

/** Android 8+ groups banners under a channel the user can silence in settings. */
const ALERT_CHANNEL_ID = 'pathomitra-alerts';
/**
 * A saved-file receipt is a different intent from an alert: the lab may want one
 * and still silence the other, so Android gives them separate channels.
 */
export const FILE_CHANNEL_ID = 'pathomitra-files';

/** Channel labels as they appear in the device's own notification settings. */
const CHANNEL_SPECS: Record<string, { name: string; description: string }> = {
  [ALERT_CHANNEL_ID]: {
    name: 'Lab alerts',
    description: 'Overdue samples, unissued drafts, amendments and unpaid dues',
  },
  [FILE_CHANNEL_ID]: {
    name: 'Saved files',
    description: 'A notice each time a report or export is written to this device',
  },
};

let nativeMod: LocalNotificationsModule | null | undefined;
/** Channels created this run — `createChannel` is idempotent but not free. */
const channelsReady = new Set<string>();

/** Load the plugin once, and only on a real device. */
async function loadNative(): Promise<LocalNotificationsModule | null> {
  if (!Capacitor.isNativePlatform()) return null;
  if (nativeMod === undefined) {
    try {
      nativeMod = await import('@capacitor/local-notifications');
    } catch {
      nativeMod = null;
    }
  }
  return nativeMod;
}

/**
 * Which backend a banner would take *right now*, without awaiting the import.
 *
 * Sync on purpose: the Settings toggle needs it to decide `disabled` during
 * the first render, and asking the user to wait for a promise to learn that
 * their platform cannot do this at all is a worse answer than no answer.
 */
export function pickBackend(): BannerBackend {
  if (Capacitor.isNativePlatform()) return 'native';
  if (typeof Notification === 'undefined') return 'none';
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) return 'service-worker';
  return 'page';
}

/** Can this platform show a banner at all, once permission is granted? */
export function isSupported(): boolean {
  return pickBackend() !== 'none';
}

/** Map the plugin's `PermissionState` / the browser's enum onto our four cases. */
export function mapPermission(
  value: string | undefined | null,
): Exclude<BannerPermission, 'unsupported'> {
  switch (value) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    // 'prompt' and 'prompt-with-rationale' are both "we haven't asked / they didn't answer".
    default:
      return 'prompt';
  }
}

/**
 * Stable positive 32-bit id for an alert key.
 *
 * Android identifies a notification by an `Int`, while our alert ids are
 * strings (`overdue:<uuid>`). FNV-1a keeps the mapping stable across restarts,
 * so re-alerting the same patient replaces its banner instead of stacking a
 * second one — the same job `tag` does on web.
 */
export function bannerIdFor(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Stay inside a signed 32-bit range: the plugin hands this to a Java `Int`.
  return hash % 0x7fffffff || 1;
}

/** Current permission without prompting. Never throws. */
export async function currentPermission(): Promise<BannerPermission> {
  const backend = pickBackend();
  if (backend === 'none') return 'unsupported';
  try {
    if (backend === 'native') {
      const m = await loadNative();
      if (!m) return 'unsupported';
      const status = await m.LocalNotifications.checkPermissions();
      return mapPermission(status.display);
    }
    return mapPermission(Notification.permission);
  } catch {
    return 'unsupported';
  }
}

/**
 * Ask the OS for permission and report what it answered.
 *
 * On native this is the Android 13+ `POST_NOTIFICATIONS` runtime prompt; on web
 * it is the browser's site permission dialog. A rejection is reported as
 * `unsupported` rather than thrown — the caller's job is to tell the user the
 * toggle is not available, not to crash on it.
 */
export async function requestPermission(): Promise<BannerPermission> {
  const backend = pickBackend();
  if (backend === 'none') return 'unsupported';
  try {
    if (backend === 'native') {
      const m = await loadNative();
      if (!m) return 'unsupported';
      const status = await m.LocalNotifications.requestPermissions();
      return mapPermission(status.display);
    }
    const result = await Notification.requestPermission();
    return mapPermission(result);
  } catch {
    return 'unsupported';
  }
}

/** Android-only: make a channel before the first banner in it, so it is not silent. */
async function ensureChannel(m: LocalNotificationsModule, channelId: string): Promise<void> {
  if (Capacitor.getPlatform() !== 'android' || channelsReady.has(channelId)) return;
  const spec = CHANNEL_SPECS[channelId] ?? CHANNEL_SPECS[ALERT_CHANNEL_ID];
  try {
    await m.LocalNotifications.createChannel({
      id: channelId,
      name: spec.name,
      description: spec.description,
      importance: 4,
      visibility: 1,
      vibration: true,
    });
  } catch {
    /* an existing or refused channel must not stop the banner */
  }
  channelsReady.add(channelId);
}

export interface BannerOptions {
  /** Stable alert key (`overdue:<id>`) — reused as the replace/dedupe handle. */
  key: string;
  title: string;
  body: string;
  /** Android channel; defaults to the lab-alerts one. */
  channelId?: string;
}

/**
 * Show one banner. Resolves `true` only when the platform accepted it.
 *
 * Banners are fire-and-forget by design: nothing in the app depends on the
 * return value except a debug toast.
 */
export async function showBanner(options: BannerOptions): Promise<boolean> {
  const backend = pickBackend();
  try {
    if (backend === 'native') {
      const m = await loadNative();
      if (!m) return false;
      const channelId = options.channelId ?? ALERT_CHANNEL_ID;
      await ensureChannel(m, channelId);
      await m.LocalNotifications.schedule({
        notifications: [
          {
            id: bannerIdFor(options.key),
            title: options.title,
            body: options.body,
            channelId,
            autoCancel: true,
            // Carried through to the app on tap; the dashboard can read it from
            // `localNotificationReceived` if it ever wants to deep-link.
            extra: { alertKey: options.key },
          },
        ],
      });
      return true;
    }

    if (backend === 'service-worker') {
      const registration = await navigator.serviceWorker?.getRegistration?.();
      if (registration) {
        await registration.showNotification(options.title, {
          body: options.body,
          tag: options.key,
        });
        return true;
      }
    }

    // Desktop browsers with no registration, and any web path that fell through.
    new Notification(options.title, { body: options.body, tag: options.key });
    return true;
  } catch {
    return false;
  }
}

/**
 * Show a banner, asking the OS for permission first if it has never been asked.
 *
 * The alert path can wait for the Settings toggle; a one-off receipt the operator
 * just triggered cannot, and on Android 13+ nothing can be posted at all until the
 * runtime prompt is answered. A refusal is not an error — the in-app toast already
 * carried the same words — so this only reports whether a banner went out.
 */
export async function showBannerWithPermission(options: BannerOptions): Promise<boolean> {
  const permission = await currentPermission();
  if (permission === 'prompt') {
    if ((await requestPermission()) !== 'granted') return false;
  } else if (permission !== 'granted') {
    return false;
  }
  return showBanner(options);
}

/** Drop a banner the lab has handled. Best-effort; ignores an unknown key. */
export async function dismissBanner(key: string): Promise<void> {
  try {
    if (pickBackend() === 'native') {
      const m = await loadNative();
      if (!m) return;
      await m.LocalNotifications.cancel({ notifications: [{ id: bannerIdFor(key) }] });
      return;
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker?.getRegistration?.();
      if (registration)
        await registration
          .getNotifications({ tag: key })
          .then(list => list.forEach(n => n.close()));
    }
  } catch {
    /* nothing to dismiss */
  }
}
