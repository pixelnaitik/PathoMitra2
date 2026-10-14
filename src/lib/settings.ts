/**
 * Single source of truth for locally-stored lab settings and custom tests.
 *
 * Historically these values were read/written directly from localStorage in
 * SettingsPage, ReportsPage and DashboardLayout (each with its own copy of the
 * migration logic). All of that now lives here:
 *
 *   - readSettings() / writeSettings()  -> 'pathologyos_settings'
 *   - readCustomTests() / writeCustomTests() -> 'custom_pathology_tests'
 *
 * writeSettings() applies the theme and dispatches the 'settings-updated'
 * event so already-mounted components (sidebar avatar, theme) stay in sync.
 */
import { applyAppearance, applyTheme } from './theme';
import { RECOMMENDED_LAYOUT_DEFAULTS } from './report-layout';
import { REPORT_FIELDS, sanitizeFieldValue, type LayoutFieldKey } from './report-layout-spec';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from './notification-engine';
import type { PathologyTest } from './pathology-tests';

export const SETTINGS_STORAGE_KEY = 'pathologyos_settings';
export const CUSTOM_TESTS_STORAGE_KEY = 'custom_pathology_tests';

/**
 * Hard ceiling for the stored brand-logo data URL (~2 MB of text). The upload
 * path resizes to 512 px before encoding, so a normal logo lands far under
 * this; the limit exists to keep one blob from eating the localStorage quota
 * and to bound what the pre-JS splash bootstrap in index.html will accept.
 * That bootstrap mirrors both rules here — a value that passes there is
 * always a value `migrateSettings` would keep.
 */
export const BRAND_LOGO_MAX_CHARS = 2_000_000;

/**
 * The custom app logo is stored *inline* as an image data URL, never as a
 * remote address: the build is offline by posture (the APK ships without
 * INTERNET), so a URL would be a broken promise and a tracking vector. This
 * is the single acceptance test every consumer (splash bootstrap, favicon,
 * UI) applies before rendering the value.
 */
export function isBrandLogoDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('data:image/') &&
    value.length > 0 &&
    value.length <= BRAND_LOGO_MAX_CHARS
  );
}

/**
 * Ceiling for the stored share-letterhead data URL, sized to the 4 MB file the
 * upload form already refuses (base64 text is ~4/3 of the bytes).
 */
export const LETTERHEAD_MAX_CHARS = 5_600_000;

/**
 * The share-mode letterhead is drawn on every page of the report a lab hands
 * over, so what is stored must be an image this app can actually draw: never a
 * remote address (the build ships without INTERNET, and a URL is a tracking
 * vector), never an arbitrary string from a restored backup or a hand-edited
 * store.
 *
 * The only thing that used to stop a bad value was a `try/catch` around
 * `addImage`, which failed as a console error at print time — the moment a lab
 * cannot afford. This is the same rule applied where the value is written.
 */
export function isLetterheadDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('data:image/') &&
    value.length > 0 &&
    value.length <= LETTERHEAD_MAX_CHARS
  );
}

/**
 * Fired by `writeSettings` / `writeCustomTests` so the cloud-sync layer
 * (lib/settings-sync) can react without this module importing Firebase — that
 * keeps settings.ts free of network dependencies and trivially unit-testable.
 */
export const SETTINGS_UPDATED_EVENT = 'settings-updated';
export const CUSTOM_TESTS_UPDATED_EVENT = 'custom-tests-updated';

