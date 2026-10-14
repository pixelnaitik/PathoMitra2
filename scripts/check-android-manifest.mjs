#!/usr/bin/env node
/**
 * Post-build artifact guard: prove the release bundle is the app we think it is.
 *
 * `check-release-config.mjs` guards the inputs and `check-native-assets.mjs`
 * guards the copied web assets, but nothing asserted anything about the merged
 * manifest — the one file Google Play actually reads. Two incidents made that
 * gap concrete:
 *
 *   1. An AAB built before the PathLab OS -> PathoMitra rebrand stayed in
 *      `build/outputs/bundle/release/` carrying `com.healthcareos.app`. Uploading
 *      it would have published the wrong application identity under the new
 *      listing, and a plain file-name check cannot tell it from a good bundle.
 *   2. The whole "no INTERNET permission" story is what the Data Safety answers
 *      rest on. A future dependency that quietly contributes it (any plugin
 *      manifest, any `cap sync` of a networked SDK) invalidates every "nothing is
 *      transmitted" claim in the app and in the listing — and Gradle merges
 *      manifests silently, so nothing would fail.
 *
 * So this reads the merged *release* manifest Gradle produced and asserts the
 * identity, the permission set and the security flags. Run it after
 * `npm run android:aab` (that is what generates the file).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const EXPECTED_PACKAGE = 'com.pathomitra.app';

/**
 * `POST_NOTIFICATIONS` is deliberately NOT forbidden: the notification centre
 * shows local banners, and on API 33+ that needs this permission. Neither are
 * `WAKE_LOCK` / `RECEIVE_BOOT_COMPLETED`, which `@capacitor/local-notifications`
 * contributes for scheduled and surviving-a-reboot alerts. None of them break the
 * offline promise — they are local alarm plumbing — but they are user-facing
 * enough (a runtime consent prompt, a boot receiver, a wake lock) to need a
 * permission declaration in the Play Console, so they are listed here with the
 * plugin that pulls them in rather than left for a `cap sync` to introduce
 * silently.
 */

/**
 * Everything the merged release manifest is allowed to declare. Add a permission
 * here only with a written user-facing justification in docs/play-listing.md —
 * the point of an allow-list rather than a block-list is that a new permission
 * has to be *chosen* deliberately, by name, in a diff someone reviews.
 */
const ALLOWED_PERMISSIONS = new Set([
  // Haptic confirmation on report issue and destructive actions (lib/haptics.ts).
  'android.permission.VIBRATE',
  // Unlock gate for a device holding PHI; performed by the OS, no sample is read.
  'android.permission.USE_BIOMETRIC',
  // Same, for API 28 (the minSdk) which predates USE_BIOMETRIC.
  'android.permission.USE_FINGERPRINT',
  // Self-defined signature-level permission added by AndroidX startup/profileinstaller.
  `${EXPECTED_PACKAGE}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`,
  // --- contributed by @capacitor/local-notifications (alert banners) ---
  // Runtime-consent prompt on API 33+ so an overdue-report banner can be shown.
  'android.permission.POST_NOTIFICATIONS',
  // Keeps a scheduled banner on time while the app is closed.
  'android.permission.WAKE_LOCK',
  // Re-publishes pending banners after a reboot (plugin's BOOT_COMPLETED receiver).
  'android.permission.RECEIVE_BOOT_COMPLETED',
]);

/** Permissions that would break the offline promise or trip Play's scans. */
const FORBIDDEN_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.READ_CONTACTS',
  'android.permission.WRITE_CONTACTS',
  'android.permission.READ_SMS',
  'android.permission.SEND_SMS',
  'android.permission.RECEIVE_SMS',
  'android.permission.READ_CALL_LOG',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.BIND_ACCESSIBILITY_SERVICE',
  'com.google.android.gms.permission.AD_ID',
  'android.permission.FOREGROUND_SERVICE',
  // Play treats exact-alarm scheduling as a sensitive permission needing a declared
  // use case, and the app does not need it: banners are posted when an alert is
  // derived, not fired at a wall-clock instant. AndroidManifest.xml strips both with
  // tools:node="remove", so a re-appearing one is a regression, not a maybe.
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.REQUEST_INSTALL_PACKAGES',
];

