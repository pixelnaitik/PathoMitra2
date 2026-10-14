#!/usr/bin/env node
/**
 * Desktop build guard — the Electron counterpart of check-native-assets.mjs.
 *
 * Catches the three ways a desktop bundle fails quietly:
 *   1. built for the WRONG target (absolute /assets URLs die under file://;
 *      web-only assets should have been stripped);
 *   2. MSIX tile logos missing (electron-builder substitutes generic ones
 *      silently — a Store submission with the Microsoft logo is a rejection);
 *   3. a dist/ left over from a web or android build being packaged as desktop.
 *
 * Exits 1 with every problem named; nothing here is a warning.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const problems = [];

/* 1 + 3: dist/ must be a fresh desktop build --------------------------------*/
const indexHtmlPath = path.join(root, 'dist', 'index.html');
if (!fs.existsSync(indexHtmlPath)) {
  problems.push(
    'dist/index.html missing — run the desktop renderer build first (desktop:build-renderer).',
  );
} else {
  const html = fs.readFileSync(indexHtmlPath, 'utf8');
  if (/["'(]\/assets\//.test(html)) {
    problems.push(
      'dist/index.html references ABSOLUTE /assets/ URLs — it was built without VITE_TARGET=desktop ' +
        'and will 404 under file://. Rebuild with `npm run desktop:build-renderer` immediately before bundling.',
    );
  }
  if (!/\.\/assets\//.test(html) && !/dist-electron/.test(html)) {
    problems.push(
      'dist/index.html carries no relative ./assets/ references — not a recognisable desktop bundle.',
    );
  }
  if (/<link rel="manifest"/.test(html)) {
    problems.push(
      'dist/index.html still links a web manifest — built for the public web, not the shell.',
    );
  }
  for (const stripped of ['sw.js', 'manifest.json', 'robots.txt', 'sitemap.xml', 'llms.txt']) {
    if (fs.existsSync(path.join(root, 'dist', stripped))) {
      problems.push(
        `dist/${stripped} exists — web-only asset should have been stripped from the desktop build.`,
      );
    }
  }
}

/* 2: MSIX / installer assets ---------------------------------------------------*/
/** Parse PNG width/height from IHDR without any image dependency. */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const required = [
  ['StoreLogo.png', 50, 50],
  ['Square150x150Logo.png', 150, 150],
  ['Square44x44Logo.png', 44, 44],
  ['Wide310x150Logo.png', 310, 150],
];
const appxDir = path.join(root, 'desktop-resources', 'appx');
for (const [file, minW, minH] of required) {
  const full = path.join(appxDir, file);
  if (!fs.existsSync(full)) {
    problems.push(
      `desktop-resources/appx/${file} missing — generate with scripts/make-msix-assets.ps1.`,
    );
    continue;
  }
  const size = pngSize(full);
  if (!size) problems.push(`desktop-resources/appx/${file} is not a valid PNG.`);
  else if (size.w < minW || size.h < minH)
    problems.push(
      `desktop-resources/appx/${file} is ${size.w}x${size.h}, needs at least ${minW}x${minH}.`,
    );
}

const icon = path.join(root, 'desktop-resources', 'icon.png');
if (!fs.existsSync(icon)) {
  problems.push(
    'desktop-resources/icon.png missing — the window/taskbar icon for win-unpacked builds.',
  );
} else {
  const size = pngSize(icon);
  if (!size || size.w < 256)
    problems.push('desktop-resources/icon.png must be at least 256x256 for Windows.');
}

if (problems.length > 0) {
  console.error('\n✗ Desktop build assets are not ready.\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}
console.log(
  '✓ Desktop assets OK — dist/ is a file://-safe build, MSIX tiles and installer icon present.',
);
