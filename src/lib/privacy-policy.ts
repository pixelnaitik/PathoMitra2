/**
 * Privacy-policy content for PathoMitra.
 *
 * Kept separate from `components/PrivacyPolicy.tsx` (which holds the React
 * components) so a component file does not also export plain constants — mixing
 * the two breaks React Fast Refresh.
 *
 * The wording must describe the app as it is actually built. Every claim here is
 * checkable against the code, and three of them are load-bearing for the Google
 * Play Data Safety declaration:
 *   - no INTERNET permission  → android/app/src/main/AndroidManifest.xml
 *   - no analytics/ad SDKs    → package.json dependencies
 *   - deletion available in-app → Settings → Security → eraseAllData()
 * If you change any of those, change this file in the same commit. The static
 * page under `privacy-site/` is generated from these sections, so the hosted
 * policy and the in-app policy cannot drift apart.
 */

/**
 * Both values come from the build environment so a placeholder can never reach a
 * submission unnoticed. `scripts/check-release-config.mjs` fails `npm run
 * build:android` if either is unset or still on the placeholder below — Google
 * Play rejects an app handling health data whose privacy contact is unreachable
 * or whose policy URL is not the developer's own.
 *
 * Read through a guard rather than `import.meta.env` directly: `scripts/build-privacy-site.ts`
 * imports this module under Node to generate the hosted page, and there
 * `import.meta.env` is undefined — an unguarded access would throw at build time
 * instead of falling back to the placeholder the guard below detects.
 */
const buildEnv = ((import.meta as unknown as { env?: ImportMetaEnv }).env ?? {}) as ImportMetaEnv;

export const PRIVACY_CONTACT_EMAIL =
  (buildEnv.VITE_SUPPORT_EMAIL ?? '').trim() || 'set-VITE_SUPPORT_EMAIL@example.invalid';

/** Canonical, publicly reachable location of this policy. */
export const PRIVACY_POLICY_URL =
  (buildEnv.VITE_PRIVACY_URL ?? '').trim() || 'set-VITE_PRIVACY_URL@example.invalid';

/** Bump this whenever a section changes, and re-date it at submission. */
export const PRIVACY_LAST_UPDATED = '11 October 2026';

/**
 * Reserved, never-resolvable top-level domains (RFC 2606 / RFC 6761).
 * A contact or policy URL on one of these can never be reached, so it is a
 * placeholder no matter how much it looks like a brand domain — `pathomitra.test`
 * passed the previous `.invalid`-only test and shipped inside a signed APK.
 */
const RESERVED_TLD_SUFFIXES = ['.test', '.invalid', '.example', '.localhost', '.local'];

/** Literal placeholder hosts, kept in step with scripts/check-release-config.mjs. */
const PLACEHOLDER_HOSTS = ['your-domain', 'your-lab-domain', 'example.com', 'localhost'];

/**
 * True for a host that can never serve a real policy or receive mail.
 *
 * Exported (rather than folded into `hasPlaceholderPrivacyContact`) so it can be
 * unit-tested without depending on whatever `.env` happens to contain — the
 * detection itself is the thing that regressed.
 */
export function isPlaceholderAuthority(authority: string): boolean {
  const host = authority.toLowerCase().replace(/^www\./, '');
  return (
    RESERVED_TLD_SUFFIXES.some(suffix => host.endsWith(suffix)) ||
    PLACEHOLDER_HOSTS.some(placeholder => host.includes(placeholder))
  );
}

/** True while either value is still a placeholder — used by the release guard. */
export function hasPlaceholderPrivacyContact(): boolean {
  // Email: everything after the last @. URL: the hostname, port stripped.
  const emailHost = PRIVACY_CONTACT_EMAIL.slice(PRIVACY_CONTACT_EMAIL.lastIndexOf('@') + 1);
  const urlHost = PRIVACY_POLICY_URL.replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0];
  return (
    PRIVACY_CONTACT_EMAIL.endsWith('.invalid') ||
    PRIVACY_POLICY_URL.endsWith('.invalid') ||
    isPlaceholderAuthority(emailHost) ||
    isPlaceholderAuthority(urlHost)
  );
}

