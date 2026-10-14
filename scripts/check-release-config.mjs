#!/usr/bin/env node
/**
 * Pre-submission config guard.
 *
 * Google Play will not accept an app that handles health data if its privacy
 * policy URL is not reachable, not the developer's own, or names a contact nobody
 * monitors. Until now the only reminder was a code comment in
 * `src/lib/privacy-policy.ts` telling the author to replace the placeholder — and
 * a comment that survives `npm run build` is a rejection that survives review.
 *
 * So this fails the native build outright when the release identity is still
 * unset or obviously fake. It reads the same `.env` that Vite loads, so what it
 * checks is what ends up in the bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

// `quiet` suppresses dotenv's own log line, which otherwise drops a promotional
// tip into the middle of the release build output.
dotenv.config({ quiet: true, path: path.resolve(process.cwd(), '.env') });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_HTTPS = /^https:\/\/[^\s]+$/;

/** Domains that are never a real answer, plus the placeholder suffixes. */
const BLOCKED_HOSTS = [
  'example.invalid',
  'example.com',
  'localhost',
  'your-domain',
  'your-lab-domain',
];
const BLOCKED_URL_HOSTS = ['pages.dev', 'vercel.app', 'netlify.app', 'github.io'];

/**
 * Reserved, never-resolvable top-level domains (RFC 2606 / RFC 6761).
 *
 * This list exists because the old block-list only caught the literal
 * `example.invalid`, so `privacy@pathomitra.test` and
 * `https://policy.pathomitra.test/` passed every guard in the chain and were
 * compiled into the signed 2.5.1 release APK — an app holding patient data with
 * an unreachable privacy contact and a policy URL that can never resolve.
 * Matched on the suffix rather than on a sample string, so a rebrand cannot
 * re-open the hole (which is exactly what happened: `pathomitra.test` was new
 * text where the guard expected `example.invalid`).
 */
const RESERVED_SUFFIXES = ['.test', '.invalid', '.example', '.localhost', '.local'];

function isReservedHost(host) {
  const h = String(host).toLowerCase();
  return RESERVED_SUFFIXES.some(suffix => h.endsWith(suffix));
}

const problems = [];

/**
 * `--allow-placeholder` is the only way past the placeholder block, and it exists
 * for one purpose: building a device test APK before the real domain exists. It
 * downgrades the static placeholder problems to a loud warning and skips the
 * network probe.
 *
 * It is deliberately opt-in, per-invocation and named in the npm script that uses
 * it (`android:test-apk`) — never a global env var that a release build can
 * inherit by accident. A build made this way carries an unreachable policy URL in
 * its own Settings → Privacy Policy screen, so it must not be uploaded: `npm run
 * build:android` (the release path) does not pass this flag and will not run at
 * all until `.env` holds real values. A silent bypass is how the `.test` URL
 * reached the signed 2.5.1 APK in the first place.
 */
const ALLOW_PLACEHOLDER = process.argv.includes('--allow-placeholder');

function testBuildBanner() {
  console.warn(
    '\n' +
      '#################################################################\n' +
      '#  TEST BUILD — NOT FOR SUBMISSION TO GOOGLE PLAY             #\n' +
      '#  Release identity is still a placeholder, so the policy URL    #\n' +
      '#  inside this binary cannot be reached. Device testing only.   #\n' +
      '#  Submission build: npm run verify:android with real .env.     #\n' +
      '#################################################################\n',
  );
}

function checkEmail(value, name) {
  if (!value) {
    problems.push(`${name} is not set. Add it to .env — Play needs a monitored privacy contact.`);
    return;
  }
  if (!EMAIL.test(value)) {
    problems.push(`${name}="${value}" is not a valid email address.`);
    return;
  }
  const host = value.split('@')[1].toLowerCase();
  if (BLOCKED_HOSTS.some(blocked => host.includes(blocked))) {
    problems.push(`${name}="${value}" is still a placeholder domain.`);
  }
  // The failure that shipped: a reserved TLD looks like a plausible brand domain
  // but can never receive mail, so Play cannot reach the developer.
  if (isReservedHost(host)) {
    problems.push(
      `${name}="${value}" is on the reserved, never-resolvable TLD ` +
        `'${host.slice(host.lastIndexOf('.'))}' — it cannot receive mail. Use a mailbox on a domain you own.`,
    );
  }
}