const androidDir = path.resolve(process.cwd(), 'android');
const appDir = path.join(androidDir, 'app');

/**
 * Gradle writes the merged manifest to a few places depending on the task that
 * ran; prefer the packaged one (closest to what ships) and fall back.
 */
const MANIFEST_CANDIDATES = [
  'build/intermediates/packaged_manifests/release/processReleaseManifestForPackage/AndroidManifest.xml',
  'build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml',
  'build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml',
];

function findMergedManifest() {
  for (const relative of MANIFEST_CANDIDATES) {
    const direct = path.join(appDir, relative);
    if (fs.existsSync(direct)) return direct;
  }
  // Last resort: glob the release intermediates, because the trailing task-name
  // segment has changed across AGP versions before.
  const root = path.join(appDir, 'build', 'intermediates');
  if (!fs.existsSync(root)) return null;
  for (const dir of fs.readdirSync(root)) {
    if (!dir.startsWith('merged_manifest') && !dir.startsWith('packaged_manifest')) continue;
    const releaseDir = path.join(root, dir, 'release');
    if (!fs.existsSync(releaseDir)) continue;
    for (const task of fs.readdirSync(releaseDir)) {
      const candidate = path.join(releaseDir, task, 'AndroidManifest.xml');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const problems = [];

const manifestPath = findMergedManifest();
if (!manifestPath) {
  console.error(
    '\n✗ Could not find a merged RELEASE AndroidManifest.xml under android/app/build/intermediates.\n' +
      '  Build the bundle first:  npm run sync:android && npm run android:aab\n',
  );
  process.exit(1);
}

const xml = fs.readFileSync(manifestPath, 'utf8');
const rel = path.relative(process.cwd(), manifestPath);

// ---- identity -------------------------------------------------------------
const pkg = /<manifest[^>]*\bpackage="([^"]+)"/.exec(xml)?.[1];
if (pkg !== EXPECTED_PACKAGE) {
  problems.push(
    `merged manifest declares package="${pkg ?? '(none)'}", expected "${EXPECTED_PACKAGE}". ` +
      'A pre-rebrand bundle would publish the wrong app — rebuild with npm run verify:android.',
  );
}

const versionName = /android:versionName="([^"]+)"/.exec(xml)?.[1];
const versionCode = /android:versionCode="([^"]+)"/.exec(xml)?.[1];
const pkgJsonPath = path.resolve(process.cwd(), 'package.json');
const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
const [major, minor, patch] = String(pkgJson.version)
  .replace(/^v/, '')
  .split('-')[0]
  .split('.')
  .map(Number);
const expectedCode = String(major * 1000000 + minor * 1000 + patch);

if (versionName !== pkgJson.version) {
  problems.push(
    `versionName "${versionName ?? '(none)'}" != package.json version "${pkgJson.version}" — ` +
      'the bundle was built from a stale web asset copy.',
  );
}
if (versionCode !== expectedCode) {
  problems.push(
    `versionCode ${versionCode ?? '(none)'} != ${expectedCode} derived from package.json ` +
      `(${pkgJson.version}). Play rejects a duplicate versionCode, and a stale one means this ` +
      'is not the build you just versioned.',
  );
}

