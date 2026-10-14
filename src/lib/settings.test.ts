import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  readCustomTests,
  writeCustomTests,
  migrateSettings,
  sanitizeNotificationPrefs,
  SETTINGS_STORAGE_KEY,
  CUSTOM_TESTS_STORAGE_KEY,
  BRAND_LOGO_MAX_CHARS,
  isBrandLogoDataUrl,
} from './settings';
import { DEFAULT_NOTIFICATION_PREFS } from './notification-engine';

beforeEach(() => {
  localStorage.clear();
});

describe('readSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('migrates legacy margin values', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ reportMarginTop: 20, reportMarginBottom: 10, reportMarginLeft: 15 }),
    );
    const s = readSettings();
    expect(s.reportMarginTop).toBe(50);
    expect(s.reportMarginBottom).toBe(20);
    expect(s.reportMarginLeft).toBe(8);
  });

  it('survives corrupted JSON', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not json');
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges stored values over defaults', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ labName: 'My Lab' }));
    const s = readSettings();
    expect(s.labName).toBe('My Lab');
    expect(s.themeId).toBe(DEFAULT_SETTINGS.themeId);
  });
});

describe('writeSettings', () => {
  it('persists settings and dispatches the settings-updated event', () => {
    let fired = 0;
    window.addEventListener('settings-updated', () => fired++);
    writeSettings({ ...DEFAULT_SETTINGS, labName: 'Saved Lab' });
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).labName).toBe('Saved Lab');
    expect(fired).toBe(1);
  });

  it('applies the selected palette + mode as data attributes on <html>', () => {
    writeSettings({ ...DEFAULT_SETTINGS, themeId: 'teal', themeMode: 'dark' });
    expect(document.documentElement.getAttribute('data-palette')).toBe('teal');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    // Colors themselves live in CSS blocks ([data-palette] / [data-theme]),
    // so applyTheme must NOT leave inline var overrides behind.
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
  });
});

describe('custom tests storage', () => {
  it('round-trips through write/read', () => {
    const tests = [{ id: 'x', name: 'X TEST', category: 'C' }];
    writeCustomTests(tests as any);
    expect(localStorage.getItem(CUSTOM_TESTS_STORAGE_KEY)).toBeTruthy();
    expect(readCustomTests()).toEqual(tests);
  });

  it('returns empty list on corrupted data', () => {
    localStorage.setItem(CUSTOM_TESTS_STORAGE_KEY, 'nope[');
    expect(readCustomTests()).toEqual([]);
  });
});

describe('migrateSettings', () => {
  it('fills in font-size fallbacks from the legacy shared field', () => {
    const m = migrateSettings({ tableBodyFontSize: 11 });
    expect(m.reportTableBodyFontSize).toBe(11);
    expect(m.shareTableBodyFontSize).toBe(11);
  });

  it('rejects unknown appearance values instead of letting them stick', () => {
    const m = migrateSettings({ textSize: 'huge', reduceMotion: 'yes', cornerStyle: 'pointy' });
    expect(m.textSize).toBe(DEFAULT_SETTINGS.textSize);
    expect(m.reduceMotion).toBe(false);
    expect(m.cornerStyle).toBe('rounded');
  });

  it('keeps screen-capture protection on when the stored value is missing or corrupt', () => {
    // The native window starts protected (MainActivity sets FLAG_SECURE before the
    // WebView loads), so a stale or hand-edited settings object must not silently
    // downgrade it — the same fail-closed rule as allowPublicExports.
    expect(migrateSettings({}).screenshotsAllowed).toBe(false);
    expect(migrateSettings({ screenshotsAllowed: 'true' }).screenshotsAllowed).toBe(false);
    expect(migrateSettings({ screenshotsAllowed: 1 }).screenshotsAllowed).toBe(false);
    // An explicit true is the lab opting out, and is honoured.
    expect(migrateSettings({ screenshotsAllowed: true }).screenshotsAllowed).toBe(true);
  });

  it('ignores the legacy email / SMS toggles an older document may carry', () => {
    // The channels those two booleans mirrored were removed on 2026-10-11, so a
    // document written before then must come back as today's shape rather than a
    // half-populated one.
    const m = migrateSettings({ emailNotifications: false, smsNotifications: true });
    const prefs = m.notificationPrefs as ReturnType<typeof sanitizeNotificationPrefs>;
    expect(prefs.channels).toEqual(DEFAULT_NOTIFICATION_PREFS.channels);
    expect(prefs.categories).toEqual(DEFAULT_NOTIFICATION_PREFS.categories);
  });

  it('keeps a valid brand-logo data URL and drops everything else', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    expect(migrateSettings({ brandLogoUrl: url }).brandLogoUrl).toBe(url);
    // Remote URLs break the offline posture; non-strings and oversized blobs
    // are corrupt or hand-edited — all fall back to the built-in microscope.
    expect(migrateSettings({ brandLogoUrl: 'https://x.test/logo.png' }).brandLogoUrl).toBe('');
    expect(migrateSettings({ brandLogoUrl: 'data:application/pdf;base64,' }).brandLogoUrl).toBe('');
    expect(migrateSettings({ brandLogoUrl: 42 }).brandLogoUrl).toBe('');
    expect(
      migrateSettings({
        brandLogoUrl: 'data:image/png;base64,' + 'A'.repeat(BRAND_LOGO_MAX_CHARS),
      }).brandLogoUrl,
    ).toBe('');
    // Absent key (settings written before the feature) is the default, not undefined.
    expect(migrateSettings({}).brandLogoUrl).toBe('');
  });
});