export interface LabSettings {
  name: string;
  email: string;
  phone: string;
  labName: string;
  address: string;
  /**
   * What the Notification Center actually evaluates: which categories alert,
   * how long a lab has before something counts as late, and whether an alert
   * may also appear as a system banner.
   *
   * There used to be `emailNotifications` / `smsNotifications` mirrors beside
   * this, and `channels.email` / `.sms` / `.whatsapp` inside it. The mail,
   * messaging and WhatsApp compose buttons were removed on 2026-10-11 at the
   * lab's request, so nothing read them any more — the exact state this field's
   * predecessor was built to escape. A stored document that still carries those
   * keys is unaffected: they are ignored, and `sanitizeNotificationPrefs`
   * rebuilds the shape from the defaults.
   */
  notificationPrefs: NotificationPrefs;
  /**
   * Seconds of inactivity after which the console re-locks itself. 0 means
   * "never". Leaving the app starts this same countdown rather than locking on
   * the spot — see `lib/session-lock` for why the instant lock was reversed.
   */
  autoLockSeconds: number;
  reportTemplate: string;
  shareTemplate: string;
  themeId: string;
  themeMode: string;
  /** Appearance: UI text scale — root font size step ('sm' | 'md' | 'lg'). */
  textSize: 'sm' | 'md' | 'lg';
  /** Appearance: collapse animations/transitions regardless of the OS preference. */
  reduceMotion: boolean;
  /** Appearance: collapse the frosted blur to solid surfaces regardless of the OS. */
  reduceTransparency: boolean;
  /** Appearance: corner rounding style — 'rounded' (default) or 'sharp'. */
  cornerStyle: 'rounded' | 'sharp';
  /** Feel: device vibration on presses and toast outcomes (native only). */
  hapticsEnabled: boolean;
  /**
   * Write exported PDFs/CSVs into shared `Documents` storage instead of the
   * app-private directory. Off by default: those files hold patient data in
   * plaintext, outside the SQLCipher database, and shared storage is readable by
   * other apps, file managers and media indexers. Labs that want to browse the
   * files themselves can opt in (Settings → Data & Diagnostics).
   */
  allowPublicExports: boolean;
  /**
   * Let the device capture this screen (Android's FLAG_SECURE cleared).
   * Default `false` = protected: screenshots, recordings, screen shares and the
   * Recents thumbnail show nothing, because every screen pairs a patient name
   * with their findings. The lab asked for capturable report screens, so this
   * exists as an opt-out rather than being hard-coded — the native window starts
   * protected in `MainActivity.onCreate`, and only an explicit `true` here clears
   * it (see lib/screenshot-protection).
   */
  screenshotsAllowed: boolean;
  reportMarginTop: number;
  reportMarginBottom: number;
  reportMarginLeft: number;
  reportMarginRight: number;
  shareMarginTop: number;
  shareMarginBottom: number;
  shareMarginLeft: number;
  shareMarginRight: number;
  reportTableBodyFontSize: number;
  shareTableBodyFontSize: number;
  reportTitleFontSize: number;
  patientInfoFontSize: number;
  patientLineHeight: number;
  reportSectionGap: number;
  tableHeaderFontSize: number;
  tableBodyFontSize: number;
  tableCellPadding: number;
  notesFontSize: number;
  footerFontSize: number;
  avatarSeed: string;
  sharingTemplateImage: string;
  /**
   * Uploaded app logo as an inline image data URL ('' = the built-in
   * microscope mark). Used by the splash screen, the sign-in tile, the tab
   * icon and every brand surface EXCEPT the logged-in Overview page, which
   * keeps the default microscope mark by owner decision (2026-10-11).
   */
  brandLogoUrl: string;
  /**
   * Legal footer credentials, supplied by the laboratory operator. Printing an
   * accreditation is opt-in and gated: nothing appears on a report unless
   * `accreditationAttestedAt` is non-empty *and* both the body and its number
   * are filled (see `lib/report-compliance`). Defaults are therefore empty.
   */
  accreditationBody: string;
  accreditationNumber: string;
  /** Statutory laboratory registration/licence number; a factual identifier. */
  licenceNumber: string;
  /**
   * ISO timestamp of the operator's one-time attestation that they hold the
   * accreditation above. Clearing it immediately stops the claim printing.
   */
  accreditationAttestedAt: string;
  /**
   * Stamped on every write; used as the last-write-wins token when the local
   * copy is reconciled against `labSettings/current` in Firestore.
   */
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_SETTINGS: LabSettings = {
  name: '',
  email: '',
  phone: '',
  labName: 'PathoMitra Lab',
  address: '',
  notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
  // 5 minutes — the owner's chosen bench default (2026-10-11): long enough to
  // read a report aloud without the console locking mid-sentence, short enough
  // that an abandoned desk is not an open patient record over lunch.
  autoLockSeconds: 300,
  // Report layout values come from the single shared source of truth in
  // lib/report-layout — never hard-code copies of them in UI components.
  ...RECOMMENDED_LAYOUT_DEFAULTS,
  themeId: 'navy',
  themeMode: 'light',
  textSize: 'md',
  reduceMotion: false,
  reduceTransparency: false,
  cornerStyle: 'rounded',
  hapticsEnabled: true,
  allowPublicExports: false,
  screenshotsAllowed: false,
  // Legacy field kept only as a fallback for older stored settings; the UI
  // edits reportTableBodyFontSize / shareTableBodyFontSize directly.
  tableBodyFontSize: RECOMMENDED_LAYOUT_DEFAULTS.tableBodyFontSize,
  avatarSeed: 'default',
  sharingTemplateImage: '',
  brandLogoUrl: '',
  accreditationBody: '',
  accreditationNumber: '',
  licenceNumber: '',
  accreditationAttestedAt: '',
};

/** Threshold bounds — a mistyped or hand-edited value must not silence alerts. */
const HOUR_LIMITS = { min: 1, max: 336 };
const DAY_LIMITS = { min: 1, max: 90 };

function clamp(value: unknown, fallback: number, limits: { min: number; max: number }): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.round(n)));
}