export interface PrivacySection {
  heading: string;
  body: string[];
}

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    heading: '1. Who we are and what this policy covers',
    body: [
      'PathoMitra ("the app") is a laboratory information console for professional use by pathology labs and their authorised staff. It is not a consumer health app, it is not offered to patients directly, and it is not a diagnostic device — it stores, formats and prints the data a laboratory enters into it.',
      'The app is built to run entirely offline. The Android release does not request the INTERNET permission, so it has no ability to send your data, or your patients\u2019 data, over a network.',
      'This policy covers personal and health information processed by the software. It does not cover the laboratory\u2019s own professional obligations, which remain yours.',
    ],
  },
  {
    heading: '2. Data the app processes',
    body: [
      'While you use the app, it stores the records you enter: patient identifiers (name, age, gender, phone, address), referring-doctor details, specimen and test information, pathology findings and report contents, and billing or invoice records.',
      'This is personal and health information about your patients. You (the laboratory) are the data controller — under India\u2019s Digital Personal Data Protection Act, 2023 the Data Fiduciary — for that information. The app is a processing tool you operate; the developer neither receives nor can access these records.',
      'The app holds one local operator account. It records that operator\u2019s display name and the issue time on each report, so a document can be traced to whoever issued it on this device.',
    ],
  },
  {
    heading: '3. Where data is stored, and how it is protected',
    body: [
      'Every clinical record — patients, referring doctors, reports, notes and invoices — is kept on your own device in a local SQLite database encrypted with SQLCipher (AES-256). The encryption key is randomly generated on first run and stored in the Android keystore, which is backed by hardware. Because the key is held by the device rather than derived from your passcode, the database stays encrypted even when the app is locked.',
      'Your lab settings, any custom tests you add, and which alerts you have already read are held in the app\u2019s own private storage area rather than in that encrypted database. They are still unreachable by any other app on an un-rooted device, and they hold no patient results — but they are not AES-256 encrypted, and this policy says so rather than implying that every byte in the app sits inside SQLCipher.',
      'Your unlock credential is stored as a PBKDF2-SHA256 hash with a random per-account salt — never as plaintext. Biometric or screen-lock unlock is performed by the Android operating system; no biometric sample is read by, or transmitted to, this app.',
      'The passcode and biometric unlock gate access to the app\u2019s interface. After five consecutive failed attempts the app enforces a rising lockout delay, and it re-locks automatically after a period of inactivity you can set yourself — the same countdown also runs while the app is in the background, so a console left open on the bench is still covered.',
      'The following deliberately leave the encrypted database, and only when you ask for them: exported report PDFs, CSVs and diagnostics logs, which the app writes to its own private storage by default; and any file you hand to another app through the Android share sheet, which is then governed by that app\u2019s policy. If you turn on Settings \u2192 Data \u2192 "Save exports to Documents", those exported files become readable by other apps and file managers on the device.',
      'Alerts are delivered as system banners and nothing else. A banner is posted by your own device or browser, on the same device the record is already open on, and only if you switch banners on in Settings \u2192 Notifications. The app previously offered Email, SMS and WhatsApp buttons that built a mailto:, sms: or wa.me message containing the alert text; those were removed, so no alert text is ever handed to a third-party messaging or mail app by this feature.',
      'Android auto-backup is disabled and device-to-device transfer is excluded for every storage domain, so the clinical database is not copied to Google One or to a replacement phone by a setup wizard.',
    ],
  },
  {
    heading: '4. What we do not collect or share',
    body: [
      'No advertising, analytics, crash-reporting, social, location or other third-party SDK is bundled in the app. There is no measurement ID, no ad identifier and no tracker.',
      'The app requests no dangerous Android permissions: no camera, microphone, location, contacts, SMS, call log or external storage permission.',
      'Error capture is on-device only. Failures are kept in a local ring buffer you can read, save or clear in Settings \u2192 Data; the reporting hook that would upload them is intentionally empty, and patient identifiers are redacted before an error is even recorded.',
      'We do not sell, rent, transmit, back up or otherwise disclose your data. Because the app holds no network permission, there is no pathway for data to leave the device on its own.',
    ],
  },
  {
    heading: '5. Legal basis and your regulatory position',
    body: [
      'For users in India: the app is the Data Processor and you are the Data Fiduciary for patient data. Consent, notice, data-retention limits, breach reporting and the appointment of a Grievance Officer are your obligations as the laboratory, not something this software can discharge for you. The app supports them by keeping records on your device, deletable by you.',
      'For users in the EU/UK (GDPR) or California (CCPA/CPRA): the developer is not a controller or processor of patient data and receives no personal data at all, so no international transfer occurs and no sale or sharing of personal information takes place. There is nothing to opt out of, because nothing is collected.',
      'This app is not certified as HIPAA-compliant, NABL-accredited, ISO-certified, CE-marked or SOC 2 audited, and it makes no such claim about itself or about any laboratory. Accreditation belongs to the laboratory and appears on reports only if the laboratory enters and attests to it in Settings.',
    ],
  },
  {
    heading: '6. Retention, export and deletion',
    body: [
      'The app sets no retention period and never deletes records on its own: your data lives on the device until you act. There is no server-side copy that could outlive it.',
      'You can export the data you entered at any time — per-report PDFs, list CSVs, and full database snapshots from Settings → Data → Backup — and restore a snapshot onto a device. A snapshot is sealed with a passphrase you choose (PBKDF2-SHA256 + AES-256-GCM) before it is written, so a copy that leaves this device does not carry readable patient records. There is no recovery: the passphrase is never stored on the device and cannot be reset, and a snapshot you have lost the passphrase for cannot be opened. Backing up unencrypted is still available as an explicit, per-backup choice — the app does not quietly make that decision for you.',
      'To remove everything permanently, use Settings \u2192 Security \u2192 "Erase all data & delete account". It wipes the local clinical database and the account in one action, and cannot be undone. Individual patients, reports and invoices can also be deleted separately.',
      'Uninstalling the app removes the local database. Because Android backup is disabled, no copy survives in the cloud.',
    ],
  },
  {
    heading: '7. Your device, your responsibility',
    body: [
      'These protections depend on the device itself. Keep the screen lock enabled, do not root or jailbreak a machine that holds patient records, lock the app before handing a phone to anyone, and keep backup snapshots somewhere you control rather than in shared storage.',
    ],
  },
  {
    heading: '8. Children\u2019s data',
    body: [
      'The app is a professional tool for laboratory staff and is not directed at children or at the general public. A laboratory may legitimately record the health data of a minor patient; that processing is the laboratory\u2019s responsibility under its own consent and notice obligations, and the app treats such records exactly like any other — stored locally, encrypted, never transmitted.',
    ],
  },
  {
    heading: '9. Changes to this policy',
    body: [
      'This policy is updated as the app evolves. The version date above marks the current text, the copy inside the app always reflects what that build actually does, and any change that increases data collection will be announced in-app before it takes effect.',
    ],
  },
  {
    heading: '10. Contact',
    body: [
      `Privacy and support questions can be sent to ${PRIVACY_CONTACT_EMAIL}.`,
      `The current version of this policy is published at ${PRIVACY_POLICY_URL}.`,
    ],
  },
];