function checkUrl(value, name) {
  if (!value) {
    problems.push(`${name} is not set. Play requires a publicly reachable policy URL.`);
    return;
  }
  if (!URL_HTTPS.test(value)) {
    problems.push(`${name}="${value}" must be an absolute https:// URL.`);
    return;
  }
  const host = new URL(value).hostname.toLowerCase();
  if (BLOCKED_HOSTS.some(blocked => host.includes(blocked))) {
    problems.push(`${name}="${value}" is still a placeholder domain.`);
  }
  if (isReservedHost(host)) {
    problems.push(
      `${name}="${value}" is on the reserved, never-resolvable TLD ` +
        `'${host.slice(host.lastIndexOf('.'))}' — a Play reviewer cannot open it. Host the policy on a domain you own.`,
    );
  }
  // A free platform subdomain works today but can be taken away, and Play asks
  // that the policy live at a developer-controlled location.
  if (BLOCKED_URL_HOSTS.some(shared => host === shared || host.endsWith(`.${shared}`))) {
    problems.push(
      `${name}="${value}" points at a shared platform subdomain rather than a domain you own.`,
    );
  }
}

function bail() {
  console.error('\n✗ Release configuration is incomplete.\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\n  Set VITE_SUPPORT_EMAIL and VITE_PRIVACY_URL in .env, generate the hosted\n' +
      '  policy with `npm run build:privacy`, and host privacy-site/ on that domain.\n',
  );
  process.exit(1);
}

checkEmail(process.env.VITE_SUPPORT_EMAIL, 'VITE_SUPPORT_EMAIL');
checkUrl(process.env.VITE_PRIVACY_URL, 'VITE_PRIVACY_URL');

const envFile = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envFile)) {
  problems.push('.env does not exist — copy .env.example and fill in both values.');
}

if (problems.length > 0) {
  if (!ALLOW_PLACEHOLDER) bail();
  for (const problem of problems) console.warn(`  (placeholder — test build) - ${problem}`);
  testBuildBanner();
}

// ---------------------------------------------------------------------------
// Live reachability probe.
//
// A syntactically-valid URL on a domain that serves nothing is the *other* way
// this fails: the static checks above cannot tell a hosted policy from a parked
// domain, and `npm run build:privacy` writing privacy-site/ to disk does not put
// it on the internet. Play's Data Safety form points at this URL, so it has to
// answer, and it has to answer with the policy this app describes — which is why
// the fetched page is required to name the same support contact.
//
// Escape hatches are loud, never silent:
//   PRIVACY_URL_CHECK=skip   — do not probe at all (offline build machine)
//   PRIVACY_URL_CHECK=loose  — require HTTP 200 only, skip the body match
// ---------------------------------------------------------------------------
const PROBE_MODE = (process.env.PRIVACY_URL_CHECK ?? 'strict').toLowerCase();
const policyUrl = process.env.VITE_PRIVACY_URL.trim();
const contact = process.env.VITE_SUPPORT_EMAIL.trim();

if (ALLOW_PLACEHOLDER) {
  // The URL is a reserved TLD by definition here, so probing it would only prove
  // what the static check already said. The banner above is the warning.
} else if (PROBE_MODE === 'skip') {
  console.warn(
    '\n⚠ PRIVACY_URL_CHECK=skip — the policy URL was NOT fetched.\n' +
      '  Before submitting to Play, run this without the override on a machine with network access.\n',
  );
} else if (PROBE_MODE === 'loose') {
  try {
    const res = await fetch(policyUrl, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!res.ok)
      problems.push(`${policyUrl} responded HTTP ${res.status} — nothing is hosted there.`);
  } catch (error) {
    problems.push(
      `${policyUrl} could not be fetched (${error.message}) — it is not publicly reachable.`,
    );
  }
} else {
  try {
    const res = await fetch(policyUrl, {
      redirect: 'follow',
      headers: { 'user-agent': 'pathomitra-release-check/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    if (!res.ok) {
      problems.push(
        `${policyUrl} responded HTTP ${res.status} — a Play reviewer lands on an error page.`,
      );
    } else if (!/<html|<!doctype/i.test(body)) {
      problems.push(`${policyUrl} did not return an HTML document.`);
    } else {
      if (!/privacy/i.test(body)) {
        problems.push(`${policyUrl} serves HTML that does not read as a privacy policy.`);
      }
      if (!body.includes(contact)) {
        problems.push(
          `${policyUrl} does not name VITE_SUPPORT_EMAIL (${contact}) — the hosted page is not the ` +
            'policy this app ships (regenerate with `npm run build:privacy` and re-publish).',
        );
      }
    }
  } catch (error) {
    problems.push(
      `${policyUrl} could not be fetched (${error.message}) — Google requires a publicly reachable privacy policy.`,
    );
  }
}

// Anything still in `problems` here is either a static placeholder already warned
// about above (only possible in test-build mode, where the probe is skipped) or a
// live probe failure — and a probe failure means the identity is real but
// unreachable, which is a release blocker even for a test build.
if (problems.length > 0 && !ALLOW_PLACEHOLDER) bail();

console.log(
  ALLOW_PLACEHOLDER
    ? '⚠ Continuing as a TEST BUILD — this binary will contain an unreachable policy URL.'
    : `✓ Release configuration OK — contact ${contact}, policy ${policyUrl}` +
        (PROBE_MODE === 'strict' ? ' (verified reachable)' : ''),
);
