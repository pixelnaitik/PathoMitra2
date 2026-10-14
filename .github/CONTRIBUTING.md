# Contributing to PathoMitra

Thanks for your interest in improving PathoMitra! This guide covers
everything you need to set up a development environment, follow the project's
conventions, and get your pull request merged.

## Code of Conduct

Be respectful and constructive. Keep discussions technical and assume good
intent. Reports of pathology data are real patient information — never paste
live PHI (patient names, report contents, credentials) into issues or PRs.

## Development Setup

1. Install [Node.js](https://nodejs.org/) **20.19 or newer** — enforced by
   `engines.node` in `package.json`, and the version CI runs on.
2. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/pixelnaitik/PathoMitra.git
   cd PathoMitra
   npm install
   ```

3. (Optional) copy `.env.example` to `.env` for the documented dev switches.
   No backend, API key or account is required — the app is local-first and
   fully functional with zero configuration. Only an Android _release_ build
   needs the Play identity values (`VITE_SUPPORT_EMAIL`, `VITE_PRIVACY_URL`);
   see the README's _Building for Android_ section.

4. Start the dev server (Vite, port 3000):

   ```bash
   npm run dev
   ```

## Project Layout

```
src/
  components/    # Shared UI (ui/ holds the primitives: Button, Card, Field, …)
  contexts/      # React contexts (AuthContext, local operator session)
  data/          # On-device data layer: collection façade over encrypted SQLite
  hooks/         # useCollectionList (cursor pagination), useNotifications, …
  lib/           # Framework-free logic: domain models, settings, report layout,
                 # test catalog, notification engine (+ unit tests)
  pages/         # Route-level components (auth/, dashboard/, public pages)
  test/          # Vitest setup
android/         # Capacitor native project (signing material is git-ignored)
public/          # Static web assets
scripts/         # Build guards + privacy-policy site generator
docs/            # Design system and other long-form documentation
```

## Conventions

- **TypeScript strict mode.** New code must typecheck (`npm run typecheck`).
- **ESLint + Prettier.** Run `npm run lint` and `npm run format` before
  committing. CI runs `npm run lint:ci`, which is a **warning ratchet**: the
  current count in `package.json` (`--max-warnings=21`) is a ceiling, so fixing
  warnings means lowering the number in the same commit. Never raise the cap to
  get a green check.
- **Conventional Commits.** `feat:` / `fix:` / `perf:` / `refactor:` /
  `docs:` / `test:` (with `!` or `BREAKING CHANGE:` for majors) — releases are
  cut from these messages by `standard-version`, and `chore`/`style`/`ci`/`test`
  are excluded from the changelog.
- **Shared logic goes in `src/lib/`.** Anything that is not tied to React
  (validation, serialization, calculations, storage access) should live there
  with unit tests — see the existing `*.test.ts` files for the pattern.
- **Read stored records through the schemas in `src/lib/models.ts`.** List
  pages pass the `read*` helpers to `useCollectionList` rather than spreading
  raw rows, so a malformed or legacy record degrades to a displayable stub
  instead of crashing a render deep in a table.
- **Dates are compared on the local day.** `createdAt` is stored as a UTC ISO
  string, but pickers, calendar dots, and filters all work in local calendar
  days. Build query bounds with `lib/date-range` (`localDayStartIso` /
  `localDayEndIso`) and format display days with `toIsoDay`; hand-padded
  `${day}T00:00:00.000Z` bounds silently mean UTC midnight and drop the first
  hours of the day.
- **Data access** must go through the `src/data/` façade — components never
  talk to SQLite or `localStorage` directly. If you change a document shape,
  update the `models.ts` schema (and its tests) and the README in the same PR.
- **Never commit secrets.** `.env`, `android/keystore.properties` and any
  `*.jks` / `*.keystore` are git-ignored; keep it that way. Report a security
  issue privately — see [`SECURITY.md`](../SECURITY.md), not the issue tracker.

## Testing

```bash
npm test                  # single run
npm run test:watch        # interactive
npm run test:coverage     # enforces the coverage gate on the data-integrity layer
npm run verify            # lint:ci + test:coverage + build — the pre-release gauntlet
```

`vitest.config.ts` lists the modules under a coverage threshold — the ones whose
silent failure corrupts clinical output (document parsing, settings
persistence, pagination, notification derivation, the error boundary). Adding a
module to that list means writing its tests first, and the thresholds only ever
move up.

UI changes should be verified manually with `npm run dev` (desktop and mobile
viewports, light and dark, and with the OS "reduce motion" preference on).

## Pull Request Process

1. Branch from `main` with a descriptive name (`fix/report-template-crash`).
2. Keep PRs focused — one logical change per PR.
3. Ensure `npm run verify` passes locally; CI runs the same three gates.
4. Update documentation (README, `docs/`) when behavior or setup changes.
5. Fill in the PR template, including its impact checklist — an unchecked row is
   read as "not considered", not as "not applicable".
6. Open the PR against `main` and describe _what_ changed and _why_. Link any
   related issues.
7. A maintainer will review and merge. CI must be green before merge.

## Reporting Issues

Use the [issue templates](https://github.com/pixelnaitik/PathoMitra/issues/new/choose) —
they ask for the platform, app version and unlock method you saw the
problem on, which is usually what determines the cause. For anything with
security impact, follow [`SECURITY.md`](../SECURITY.md) instead of opening an
issue. Redact all real patient data.
