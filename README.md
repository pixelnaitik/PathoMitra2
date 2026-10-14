# PathoMitra

> An offline-first digital pathology laboratory management system — patient records,
> encrypted reports, billing and analytics, entirely on-device.

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![CI](https://github.com/pixelnaitik/PathoMitra/actions/workflows/ci.yml/badge.svg)
![Android](https://github.com/pixelnaitik/PathoMitra/actions/workflows/android.yml/badge.svg)
![Release](https://github.com/pixelnaitik/PathoMitra/actions/workflows/release.yml/badge.svg)

**PathoMitra** is built with React 19, Vite, Tailwind CSS and Capacitor 8. It runs as a
web app during development and ships as an Android APK/AAB where every clinical record
lives in an encrypted on-device database. It requests **no `INTERNET` permission**, talks
to no backend, and contains no analytics or third-party crash reporting — the laboratory
owns its data, full stop.

---

## Table of Contents

1. [Features](#features)
2. [Privacy & Security Model](#privacy--security-model)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Getting Started (Web)](#getting-started-web)
6. [Building for Android](#building-for-android)
7. [Command Reference](#command-reference)
8. [Quality Gates](#quality-gates)
9. [CI/CD & Releases](#cicd--releases)
10. [Versioning](#versioning)
11. [Documentation](#documentation)
12. [Security](#security)
13. [Contributing](#contributing)
14. [License](#license)

---

## Features

- **Dashboard & Analytics** — revenue, test volume, new patients and pending-report KPIs with charts, plus exportable CSVs.
- **Patient & Doctor Management** — registration, search and referral registers, with a multi-range calendar (presets, custom from/to ranges, month switching, per-day record dots) built into both lists.
- **Report Generation** — accurate pathology reports (CBC, LFT, lipid profile, …) rendered to PDF with jsPDF, in four templates: _Modern_, _Classic_, _Minimalist_ and _Plain / Pre-printed Pad_ for existing letterheads. Keyboard-driven result entry for high-speed data capture.
- **Custom Tests & Profiles** — define new tests with categories, units and male/female or adult/child reference boundaries; results are flagged against age- and sex-appropriate ranges.
- **Drafts & Amendment History** — reports save as drafts (never signed, never patient-visible) and are finalized on issue. Amending a finalized report bumps its version and records who changed it and when; the issuing operator and issue time are printed on the PDF.
- **Encrypted On-Device Store** — lab settings, custom tests and every clinical record live in a SQLCipher (AES-256) SQLite database whose key is held in the Android hardware keystore, with `localStorage` as the fast UI cache.
- **Bounded Lists** — report and patient lists page through results and cap what a single read returns, so a growing lab history never turns a screen into a full table scan.
- **Notification Center** — overdue reports, unissued drafts, stale invoices and malformed records are derived from the data you already have, with per-operator read/mute state kept on the device.
- **Local Authentication** — one operator account unlocked by a PBKDF2-hashed passcode with optional biometric / screen-lock credential. Failed unlocks escalate a lockout, and the session re-locks on background or after an idle interval.
- **Settings & Themes** — lab identity, logos, contact details and print layout, with five healthcare-tuned palettes (zero layout flash on load).
- **Data Backups** — JSON snapshots the operator creates and keeps; the app never phones home.

There is deliberately **no QR verification service and no external signing endpoint** —
the offline build has no server, so a report states what actually happened (who issued
it, when) rather than asserting a check that cannot be performed. Accreditation or
licence text prints only if the laboratory enters and attests to it in Settings.

---

## Privacy & Security Model

| Control        | Implementation                                                                     |
| -------------- | ---------------------------------------------------------------------------------- |
| Network        | No `INTERNET` permission; no analytics, tracking or remote crash reporting         |
| Database       | SQLCipher (AES-256) via `@capacitor-community/sqlite`; key in the Android Keystore |
| Authentication | Single local operator; PBKDF2-hashed passcode; optional biometric unlock           |
| Sessions       | Re-lock on background / idle; rising lockout after failed unlocks                  |
| Release build  | `debuggable false`, R8 minification + resource shrinking                           |
| Backups        | Operator-created JSON snapshots; the app never transmits them                      |

---

## Tech Stack

- **Frontend:** React 19, React Router 7, Tailwind CSS 4, [Motion](https://motion.dev), Lucide React, Recharts
- **Shell:** Capacitor 8 (Android) with the community SQLCipher SQLite plugin, biometric auth and secure storage plugins
- **Data layer:** Encrypted on-device SQLite (SQLCipher) behind a collection/query façade in `src/data/`; Android Keystore for secrets
- **PDF:** jsPDF + jsPDF-AutoTable
- **Validation:** Zod — stored document shapes are schema-checked at the read boundary (`src/lib/models.ts`)
- **Build:** Vite 6 + esbuild; `VITE_TARGET=native` strips web-deploy assets from the APK
- **Quality:** TypeScript strict, ESLint with a warning ratchet in CI, Prettier, Vitest with a coverage gate, build guards that prove the APK carries no web artifacts and no placeholder privacy contact, husky `pre-commit`

---

## Project Structure

```
.
├── .github/
│   ├── CONTRIBUTING.md          # Contribution guide
│   ├── ISSUE_TEMPLATE/          # Bug / feature forms + security routing
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── dependabot.yml
│   └── workflows/
│       ├── ci.yml               # PR checks (lint, tests, build)
│       ├── deploy.yml           # main → Cloudflare Pages + privacy-site artifact
│       ├── release.yml          # tag → signed AAB + GitHub Release
│       └── android.yml          # tag / manual → AAB + APK artifacts
├── android/                     # Capacitor native project (Gradle wrapper, signing via ignored files)
├── docs/
│   ├── design.md                # UI design system (tokens, typography, palettes)
│   └── play-listing.md          # Google Play listing copy
├── patches/                     # patch-package fixes (e.g. @capgo/capacitor-printer)
├── public/                      # Static web assets (manifest, robots, sitemap, _headers)
├── scripts/                     # Build guards + privacy-policy site generator
├── src/
│   ├── components/              # Shared UI; components/ui holds the design-system primitives
│   ├── contexts/                # AuthContext (local operator session)
│   ├── data/                    # On-device data layer: collection façade over SQLCipher
│   ├── hooks/                   # useCollectionList, useNotifications, useNetworkStatus, …
│   ├── lib/                     # Framework-free domain logic + unit tests
│   ├── pages/                   # Route-level components (auth/, dashboard/, public)
│   └── test/                    # Vitest setup
├── capacitor.config.ts          # Native shell config (https scheme, SQLCipher on)
├── vite.config.ts / vitest.config.ts / eslint.config.js / tsconfig.json
├── CHANGELOG.md · LICENSE · README.md · SECURITY.md
```

---

## Getting Started (Web)

### Prerequisites

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) **20.19 or newer** (enforced by `engines.node`, used by CI)
- A code editor such as [VS Code](https://code.visualstudio.com/)

No account, backend or API key is required — the app is fully functional with zero
configuration. Optional environment switches are documented in
[`.env.example`](.env.example).

### Setup

```bash
git clone https://github.com/pixelnaitik/PathoMitra.git
cd PathoMitra
npm install
npm run dev
```

Open `http://localhost:3000`. Data persists in browser storage in the web build; the
production product target is the encrypted Android build below.

---

## Building for Android

### Prerequisites

- Node.js 20.19+, JDK 21 (Temurin) and an Android SDK with platform 36
  (installed with [Android Studio](https://developer.android.com/studio)); Gradle 9.1 ships
  via the wrapper — no global install needed.
- `android/local.properties` is machine-specific and git-ignored; Android Studio
  generates it, or Gradle derives the SDK path from `ANDROID_HOME`.

### 1. Configure the release identity

`npm run build:android` fails without the two values Google Play requires for a health
app — set them in `.env` (see [`.env.example`](.env.example)):

```bash
VITE_SUPPORT_EMAIL="privacy@your-lab-domain.example"
VITE_PRIVACY_URL="https://policy.your-lab-domain.example/"
```

The guard (`scripts/check-release-config.mjs`) exists because a comment survives a build
while an unreachable contact does not survive Play review.

### 2. Configure signing (optional for local builds)

Copy the template and point `storeFile` at your keystore:

```bash
cp android/keystore.properties.example android/keystore.properties
```

`android/keystore.properties`, `*.jks` and `*.keystore` are **git-ignored** — signing
material must never be committed. CI instead decodes a `KEYSTORE_BASE64` secret and reads
`KEYSTORE_KEY_ALIAS` / `KEYSTORE_KEY_PASSWORD` / `KEYSTORE_STORE_PASSWORD` (see
`android/app/build.gradle`). Without any keystore the build still succeeds and produces
an _unsigned_ artifact, with a loud warning.

### 3. Build

```bash
npm run sync:android     # native-target web build + cap sync + asset guards
npm run android:apk      # android/gradlew.bat assembleRelease  (Windows)
npm run android:aab      # android/gradlew.bat bundleRelease     (Windows)
# macOS / Linux: cd android && ./gradlew assembleRelease
```

Outputs:

- APK → `android/app/build/outputs/apk/release/app-release-<version>.apk` (e.g. `app-release-2.1.0.apk` — every build carries the package.json semver in its name)
- AAB → `android/app/build/outputs/bundle/release/app-release.aab`

### 4. Privacy policy site

The Play listing must link a privacy policy on a domain you control. Render the static
site (plain HTML, rendered from the same source as the in-app text) with:

```bash
npm run build:privacy    # outputs privacy-site/
```

`deploy.yml` builds and uploads it as a CI artifact on every push to `main`.

---

## Command Reference

| Command                           | What it does                                                             |
| --------------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                     | Vite dev server on port 3000                                             |
| `npm run build`                   | Production web bundle to `dist/`                                         |
| `npm run preview`                 | Serve the built bundle locally                                           |
| `npm run build:android`           | `VITE_TARGET=native` web build + release-config & asset guards           |
| `npm run sync:android`            | `build:android` + `cap sync android` + synced-asset guard                |
| `npm run android:apk`             | Gradle `assembleRelease` (installable APK)                               |
| `npm run android:aab`             | Gradle `bundleRelease` (Play artifact)                                   |
| `npm run verify:android`          | `build:android` + AAB, the native pre-release gauntlet                   |
| `npm run build:privacy`           | Render the static privacy-policy site                                    |
| `npm run typecheck`               | `tsc --noEmit`, strict                                                   |
| `npm run lint`                    | Typecheck + ESLint, uncapped                                             |
| `npm run lint:ci`                 | Same, with `--max-warnings=21` as a ratchet: CI fails if the count rises |
| `npm run format` / `format:check` | Prettier over `src/**/*.{ts,tsx,css}`                                    |
| `npm test` / `test:watch`         | Vitest (jsdom)                                                           |
| `npm run test:coverage`           | Vitest + coverage gate on the data-integrity layer                       |
| `npm run verify`                  | `lint:ci` → `test:coverage` → `build`                                    |
| `npm run release` / `release:dry` | standard-version bump + changelog                                        |
| `npm run clean`                   | Remove `dist/`                                                           |

To debug a production stack trace, build with `SOURCEMAP=true npm run build`; Vite emits
hidden `.map` files — upload them to your error tracker and delete them from `dist/`
before distributing anything.

---

## Quality Gates

- **TypeScript strict** with `noUnusedLocals` / `noUnusedParameters` (`npm run typecheck`).
- **ESLint warning ratchet** — `lint:ci` caps warnings at the count in `package.json`;
  fix warnings and lower the cap in the same change. Never raise the cap for a green check.
- **Vitest coverage gate** — `vitest.config.ts` pins thresholds on the modules whose
  silent failure would corrupt clinical output (document parsing, settings persistence,
  pagination, notification derivation).
- **Build guards** — `scripts/check-native-assets.mjs` proves the APK carries no
  web-deployment artifacts (robots, sitemap, service worker, `_headers`); no placeholders.
- **Pre-commit hook** — husky + lint-staged lint and format staged files; installed by
  `npm install`.

---

## CI/CD & Releases

Four GitHub Actions workflows:

| Workflow      | Trigger           | What it does                                                                                                             |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ci.yml`      | PRs to `main`     | `lint:ci`, `test:coverage`, `build`                                                                                      |
| `deploy.yml`  | push to `main`    | Same gates, then deploys `dist/` to **Cloudflare Pages** (`pathomitra` project) and uploads the `privacy-site/` artifact |
| `release.yml` | `v*` tag          | Builds the signed AAB, verifies 16 KB native page alignment, creates the GitHub Release with the AAB attached            |
| `android.yml` | `v*` tag / manual | Builds the AAB and an installable APK as build artifacts                                                                 |

**Secrets / variables to configure** (Settings → Secrets and variables → Actions):

| Name                                                                     | Type      | Used by                                              |
| ------------------------------------------------------------------------ | --------- | ---------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                          | secrets   | `deploy.yml` (Pages deploy)                          |
| `KEYSTORE_BASE64`                                                        | secret    | `release.yml`, `android.yml` (base64-encoded `.jks`) |
| `KEYSTORE_KEY_ALIAS`, `KEYSTORE_KEY_PASSWORD`, `KEYSTORE_STORE_PASSWORD` | secrets   | release signing                                      |
| `VITE_SUPPORT_EMAIL`, `VITE_PRIVACY_URL`                                 | variables | `deploy.yml` privacy-site build                      |

A run without signing secrets still completes and produces an unsigned artifact — a fork
gets a compilable result instead of a hard failure.

---

## Versioning

Versions follow [Conventional Commits](https://www.conventionalcommits.org/) and are cut
with [standard-version](https://github.com/conventional-changelog/standard-version):

- `npm run release` — bumps `package.json` (`feat` → minor, `fix` → patch,
  `BREAKING CHANGE`/`!` → major), prepends to `CHANGELOG.md`, tags `vX.Y.Z`. The
  Android `versionCode` is derived from it (`major*1_000_000 + minor*1_000 + patch`).
- `npm run release:dry` — preview without touching git.
- Push the tag to publish: `git push && git push --tags` — `release.yml` builds the AAB
  and opens the GitHub Release seeded from the changelog.

---

## Documentation

- [`docs/design.md`](docs/design.md) — UI design system: tokens, typography, palettes.
- [`docs/play-listing.md`](docs/play-listing.md) — Google Play listing copy.
- [`SECURITY.md`](SECURITY.md) — vulnerability reporting and the offline threat model.

---

## Security

PathoMitra holds patient data. If you find a vulnerability, **do not open a public
issue** — follow the private reporting process in
[SECURITY.md](SECURITY.md). Highlights of the model:

- The client bundle is public JavaScript; nothing enforced only in React is a control.
  Data protection rests on SQLCipher + the Android Keystore, PBKDF2 passcode hashing,
  session re-locking, and the release build hardening described above.
- Never commit `android/keystore.properties`, `*.jks` / `*.keystore`, or `.env` — all are
  git-ignored. A pull request that adds the `INTERNET` permission or a network client
  should be treated as a security event, not a feature.

---

## Contributing

Contributions are welcome! Please read [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md)
before opening a pull request. In short:

1. Fork and branch from `main`.
2. `npm install`, make your change with tests where applicable.
3. Keep `npm run verify` green; the pre-commit hook helps.
4. Open a PR against `main` describing what changed and why. CI must pass to merge.

Never paste real patient data into issues, PRs, or screenshots.

---

## License

This project is licensed under the [MIT License](LICENSE).
