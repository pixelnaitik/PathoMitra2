## What changed?

One or two sentences on the behaviour change, not the file list — the diff
already shows the files.

## Why

The problem this solves, and any alternative considered and rejected.

## How to verify

Concrete steps from a clean checkout. "Run the tests" is not a verification
plan; "register a patient, filter to Today at a UTC-negative timezone, confirm
the row is still listed" is.

## Impact checklist

Only tick what applies — an unmarked row is read as "not considered".

- [ ] `npm run verify` passes (typecheck, lint ratchet, coverage gate, build)
- [ ] **Stored document shape changed** → schema and tests in `lib/models.ts`
      updated, and existing on-device databases still read (migration described)
- [ ] **Backup format changed** → a backup exported by the previous version
      still restores
- [ ] **Report layout / PDF changed** → checked in the live A4 preview and on a
      real print; already-issued reports still reprint correctly
- [ ] **New native plugin or Android permission** → justified against the
      no-network invariant (no `INTERNET`), and `SECURITY.md` plus the Play
      Data Safety answers updated
- [ ] **UI change** → checked at mobile width, in dark mode, and with the OS
      "reduce motion" preference on
- [ ] **New dependency** → bundle size before/after noted; introduces no
      network calls
- [ ] Documentation updated (`README.md`, `docs/design.md`, `.env.example`)

## Screenshots

For anything that renders: before/after, plus the live A4 preview if report
layout is involved.
