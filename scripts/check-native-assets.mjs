#!/usr/bin/env node
/**
 * Native-build guard: prove the APK is not carrying web-deployment files.
 *
 * `vite.config.ts` deletes these from `dist/` when VITE_TARGET=native, because
 * `cap sync android` copies `dist/` verbatim into the APK's assets. Without this
 * check the omission was invisible: a plain `vite build` (flag not set) produced
 * an APK containing robots.txt, sitemap.xml, sw.js, manifest.json and the
 * Cloudflare `_headers` file — the last of which declared Firebase/googleapis
 * `connect-src` origins inside an app whose Play Data Safety answer is "nothing
 * is transmitted". A stale web pipeline had quietly shipped into a clinical
 * Android build.
 *
 * The list must stay in step with WEB_ONLY_ASSETS in vite.config.ts. If the two
 * ever diverge, this script is the one that should fail.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FORBIDDEN_ASSETS = [
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  'sw.js',
  'manifest.json',
  'apple-touch-icon.png',
  '_headers',
  '_redirects',
];

const outDir = path.resolve(process.cwd(), 'dist');
/**
 * `--synced` is passed by `npm run sync:android` after `cap sync`, and also
 * turns on the check of what actually landed inside the Android project. Run
 * without it (straight after `vite build`) only `dist/` is inspected, because
 * the native assets directory still holds the previous sync at that point.
 */
const checkSynced = process.argv.includes('--synced');

function fail(messages) {
  console.error('\n✗ Native asset check failed.\n');
  for (const message of messages) console.error(`  ${message}`);
  console.error(
    '\n  Run the native build with:  npm run build:android' +
      '\n  (which sets VITE_TARGET=native so vite.config.ts strips these files).\n',
  );
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  fail([`dist/ does not exist — build before checking.`]);
}

// No VITE_TARGET assertion here on purpose: the presence of a forbidden file is
// the evidence that matters, and it is provable without depending on which shell
// variable the caller happened to export (cross-env only scopes the build step).
if (checkSynced && !fs.existsSync(path.join(outDir, 'assets'))) {
  fail(['dist/assets/ is missing — nothing was bundled.']);
}

const indexHtmlPath = path.join(outDir, 'index.html');
if (!fs.existsSync(indexHtmlPath)) {
  fail(['dist/index.html is missing — the build did not complete.']);
}

const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
if (/<link\s+rel=["']manifest["']/i.test(indexHtml)) {
  fail([
    'dist/index.html still links a web app manifest.',
    '    The WebView would request a file the native build deletes.',
  ]);
}

const present = FORBIDDEN_ASSETS.filter(name => fs.existsSync(path.join(outDir, name)));
if (present.length > 0) {
  fail([
    `dist/ still contains web-deployment artefacts: ${present.join(', ')}`,
    ...present.map(name => `    - ${name}`),
  ]);
}

// Only after a sync: catch a name added to the Vite list but not here, or an
// old web build left behind by a `cap sync` that ran without the native flag.
const androidAssets = path.resolve(process.cwd(), 'android/app/src/main/assets/public');
if (checkSynced && fs.existsSync(androidAssets)) {
  const leaked = FORBIDDEN_ASSETS.filter(name => fs.existsSync(path.join(androidAssets, name)));
  if (leaked.length > 0) {
    fail([
      `android/app/src/main/assets/public/ still holds files from a previous web sync: ${leaked.join(', ')}`,
      ...leaked.map(name => `    - ${name}`),
      '    Re-run: npm run sync:android',
    ]);
  }
  const syncedHtml = fs.readFileSync(path.join(androidAssets, 'index.html'), 'utf8');
  if (/<link\s+rel=["']manifest["']/i.test(syncedHtml)) {
    fail(['the index.html inside the Android assets still links a web app manifest.']);
  }
}

/**
 * Reserved-TLD values inside the *bundled client*.
 *
 * `check-release-config.mjs` validates the environment before the build, but the
 * failure that actually shipped was the two guards disagreeing: `privacy@
 * pathomitra.test` and `https://policy.pathomitra.test/` satisfied every static
 * check (which only knew `example.invalid`) and were then inlined by Vite into
 * the release JS — so the signed APK advertised a privacy policy that can never
 * resolve. This is the second net: it reads the artifact rather than the config.
 *
 * The `set-VITE_*@example.invalid` literals are deliberately *not* flagged: they
 * are the in-code fallbacks in src/lib/privacy-policy.ts, present by design, and
 * `hasPlaceholderPrivacyContact()` treats them as the placeholder they are.
 */
const RESERVED_VALUE =
  /(?:https?:\/\/[^"'\s]*|[A-Za-z0-9._%+-]+@)[A-Za-z0-9.-]*\.(?:test|invalid|example|localhost|local)\b/g;
const KNOWN_FALLBACK = /set-VITE_[A-Z_]+@example\.invalid/;

function findReservedValues(dir) {
  if (!fs.existsSync(dir)) return [];
  const findings = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(js|html|css|json)$/.test(name)) continue;
    const file = path.join(dir, name);
    if (!fs.statSync(file).isFile()) continue;
    const text = fs.readFileSync(file, 'utf8');
    // Strip the known fallback literals so they cannot match at all.
    const scanned = text.replace(KNOWN_FALLBACK, 'FALLBACK_PLACEHOLDER');
    const matches = [...scanned.matchAll(RESERVED_VALUE)].map(m => m[0]);
    for (const value of [...new Set(matches)]) findings.push(`${name}: ${value}`);
  }
  return findings;
}

const bundleDirs = [path.join(outDir, 'assets'), outDir];
if (checkSynced) {
  bundleDirs.push(path.resolve(process.cwd(), 'android/app/src/main/assets/public/assets'));
}

const placeholderFindings = [];
for (const dir of bundleDirs) {
  for (const finding of findReservedValues(dir)) {
    // dist/ and dist/assets are both scanned; dedupe so a file is not reported twice.
    if (!placeholderFindings.includes(finding)) placeholderFindings.push(finding);
  }
}
if (placeholderFindings.length > 0) {
  // Same hatch as `check-release-config.mjs --allow-placeholder`, and the reason
  // it has to be an explicit env var rather than a silent pass: a device test build
  // is made before the real domain exists, so its bundle *does* contain the
  // placeholder — that is expected, and must stay impossible for a release build.
  if (process.env.PATHOMITRA_ALLOW_PLACEHOLDER_ASSETS === '1') {
    console.warn(
      '\n⚠ PATHOMITRA_ALLOW_PLACEHOLDER_ASSETS=1 — placeholder identity values left in the bundle:\n' +
        placeholderFindings.map(f => `    - ${f}`).join('\n') +
        '\n  TEST BUILD ONLY. This artifact cannot be submitted to Google Play.\n',
    );
  } else {
    fail([
      'the built bundle carries a placeholder privacy contact/policy URL on a reserved TLD —',
      'Google requires a publicly reachable policy, and Play cross-checks it against the app:',
      ...placeholderFindings.map(f => `    - ${f}`),
      '    Fix VITE_SUPPORT_EMAIL / VITE_PRIVACY_URL in .env and rebuild with npm run build:android.',
      '    (Device testing before the domain exists: npm run android:test-build)',
    ]);
  }
}

console.log('✓ Native asset check passed — dist/ carries no web-deployment artefacts.');