// ---- permissions ----------------------------------------------------------
const declared = [...xml.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map(m => m[1]);

for (const forbidden of FORBIDDEN_PERMISSIONS) {
  if (declared.includes(forbidden)) {
    problems.push(
      `${forbidden} is declared. This app's entire Data Safety position is "nothing is ` +
        'transmitted and no dangerous permission is requested" — that permission breaks it.',
    );
  }
}

for (const name of declared) {
  if (!ALLOWED_PERMISSIONS.has(name)) {
    problems.push(
      `unexpected permission "${name}" — not on the allow-list. If it is genuinely needed, add ` +
        'it to scripts/check-android-manifest.mjs with a user-facing justification in docs/play-listing.md.',
    );
  }
}

if (!declared.includes('android.permission.INTERNET')) {
  // Positive assertion of the negative: the offline claim depends on this being true.
  problems.length === 0 && console.log('  · no INTERNET permission — offline claim is provable');
}

// ---- application flags ----------------------------------------------------
const appTag = /<application[^>]*>/.exec(xml)?.[0] ?? '';
if (/android:debuggable="true"/.test(appTag)) {
  problems.push(
    'release build is android:debuggable="true" — an open invitation to attach a debugger, and a Play rejection.',
  );
}
if (!/android:allowBackup="false"/.test(appTag)) {
  problems.push(
    'android:allowBackup is not false — the encrypted clinical database could ride into a Google One backup.',
  );
}
if (!/android:dataExtractionRules="@xml\/data_extraction_rules"/.test(appTag)) {
  problems.push(
    'android:dataExtractionRules is missing — allowBackup="false" alone does not stop device-to-device transfer.',
  );
}
if (/android:usesCleartextTraffic="true"/.test(appTag)) {
  problems.push('android:usesCleartextTraffic="true" in a release build.');
}

// ---- launcher / export surface -------------------------------------------
const exportedActivities = [
  ...xml.matchAll(/<activity[^>]*android:name="([^"]+)"[^>]*android:exported="true"/g),
  ...xml.matchAll(/<activity[^>]*android:exported="true"[^>]*android:name="([^"]+)"/g),
].map(m => m[1]);
const allowedExported = new Set([`${EXPECTED_PACKAGE}.MainActivity`]);
for (const activity of exportedActivities) {
  if (!allowedExported.has(activity)) {
    problems.push(
      `exported activity "${activity}" is not on the allow-list — every exported component is an attack surface.`,
    );
  }
}
if (/<category\s+android:name="android\.intent\.category\.BROWSABLE"/.test(xml)) {
  problems.push(
    'a BROWSABLE intent filter means another app can launch this one with a URL — deep-link input is untrusted data.',
  );
}

// ---- Cordova leftover -----------------------------------------------------
// Reported, never fatal. `res/xml/config.xml` is scaffolding that `npx cap sync`
// writes every time (it belongs to the generated `capacitor-cordova-android-plugins
//` module, which is also regenerated), so hand-editing it cannot survive a sync —
// a 2.5.2 test build proved that. It is only read by Cordova's ConfigXmlParser,
// no Cordova plugin is installed here (`assets/public/cordova_plugins.js` is empty),
// and with INTERNET absent the wildcard has no possible effect. The real
// enforcement is the INTERNET assertion above, which is a hard failure.
const cordovaWarnings = [];
const cordovaConfig = path.join(appDir, 'src', 'main', 'res', 'xml', 'config.xml');
if (fs.existsSync(cordovaConfig)) {
  const config = fs.readFileSync(cordovaConfig, 'utf8');
  if (/<access\s+origin="[*"]/.test(config)) {
    cordovaWarnings.push(
      'res/xml/config.xml (toolchain-generated) carries <access origin="*" /> — inert while ' +
        'INTERNET is absent and no Cordova plugin is installed. Mention it if Play asks, or drop ' +
        'the cordova module for good.',
    );
  }
}

if (problems.length > 0) {
  console.error(`\n✗ Release manifest check FAILED (${rel}).\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\n  Do not upload this artifact. Rebuild:  npm run sync:android && npm run android:aab\n',
  );
  process.exit(1);
}

console.log(
  `✓ Release manifest OK — ${EXPECTED_PACKAGE} v${versionName} (${versionCode}), ` +
    `${declared.length} permission(s), not debuggable, backups excluded.\n  Source: ${rel}`,
);
for (const warning of cordovaWarnings) console.warn(`  ⚠ ${warning}`);