describe('isBrandLogoDataUrl', () => {
  it('accepts only inline image data URLs within the ceiling', () => {
    expect(isBrandLogoDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(true);
    expect(isBrandLogoDataUrl('')).toBe(false);
    expect(isBrandLogoDataUrl('/logo.png')).toBe(false);
    expect(isBrandLogoDataUrl(null)).toBe(false);
  });
});

describe('appearance prefs', () => {
  it('round-trips valid values and applies them as <html> attributes', () => {
    writeSettings({
      ...DEFAULT_SETTINGS,
      textSize: 'lg',
      reduceMotion: true,
      cornerStyle: 'sharp',
    });
    const reread = readSettings();
    expect(reread.textSize).toBe('lg');
    expect(reread.reduceMotion).toBe(true);
    expect(reread.cornerStyle).toBe('sharp');
    expect(document.documentElement.getAttribute('data-text-size')).toBe('lg');
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduced');
    expect(document.documentElement.getAttribute('data-radius')).toBe('sharp');
  });

  it('falls back to default attributes for default prefs', () => {
    writeSettings({ ...DEFAULT_SETTINGS });
    expect(document.documentElement.getAttribute('data-text-size')).toBe('md');
    expect(document.documentElement.getAttribute('data-motion')).toBe('full');
    expect(document.documentElement.getAttribute('data-radius')).toBe('rounded');
  });
});

describe('sanitizeNotificationPrefs', () => {
  it('repairs a partially-synced prefs object', () => {
    const prefs = sanitizeNotificationPrefs({ overdueHours: 12, categories: { due: false } });
    expect(prefs.overdueHours).toBe(12);
    expect(prefs.categories.due).toBe(false);
    // Keys a newer version added are filled from the defaults, never undefined.
    expect(prefs.channels.desktop).toBe(DEFAULT_NOTIFICATION_PREFS.channels.desktop);
    expect(prefs.draftHours).toBe(DEFAULT_NOTIFICATION_PREFS.draftHours);
  });

  it('clamps a hand-edited threshold instead of silencing alerts', () => {
    expect(sanitizeNotificationPrefs({ overdueHours: 99999 }).overdueHours).toBe(336);
    expect(sanitizeNotificationPrefs({ dueDays: 0 }).dueDays).toBe(1);
    expect(sanitizeNotificationPrefs({ draftHours: 'abc' }).draftHours).toBe(
      DEFAULT_NOTIFICATION_PREFS.draftHours,
    );
  });

  it('treats a non-object value as no preferences at all', () => {
    expect(sanitizeNotificationPrefs('nope')).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(sanitizeNotificationPrefs(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});

describe('notification prefs round-trip through storage', () => {
  it('survives a write and read', () => {
    const prefs = sanitizeNotificationPrefs({ dueDays: 3, channels: { desktop: true } });
    writeSettings({ ...DEFAULT_SETTINGS, notificationPrefs: prefs });
    const reread = readSettings();
    expect(reread.notificationPrefs.dueDays).toBe(3);
    expect(reread.notificationPrefs.channels.desktop).toBe(true);
  });

  it('drops channel keys the app no longer delivers through', () => {
    // The whitelist in sanitizeNotificationPrefs is what stops a stored document
    // from an older build re-adding a mail or messaging button that no longer
    // exists anywhere in the UI.
    const prefs = sanitizeNotificationPrefs({
      channels: { email: true, sms: true, whatsapp: true },
    });
    writeSettings({ ...DEFAULT_SETTINGS, notificationPrefs: prefs });
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!);
    expect(stored.notificationPrefs.channels).toEqual({ desktop: false });
  });
});
