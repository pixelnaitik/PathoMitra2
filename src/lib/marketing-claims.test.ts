/**
 * Guard: the public marketing layer may not claim capabilities the reference
 * implementation does not have.
 *
 * The Android app is the reference implementation, and it is built from this
 * same `src/` tree (`capacitor.config.ts` → `webDir: 'dist'`), so the console
 * pages can never drift from it structurally. The marketing pages can: they
 * exist only in the web build (`App.tsx` collapses every public route onto
 * `/auth` when `isNative`), which means nothing in the APK verifies what they
 * assert. This file is that missing check.
 *
 * Each rule below cites the code fact that makes the phrase false, in the order
 * it was confirmed. Adding a rule means adding that citation.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Web-only surfaces a visitor reads before ever opening the console. */
const MARKETING_SOURCES = [
  'src/LandingPage.tsx',
  'src/components/Header.tsx',
  'src/components/Hero.tsx',
  'src/components/Features.tsx',
  'src/components/HowItWorks.tsx',
  'src/components/Trust.tsx',
  'src/components/CTA.tsx',
  'src/components/Footer.tsx',
  'src/pages/TechnologyPage.tsx',
  'src/pages/SolutionsPage.tsx',
];

interface ClaimRule {
  pattern: RegExp;
  /** Why the phrase is false, with the file that proves it. */
  evidence: string;
}

const BANNED_CLAIMS: ClaimRule[] = [
  {
    pattern:
      /\bAI[\s-]?(native|assisted|powered|enabled|driven|intelligent)\b|artificial intelligence/i,
    evidence:
      'no AI/ML dependency in package.json and no inference code in src/lib or src/data — the only "inference" is reference-range kind selection in pathology-tests.ts',
  },
  {
    pattern:
      /\bsync(?:ed|s|ing|ing)?\b|\bqueued writes?\b|will sync|auto-?sync|replay (?:queued|pending)/i,
    evidence:
      'no fetch / XMLHttpRequest / sendBeacon / axios anywhere in src outside tests, and public/sw.js precaches static assets only — there is no queue and no ingest endpoint (telemetry.ts: "Offline build: there is no ingest endpoint"). The word itself is banned in visible copy because it implies a server; honest disclaimers say what happens instead ("uploaded", "written to local storage")',
  },
  {
    pattern: /live demo|demo portal|report portal|data portal|patient portal/i,
    evidence:
      'no seeded demo account exists — AuthPage onboarding makes the visitor create the local account — and index.html already replaced this word with "Console" because it implies a server to reach',
  },
  {
    pattern: /\biOS\b/,
    evidence:
      'the repo contains only an `android/` native project; @capacitor/ios is not a dependency',
  },
  {
    pattern: /cursor[- ]paginated/i,
    evidence:
      'useCollectionList.ts pages by widening a rendered window over an in-memory array (slice(0, visible)) — it is not cursor paging',
  },
  {
    pattern: /\bfrom anywhere\b|access(?:ing)? .{0,20}from any device/i,
    evidence:
      'records live in one device-local store (SQLite via SQLCipher, or localStorage) with no export-to-server path, so a second machine cannot read them',
  },
];

/**
 * Drop `/* … *\/` blocks. JSX comments are how this codebase records *why* a
 * piece of copy was changed, and those explanations quote the removed phrase —
 * the guard is about what a visitor reads, not about what a maintainer is told.
 * Line comments are deliberately left in place: `//` is rarer in copy lines and
 * silently skipping them would weaken every other rule here.
 */
function visibleSource(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

// vitest sets the process working directory to the project root, and under the
// jsdom environment `import.meta.url` is not a `file:` URL — so cwd is the only
// reliable way to reach the sources this guard reads.
const read = (relative: string) =>
  visibleSource(readFileSync(resolve(process.cwd(), relative), 'utf8'));

describe('marketing copy matches the reference implementation', () => {
  it.each(MARKETING_SOURCES)('%s is read', file => {
    expect(() => read(file)).not.toThrow();
  });

  it.each(BANNED_CLAIMS.map(rule => [rule.evidence, rule] as const))(
    'is absent from every marketing surface: %s',
    (_evidence, rule) => {
      const offenders = MARKETING_SOURCES.filter(file => rule.pattern.test(read(file)));
      expect(offenders).toEqual([]);
    },
  );

  it('states which build each security guarantee belongs to', () => {
    // Trust.tsx renders four chips under "Security model". Three describe the
    // Android build; a browser visitor reading them unqualified would conclude
    // their session is encrypted and offline-cached when WebRepository gives
    // them plain localStorage. Either the labels carry the scope, or the
    // section says the same thing in prose — so both are asserted here.
    const trust = read('src/components/Trust.tsx');
    expect(trust).toContain('(Android)');
    expect(trust).toMatch(/unencrypted local storage|browser build/i);
  });

  it('never renders a number that looks like live system state', () => {
    // The decorative badges in Features.tsx used to print a relative timestamp
    // and a queue depth. Those read as telemetry, so ban the shape: a digit
    // immediately followed by a sync/queue word in user-visible copy.
    expect(read('src/components/Features.tsx')).not.toMatch(
      /\d+\s?(s|seconds|minutes|writes|items)\b.{0,40}(sync|queue)/i,
    );
  });
});
