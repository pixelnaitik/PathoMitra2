# PathoMitra2 Release-Readiness Audit — October 2026

**Scope:** Android Google Play and Windows/Microsoft Store readiness, including clinical record integrity, local data security, report output, privacy, and Android/desktop/tablet usability. CI configuration and workflow findings are intentionally excluded at the project owner's request.

**Baseline:** `main` at `7752157cc4d6f936aa02ada818571cb226051b25`.
**Working branch:** `audit/non-ci-release-ui-hardening`.
**Status:** Source audit and first fixes only. No local checkout was available in this session, so no tests, production builds, device runs, signed artifacts, or store submissions are claimed as verified.

## Changes made on this branch

- Hardened Electron path resolution to validate the nearest existing real filesystem ancestor for new file paths, preventing a new-file write from bypassing real-path checks via an existing symlink/junction.
- Hardened absolute targets used by desktop open/print flows by checking the target's real path is still inside an app-owned root.
- Added `reportVersions` to the desktop IPC entity allow-list; the shared data model and SQLite adapter already support it.
- Corrected stale repository metadata and links from `PathoMitra` to `PathoMitra2`.
- Added consistent keyboard focus visibility and touch-interaction refinements.
- Kept the active dashboard section title visible on narrow phone widths.
- Made report-status resolution fail closed: only an explicit `final` status can be shown as issued/amended; missing or unknown status is treated as draft in the presentation model.
- Updated the report-status tests to pin the fail-closed behavior.
- Changed the modern PDF header to use the canonical report-status presentation model rather than hardcoding `FINAL`.

## P0 — Required before production release

### 1. Prove record integrity and report-version history
- [ ] Create a patient, draft report, issue it, amend it with a reason, restart the app, and confirm the original version plus amendment history remain available.
- [ ] Simulate a failed multi-collection commit and confirm both report and history roll back together on Android and Windows.
- [ ] Confirm patient edits do not mutate already-issued reports.
- [ ] Confirm malformed/legacy report status never renders as issued or safe to distribute.
- [ ] Confirm restore merges/upserts according to documented behavior and never silently deletes existing records.

### 2. Verify Electron trust boundaries
- [ ] Add automated tests for path traversal, Windows drive/UNC paths, symlinks/junctions in parent directories, existing symlink targets, and nonexistent nested targets.
- [ ] Test read/list/save/delete/open/print IPC channels with malformed types, oversized payloads, and paths outside allowed roots.
- [ ] Confirm a compromised renderer cannot reach database-key credentials, arbitrary shell commands, or arbitrary local files.
- [ ] Review URL navigation, window creation, permission requests, protocol handling, and external-link behavior in the packaged app.

### 3. Privacy and release identity
- [ ] Configure a real monitored support email and publicly reachable HTTPS privacy policy owned/controlled by the developer.
- [ ] Compare every privacy-policy claim against the actual Android and Windows packaged artifacts and current dependencies.
- [ ] Verify release builds do not contain placeholders, test identities, debug flags, or development-only fallbacks.
- [ ] Complete Google Play Data Safety and health-data declarations based on observed app behavior.
- [ ] Confirm the actual Microsoft Partner Center publisher identity and signing certificate; never infer these values.

## P1 — Clinical correctness and platform behavior

### PDF/report correctness
- [ ] Test Devanagari, Bengali, Tamil and other required Unicode characters in patient names, lab names, doctor names, test labels and notes. The current PDF renderer uses jsPDF standard fonts; the repository audit flags embedded Unicode font support as open.
- [ ] Confirm every persisted result intended for a report appears in the PDF, not just the originally selected tests.
- [ ] Test multi-page headers, page numbers, margins, custom letterheads, long names, long test labels, and long notes.
- [ ] Validate age/sex-specific ranges, units, abnormal flags, and caveats against a laboratory-approved test set. Code-supplied ranges must not be treated as clinically approved without laboratory review.
- [ ] Add golden-PDF/artifact regression coverage before treating the output as stable.

### Android
- [ ] Fresh install, first-time database initialization, unlock, biometric success/failure, idle relock, background/resume, and process death/relaunch.
- [ ] Patient CRUD, search, doctor management, report draft/issue/amend, invoices, CSV export, backup/restore, and erase-all-data.
- [ ] Android Back behavior, safe areas, gesture navigation, landscape, tablet width, large fonts, keyboard-open forms, and screen-reader labels.
- [ ] Verify packaged manifest permissions, native library loading, and release signing on a real device.

### Windows / PC / tablet
- [ ] Install, upgrade, uninstall/reinstall, and verify documented data-retention behavior.
- [ ] Test 100%, 125%, 150%, and 200% scaling; narrow desktop windows; tablet touch; keyboard-only navigation; high-contrast settings.
- [ ] Test printer discovery, PDF preview, printer selection, cancellation, page orientation, and output on physical printers.
- [ ] Test app recovery after forced termination during database write, backup, restore, or report generation.

### Backups and recovery
- [ ] Validate encrypted backup tampering and incorrect passphrase errors.
- [ ] Test interrupted restore and migration with a copy of representative data.
- [ ] Verify backups cannot silently leak into public folders unless the operator explicitly chooses that behavior.
- [ ] Test data deletion, stale snapshot cleanup, and database recovery paths without using live patient data.

## P2 — Premium UI acceptance

- [ ] Use one design system across Android and desktop: typography, spacing, surfaces, elevation, radii, status colors, and component states.
- [ ] Review each screen at phone, small tablet, large tablet, narrow desktop, and wide desktop widths.
- [ ] Every feature needs visible loading, empty, success, validation, permission-denied, and recoverable-error states.
- [ ] Ensure destructive actions, issuing a report, amending a report, erasing data, and restoring backups require clear confirmation and explain consequences.
- [ ] Ensure all important actions are reachable by touch and keyboard, have accessible names, and do not rely on color alone.
- [ ] Avoid showing a successful save/refresh message until the operation actually completes.
- [ ] Test long localized text, large system font settings, reduced motion, and dark/light palettes.

## Release acceptance rule

Do not call the release production-ready until:
1. source tests and TypeScript/lint checks pass locally;
2. Android and Windows release builds succeed using real release configuration;
3. the high-risk persistence/security tests above pass;
4. PDF artifacts are inspected and approved by a qualified laboratory reviewer;
5. representative workflows pass on physical Android and Windows hardware;
6. privacy policy, store declarations, signing, publisher identity, and listing metadata are verified.

A source-level review or successful compile alone is not evidence that every feature works. Keep the pull request in draft until these gates are satisfied.
