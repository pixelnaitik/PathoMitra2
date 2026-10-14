/**
 * Generates the static privacy-policy + terms pages that the Google Play listing
 * links to, into `privacy-site/`.
 *
 * Why generated instead of hand-written: the hosted policy is the legal document
 * Play reviews, and the in-app sheet is what the operator actually reads. When
 * those are two hand-edited files they drift, and a policy that overstates the
 * app is exactly what the User Data policy treats as a misrepresentation. Both
 * pages are rendered from `src/lib/privacy-policy.ts` and `src/lib/terms.ts`, so
 * there is one text and it cannot disagree with the build.
 *
 * Why plain HTML with no JavaScript: the Play reviewer and Google's crawler must
 * see the body without executing a SPA. A JS-rendered route on a `*.pages.dev`
 * subdomain is also a fragile thing to stake a submission on.
 *
 * Run:  npm run build:privacy   then host `privacy-site/` on a domain you own.
 * The support email and URL come from .env (VITE_SUPPORT_EMAIL / VITE_PRIVACY_URL)
 * and are checked by scripts/check-release-config.mjs at native-build time.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  PRIVACY_CONTACT_EMAIL,
  PRIVACY_LAST_UPDATED,
  PRIVACY_POLICY_URL,
  PRIVACY_SECTIONS,
  hasPlaceholderPrivacyContact,
  type PrivacySection,
} from '../src/lib/privacy-policy.ts';
import {
  TERMS_LAST_UPDATED,
  TERMS_SECTIONS,
  TERMS_VERSION,
  type TermsSection,
} from '../src/lib/terms.ts';

const OUT_DIR = path.resolve(process.cwd(), 'privacy-site');

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderSections(sections: PrivacySection[] | TermsSection[]): string {
  return sections
    .map(section => {
      const body = section.body
        .map(paragraph => `      <p>${escapeHtml(paragraph)}</p>`)
        .join('\n');
      return `    <section>\n      <h2>${escapeHtml(section.heading)}</h2>\n${body}\n    </section>`;
    })
    .join('\n');
}

function page(options: {
  title: string;
  eyebrow: string;
  heading: string;
  updated: string;
  intro: string;
  sections: string;
  otherHref: string;
  otherLabel: string;
  selfHref: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)}</title>
    <meta name="description" content="${escapeHtml(options.intro)}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${escapeHtml(options.selfHref)}" />
    <style>
      /* Inlined on purpose: this page has no build step, no CDN and no
         JavaScript, so a reviewer on any network sees the full document. */
      :root { color-scheme: light dark; --ink: #1d1d1f; --soft: #66666b; --line: #d6d6db; --accent: #0a5ea6; }
      @media (prefers-color-scheme: dark) {
        :root { --ink: #f2f2f5; --soft: #a7a7b0; --line: #3a3a40; }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 3rem 1.25rem 4rem;
        font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        color: var(--ink); background: var(--background, #fff);
      }
      @media (prefers-color-scheme: dark) { body { background: #101014; } }
      main { max-width: 46rem; margin: 0 auto; }
      .eyebrow {
        margin: 0 0 .5rem; font-size: .75rem; font-weight: 700;
        letter-spacing: .12em; text-transform: uppercase; color: var(--accent);
      }
      h1 { margin: 0 0 .5rem; font-size: clamp(1.9rem, 5vw, 2.6rem); letter-spacing: -.02em; }
      h2 { margin: 2.25rem 0 .5rem; font-size: 1.15rem; }
      p { margin: 0 0 .85rem; }
      .updated { margin: 0 0 2rem; font-size: .8rem; color: var(--soft); }
      .intro { margin: 0 0 1.5rem; color: var(--soft); }
      hr { border: 0; border-top: 1px solid var(--line); margin: 2.5rem 0 1.5rem; }
      a { color: var(--accent); }
      .contact { font-size: .9rem; }
      @media print { body { padding: 0; } a { color: inherit; text-decoration: none; } }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">${escapeHtml(options.eyebrow)}</p>
      <h1>${escapeHtml(options.heading)}</h1>
      <p class="updated">Last updated ${escapeHtml(options.updated)}</p>
      <p class="intro">${escapeHtml(options.intro)}</p>

${options.sections}

      <hr />
      <p class="contact">
        Questions: <a href="mailto:${escapeHtml(PRIVACY_CONTACT_EMAIL)}">${escapeHtml(PRIVACY_CONTACT_EMAIL)}</a>
        &nbsp;·&nbsp;
        <a href="${escapeHtml(options.otherHref)}">${escapeHtml(options.otherLabel)}</a>
      </p>
    </main>
  </body>
</html>
`;
}

if (hasPlaceholderPrivacyContact()) {
  console.error(
    '\n✗ Refusing to generate the hosted policy: VITE_SUPPORT_EMAIL / VITE_PRIVACY_URL\n' +
      '  are still placeholders in the environment.\n' +
      '  Set them in .env, then re-run: npm run build:privacy\n',
  );
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const outputs = [
  {
    file: path.join(OUT_DIR, 'index.html'),
    html: page({
      title: 'Privacy Policy — PathoMitra',
      eyebrow: 'Legal',
      heading: 'Privacy Policy',
      updated: PRIVACY_LAST_UPDATED,
      intro:
        'How PathoMitra, an offline laboratory console, handles patient and health information: what it stores, where it is kept, what it never collects, and how to delete everything.',
      sections: renderSections(PRIVACY_SECTIONS),
      otherHref: 'terms.html',
      otherLabel: 'Terms &amp; Conditions of Use',
      selfHref: PRIVACY_POLICY_URL,
    }),
  },
  {
    file: path.join(OUT_DIR, 'terms.html'),
    html: page({
      title: 'Terms & Conditions of Use — PathoMitra',
      eyebrow: 'Legal',
      heading: 'Terms & Conditions of Use',
      updated: `${TERMS_LAST_UPDATED} (v${TERMS_VERSION})`,
      intro:
        'The undertakings a laboratory operator accepts when using PathoMitra: professional use only, responsibility for patient data and for any accreditation printed on a report, and no diagnostic claims.',
      sections: renderSections(TERMS_SECTIONS),
      otherHref: 'index.html',
      otherLabel: 'Privacy Policy',
      selfHref: `${PRIVACY_POLICY_URL.replace(/\/?$/, '')}/terms.html`,
    }),
  },
];

for (const output of outputs) {
  fs.writeFileSync(output.file, output.html, 'utf8');
  console.log(`✓ wrote ${path.relative(process.cwd(), output.file)}`);
}

console.log(
  `\n  Host these two files on a domain you control and put that URL in the Play\n` +
    `  Console listing. Contact: ${PRIVACY_CONTACT_EMAIL}\n`,
);