/**
 * Rebuild notification preferences from whatever is stored.
 *
 * `readSettings` merges stored values over defaults shallowly, so a stored
 * `notificationPrefs` that predates a newer key (or arrived as a partial through
 * cloud sync) would otherwise leave `undefined` in the UI and silently disable a
 * category. Every field is therefore taken from the stored object *only when it
 * has the right type*, and from the defaults otherwise — which also makes a
 * corrupt value (a string, an array, a JSON scalar) harmless rather than
 * spread-able. Channel keys the app no longer supports (`email`, `sms`,
 * `whatsapp`) are dropped here rather than carried forward, so an old document
 * cannot resurrect a delivery button that has been removed.
 */
export function sanitizeNotificationPrefs(raw: unknown): NotificationPrefs {
  const source = isRecord(raw) ? raw : {};
  const channels = isRecord(source.channels) ? source.channels : {};
  const categories = isRecord(source.categories) ? source.categories : {};
  const defaults = DEFAULT_NOTIFICATION_PREFS;
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;

  return {
    channels: {
      desktop: bool(channels.desktop, defaults.channels.desktop),
    },
    categories: {
      overdue: bool(categories.overdue, defaults.categories.overdue),
      draft: bool(categories.draft, defaults.categories.draft),
      amended: bool(categories.amended, defaults.categories.amended),
      due: bool(categories.due, defaults.categories.due),
    },
    // Thresholds fall back to the *defaults*, never to whatever the stored
    // object claimed: an out-of-bounds or non-numeric value is unusable.
    overdueHours: clamp(source.overdueHours, defaults.overdueHours, HOUR_LIMITS),
    draftHours: clamp(source.draftHours, defaults.draftHours, HOUR_LIMITS),
    dueDays: clamp(source.dueDays, defaults.dueDays, DAY_LIMITS),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Clamp every report-layout number on the way through the store boundary.
 *
 * The sliders in Settings already enforce these ranges, and the PDF pipeline
 * refuses a sheet with no printable area — but nothing bounded the *stored*
 * values. A hand-edited or corrupted document could therefore put the lab in a
 * state where every print, preview and share is refused, with no way back except
 * editing each of eighteen fields by hand. Clamping on read (and the values
 * defaulting to the recommended ones when a field is not a number at all) keeps
 * the store inside the range the renderer assumes.
 */
function clampLayoutFields(s: Record<string, unknown>): void {
  for (const key of Object.keys(REPORT_FIELDS) as LayoutFieldKey[]) {
    if (s[key] === undefined) continue;
    s[key] = sanitizeFieldValue(REPORT_FIELDS[key], Number(s[key]));
  }
}

/**
 * Upgrade legacy stored values to the current defaults. Safe to run on every
 * read — it only rewrites values that match known old defaults.
 */
export function migrateSettings(parsed: Record<string, unknown>): Record<string, unknown> {
  const s = { ...parsed };
  // Auto-migrate old default margins (20/10/40/15) to new standard values (50/20/8/15)
  if (s.reportMarginTop === 20 || s.reportMarginTop === 40) s.reportMarginTop = 50;
  if (s.reportMarginBottom === 10) s.reportMarginBottom = 20;
  if (s.reportMarginLeft === 15) s.reportMarginLeft = 8;

  const bodyFont = (s.tableBodyFontSize as number) ?? DEFAULT_SETTINGS.tableBodyFontSize;
  if (s.reportTableBodyFontSize === undefined) s.reportTableBodyFontSize = bodyFont;
  if (s.shareTableBodyFontSize === undefined) s.shareTableBodyFontSize = bodyFont;
  clampLayoutFields(s);
  if (s.themeMode === undefined) s.themeMode = DEFAULT_SETTINGS.themeMode;
  // Appearance prefs are enumerated — a corrupt or hand-edited stored value
  // must not stick (an unknown textSize would silently disable the scale).
  if (s.textSize !== 'sm' && s.textSize !== 'md' && s.textSize !== 'lg')
    s.textSize = DEFAULT_SETTINGS.textSize;
  if (typeof s.reduceMotion !== 'boolean') s.reduceMotion = DEFAULT_SETTINGS.reduceMotion;
  if (typeof s.reduceTransparency !== 'boolean')
    s.reduceTransparency = DEFAULT_SETTINGS.reduceTransparency;
  if (typeof s.hapticsEnabled !== 'boolean') s.hapticsEnabled = DEFAULT_SETTINGS.hapticsEnabled;
  // A leaked PHI-export preference must fail closed, never open.
  if (typeof s.allowPublicExports !== 'boolean')
    s.allowPublicExports = DEFAULT_SETTINGS.allowPublicExports;
  // Same rule for screen capture: a missing or corrupt value keeps the window
  // protected, because the native default is protection and a stale stored object
  // must not silently downgrade it.
  if (typeof s.screenshotsAllowed !== 'boolean')
    s.screenshotsAllowed = DEFAULT_SETTINGS.screenshotsAllowed;
  if (s.cornerStyle !== 'rounded' && s.cornerStyle !== 'sharp')
    s.cornerStyle = DEFAULT_SETTINGS.cornerStyle;
  // The brand logo only survives as an inline image data URL within the size
  // ceiling: a remote URL, a non-string, or an oversized blob (hand-edited or
  // corrupt) falls back to the built-in microscope rather than being rendered
  // or bloating every later write.
  if (!isBrandLogoDataUrl(s.brandLogoUrl)) s.brandLogoUrl = DEFAULT_SETTINGS.brandLogoUrl;
  // The share letterhead is an inline image or nothing at all. An empty string is
  // a meaningful value here ("no letterhead, use the plain template"), so only a
  // non-empty value that is not a drawable data URL is dropped.
  if (typeof s.sharingTemplateImage !== 'string') {
    s.sharingTemplateImage = DEFAULT_SETTINGS.sharingTemplateImage;
  } else if (s.sharingTemplateImage && !isLetterheadDataUrl(s.sharingTemplateImage)) {
    s.sharingTemplateImage = '';
  }
  // Legal-footer credentials are claims printed on a clinical document, so a
  // corrupt or hand-edited stored value is dropped rather than rendered, and an
  // attestation flag that is not a real timestamp disables the claim entirely.
  for (const key of [
    'accreditationBody',
    'accreditationNumber',
    'licenceNumber',
    'accreditationAttestedAt',
  ] as const) {
    const value = s[key];
    if (typeof value !== 'string') {
      s[key] = DEFAULT_SETTINGS[key];
    } else {
      s[key] = value.trim().slice(0, key === 'accreditationAttestedAt' ? 64 : 120);
    }
  }
  if (
    s.accreditationAttestedAt &&
    Number.isNaN(new Date(String(s.accreditationAttestedAt)).getTime())
  )
    s.accreditationAttestedAt = '';
  s.notificationPrefs = sanitizeNotificationPrefs(s.notificationPrefs);
  // Only the listed intervals are valid; an arbitrary stored number (a hand edit,
  // or a value from a build with different options) falls back to the default.
  if (![0, 30, 120, 300, 900].includes(safeInt(s.autoLockSeconds)))
    s.autoLockSeconds = DEFAULT_SETTINGS.autoLockSeconds;
  return s;
}

/** Small helper for the enumerated numeric prefs above. */
function safeInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : -1;
}

/** Read, migrate and merge stored settings with defaults. Never throws. */
export function readSettings(): LabSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = migrateSettings(JSON.parse(raw));
    return { ...DEFAULT_SETTINGS, ...parsed } as LabSettings;
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist settings, apply the theme and notify other mounted components. */
export function writeSettings(settings: LabSettings): void {
  const prefs = sanitizeNotificationPrefs(settings.notificationPrefs);
  // Clamp the layout numbers on the way out too: `migrateSettings` protects a
  // read, but a bad write must not be able to put an unprintable margin or a
  // 900 pt title into the store in the first place — that is the state where
  // every later print, preview and share is refused.
  const layout: Record<string, unknown> = { ...settings };
  clampLayoutFields(layout);
  const stamped: LabSettings = {
    ...settings,
    ...layout,
    notificationPrefs: prefs,
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(stamped));
  } catch (e) {
    console.error('SettingsContext: failed to persist settings', e);
  }
  applyTheme(stamped.themeId || 'navy', stamped.themeMode === 'dark' ? 'dark' : 'light');
  applyAppearance(stamped);
  window.dispatchEvent(new Event(SETTINGS_UPDATED_EVENT));
}

/** Read stored custom pathology tests. Never throws. */
export function readCustomTests(): PathologyTest[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TESTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PathologyTest[]) : [];
  } catch (e) {
    return [];
  }
}

export function writeCustomTests(tests: PathologyTest[]): void {
  try {
    localStorage.setItem(CUSTOM_TESTS_STORAGE_KEY, JSON.stringify(tests));
  } catch (e) {
    console.error('SettingsContext: failed to persist custom tests', e);
  }
  window.dispatchEvent(new Event(CUSTOM_TESTS_UPDATED_EVENT));
}
