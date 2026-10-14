# Feature audit — PathoMitra (Oct 2026 round)

Two rounds of a per-feature, code-grounded audit (read-only findings, then fixes).
Severity: **P0** data-integrity / compliance · **P1** user-visible correctness ·
**P2** polish / maintainability. Every finding cites the file it was read from.
Scope exclusions agreed with the owner: **billing/invoicing** (not audited, not touched)
and **age-based reference-range selection** (not evaluated).

Status column: **fixed 2.6.5** · **open** · **decided not to change** · **verify on device**.

## 1. Data persistence (`src/data/*`)

| #   | Sev | Finding                                                                                                                              | Status                                                                                                                                      |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | P0  | `transaction()` was not a transaction and `writeBatch.commit()` a sequential loop, while cascade deletes claimed "committed batches" | fixed 2.6.5 — real `beginTransaction/commit/rollback` holding the mutation chain; listeners notified once, after the outcome                |
| D-2 | P1  | `update()` read-copy-write with no serialisation → lost updates (the 2.6.0 audit fixed this on desktop only)                         | fixed 2.6.5 — single mutation chain; a transaction body runs inline on the chain it holds                                                   |
| D-3 | P1  | Every write re-read + `JSON.parse`d the whole table; `count()` did too                                                               | fixed 2.6.5 — `COUNT(*)` with a filter translation to `json_extract`, falling back to the JS path so the answer always matches `applyQuery` |
| D-4 | P1  | A failed `open()` after minting an encryption secret was cryptic                                                                     | fixed 2.6.5 — actionable message ("records have not been removed … restore from a backup"), cause preserved, failed bootstrap not cached    |
| D-5 | P1  | A failed read replayed `[]`, so "no records" looked true                                                                             | fixed 2.6.5 — `subscribe(entity, cb, onError?)` on all three adapters; `useCollectionList` records the error and keeps the previous rows    |
| D-6 | P2  | No migration ladder (`DB_VERSION = 1`, `CREATE TABLE IF NOT EXISTS`); the two stores are held equal by comment                       | open                                                                                                                                        |
| D-7 | P2  | Shim traps: `startAfter` is a silent no-op, `docChanges()` always reports `'added'`                                                  | open                                                                                                                                        |
| D-8 | P2  | `clearAll()` never `VACUUM`ed, so "erase everything" left recoverable pages                                                          | fixed 2.6.5                                                                                                                                 |

## 2. Patient records (`PatientsPage`, `models.ts`, `patient-registry.ts`)

| #   | Sev | Finding                                                                                                                                                                                                                              | Status                                                                                               |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| P-1 | P0  | Saving a patient edit rewrote **every** report under that patient — `testSelection`, `version`, `updatedBy` on `final` documents, with no `amendReason`; violated the documented immutability rule and fired "Amended report" alerts | fixed 2.6.5 — drafts only; amendment stays a deliberate, reasoned act in the report editor           |
| P-2 | P1  | ID = `YYMM` + 3 `Math.random()` digits, 10 probes, hard failure at ~1 000/month                                                                                                                                                      | fixed 2.6.5 — `meta`-stored per-month sequence, candidate still probed                               |
| P-3 | P1  | Writes persisted the raw form object (`{...formData}`), no write builder, `parseInt` → NaN                                                                                                                                           | fixed 2.6.5 — `toPatientDoc` / `toPatientUpdateDoc` on the zod schema; `createdAt` cannot be blanked |
| P-4 | P1  | No duplicate-patient detection (two MRNs, two half-histories)                                                                                                                                                                        | fixed 2.6.5 — conservative guard (same phone, or same name+age) with a confirm sheet                 |
| P-5 | P1  | `updatedBy/createdBy` stored the fixed uid `local-admin` → unreadable audit line                                                                                                                                                     | fixed 2.6.5 — `operatorStamp()` prefers the display name                                             |
| P-6 | P2  | Deletion is destructive only (no archive/undo, no per-patient export bundle)                                                                                                                                                         | open                                                                                                 |
| P-7 | P2  | CSV export is roster columns only                                                                                                                                                                                                    | open                                                                                                 |

## 3. Printing (`PrintDialog`, `print-model`, `pdf-preview`, `electron/print*.ts`)

| #       | Sev | Finding                                                                                                                                                                 | Status                                                                                                    |
| ------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| PR-1    | P1  | The spooled job was written as plaintext HTML (all pages inline, PHI) to `%TEMP%\PathoMitra\Print\<ts>-<title>.html`, title from the report name; `fs.rm` is not a wipe | fixed 2.6.5 — staged under `userData` with a random UUID name, `0o600`, stale files swept before each job |
| PR-2    | P1  | Whole job rasterised then crossed in one IPC message; the 200-page ceiling only enforced after rendering                                                                | partly fixed — pre-flight refusal in the dialog; per-page streaming open                                  |
| PR-3    | P1  | "Success" means the spooler accepted bytes; no queue check, no job log                                                                                                  | open                                                                                                      |
| PR-4    | P1  | Desktop print silently keeps a saved copy of the report; operator not told                                                                                              | open                                                                                                      |
| PR-5    | P1  | `openInTab` deliberately drops `noopener` to detect a blocked popup                                                                                                     | open (documented trade)                                                                                   |
| PR-6…10 | P2  | No printer capability introspection; preview renders not cancelled; orientation unverified on paper; no Android/web parity; no preview zoom                             | open — PR-8 fixed (render cancel: open)                                                                   |

## 4. PDF report generation

| #         | Sev | Finding                                                                                                                                      | Status                                                                       |
| --------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| F-1       | P1  | No embedded font (`addFileToVFS` = 0 hits); standard-14 is Latin-1, so Devanagari/Bengali/Tamil names print as blanks                        | open — needs a font asset decision                                           |
| F-2       | P1  | Filename `${patient}_lab_report.pdf` — no date/id/version; same-name collisions, v2 overwrites v1, PHI in the path                           | fixed 2.6.5 — `PathoMitra-<day>-<id6>-v<n>.pdf`                              |
| F-3 / U-1 | P1  | Rows built from `testSelection` alone: a value recorded outside that list is invisible on screen **and** on paper                            | fixed 2.6.5 (viewer); PDF path still to confirm                              |
| F-4       | P1  | Four renderers of one document (inline jsPDF in a 2 460-line page, sample PDF, HTML A4 preview, canvas letterhead)                           | open — extraction + golden-PDF test                                          |
| F-5       | P2  | `signature \|\| current operator` printed the viewer's name on a legacy document                                                             | fixed 2.6.5 — `resolveSigner()`, falls back to `createdBy`, never the viewer |
| F-6/7/8/9 | P2  | No report id/version/page numbers on the page; letterhead re-embedded per page; sample PDF is a fixed 5-row case; no artifact-level PDF test | open                                                                         |

## 5. Search (`CommandSearch`, list pages)

| #     | Sev | Finding                                                                                                                                  | Status                                                                 |
| ----- | --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| S-1   | P1  | Palette searched only the 200 newest per collection; list pages walked only 250 → older records unfindable with a "No results found" lie | fixed 2.6.5 — no ceiling; the store materialises the collection anyway |
| S-2   | P1  | `.catch(() => ({ docs: [] }))` turned a read failure into "no matches"                                                                   | fixed 2.6.5 — per-source errors surfaced in the panel                  |
| S-3   | P1  | Cannot search a patient number, phone digits, report id or a test/panel name                                                             | fixed 2.6.5 — palette + Patients + Reports                             |
| S-4/5 | P2  | Substring-only matching; one flat 12-result list                                                                                         | fixed 2.6.5 — token-AND + per-type budget                              |
| S-6   | P2  | Re-reads on every open, no cache                                                                                                         | open                                                                   |

## 6. Doctor register

| #      | Sev | Finding                                                                                                                                                  | Status                                                                                            |
| ------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| DR-1   | P0  | ~120 real-looking individual practitioners' names hardcoded in `src/lib/doctors.ts` and shipped to every install (owner decision: **keep**, not removed) | decided not to change — the list is now de-duplicated on the canonical key at the dropdown        |
| DR-2   | P1  | No doctor identity: patients store `doctorName` free text; suggestions use synthetic `default_<NAME>` ids                                                | open                                                                                              |
| DR-3   | P1  | No name normalisation → one doctor as three bars in Top Referrers, three rows in the dropdown                                                            | fixed 2.6.5 — `doctor-registry.ts` key/group/match helpers, wired into the dropdown and the chart |
| DR-4/5 | P2  | No specialisation/clinic fields; per-doctor aggregates recomputed live                                                                                   | open                                                                                              |

## 7. Analytics

| #      | Sev | Finding                                                                                                                                                                                      | Status                                                                                                                                                           |
| ------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AN-1   | P1  | `totalTests / patients.length` guarded by `totalReports > 0` — wrong operand; rendered the literal `Infinity`                                                                                | fixed 2.6.5                                                                                                                                                      |
| AN-2   | P1  | "Unique Patients" counted registrations in the window while "Total Tests" counted report activity; the ratio mixed the two; the donut centre said "Total Patients" for a range-scoped number | fixed 2.6.5 — Patients Tested (distinct ids in range), new registrations separated, "Registered patients" from the whole register; drafts excluded and announced |
| AN-3   | P1  | Trend series capped at 90 daily points and keyed by a year-less label → a long window silently showed ~3 months                                                                              | fixed 2.6.5 — ISO-day keys, day/week/month grain with the grain shown on each card                                                                               |
| AN-4   | P2  | "Total Tests" meant panel count or parameter count depending on the document                                                                                                                 | fixed 2.6.5 — one expansion (`expandTestSelection`)                                                                                                              |
| AN-5…8 | P2  | Full-window listeners; no period comparison or export; no turnaround/abnormality metric; no text alternative or empty state                                                                  | open                                                                                                                                                             |

## 8. Alerts (`notification-engine`, center, hooks)

| #       | Sev | Finding                                                                                                   | Status                                                                   |
| ------- | --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| N-1     | P1  | Alerts derive from a bounded recent window, so an old forgotten sample never alerts                       | open                                                                     |
| N-2     | P1  | Overdue keyed on "patient has any report" — one draft silenced every other ordered panel                  | fixed 2.6.5 — per ordered panel, expanded through the injected catalogue |
| N-3     | P2  | Draft alert promised "until it is finalized and signed" in a build with no signing and no patient surface | fixed 2.6.5                                                              |
| N-4     | P2  | Muted amendment never re-alerted (id not versioned)                                                       | fixed 2.6.5                                                              |
| N-5/6/7 | P2  | No quiet hours; banners off by default with no explanation in the panel; deep link to a deleted record    | open                                                                     |

## 9. Settings & configuration

| #          | Sev | Finding                                                                                                                                                                                           | Status                                                                                                                     |
| ---------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ST-1       | P1  | `sharingTemplateImage` had no store-boundary rule (unlike the brand logo): a restored/hand-edited remote URL or non-image reached `addImage` and failed at print time                             | fixed 2.6.5 — `isLetterheadDataUrl` + `LETTERHEAD_MAX_CHARS`, empty kept as "no letterhead"                                |
| ST-2       | P1  | Eighteen layout numbers were unbounded in the store; the only guard was at render, so a corrupted store could refuse every print with no way back                                                 | fixed 2.6.5 — clamped through `REPORT_FIELDS` on read **and** on write; tested against the spec, not hand-copied constants |
| ST-3/4/5/6 | P2  | No per-section reset or settings-only export; `readSettings()` inside memos does not react to `settings-updated`; no settings search or dirty indicator; chart fallback hexes duplicated from CSS | open                                                                                                                       |

## 10. Auth & session

| #   | Sev | Finding                                                                                                                               | Status                                                                                                                           |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A-1 | P1  | Lockout measured on a user-settable wall clock — winding it forward ended any lockout                                                 | fixed 2.6.5 — an implausible clock extends rather than clears the wait; covered by tests                                         |
| A-2 | P1  | Desktop has no background lock at all (visibility trigger removed; `powerMonitor` never shipped); "Never" disables the only mechanism | open                                                                                                                             |
| A-3 | P2  | `changePassword` accepted a new secret without the current one — safe today only because the single caller checked first              | fixed 2.6.5 — current passcode required by the API, verified through the same backoff, and the UI no longer double-counts a typo |
| A-4 | P2  | No local access/attempt log ("who opened the console when")                                                                           | open                                                                                                                             |
| A-5 | P2  | `RoleSchema ['guest','staff','admin']` with one local admin; dead gates in the UI                                                     | partly fixed — the guest branch in the palette is gone; the enum remains                                                         |
| A-6 | P2  | No device test for kill-while-backgrounded / relaunch                                                                                 | open                                                                                                                             |

## 11. Backup & restore

| #     | Sev | Finding                                                                                                                                          | Status                                  |
| ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| B-1   | P1  | Envelope `kdf.alg` / `cipher.alg` / `schemaVersion` were read and ignored — the header described nothing                                         | fixed 2.6.5 — asserted, refused by name |
| B-2   | P1  | No recovery path for a forgotten passphrase and no scheduled backup at all, in an app whose whole feature exists because a lost phone ended labs | open                                    |
| B-3   | P1  | No pre-restore snapshot and no diff, so a wrong restore cannot be undone                                                                         | open                                    |
| B-4   | P2  | `fromHex` silently truncated odd-length hex and mapped bad characters to `0`, so a mistyped file reported "wrong passphrase"                     | fixed 2.6.5 — exact length + charset    |
| B-5   | P2  | Passphrase fields left in component state after a seal                                                                                           | already handled in the panel            |
| B-6/7 | P2  | Whole-file string round-trips for multi-MB snapshots; nothing verifies a written export                                                          | open                                    |

## 12. UI components

| #   | Sev | Finding                                                                                                  | Status               |
| --- | --- | -------------------------------------------------------------------------------------------------------- | -------------------- |
| U-1 | P1  | see F-3                                                                                                  | fixed 2.6.5 (viewer) |
| U-2 | P2  | `readSettings()` inside a memo → masthead edits while a report sheet is open show stale text             | open                 |
| U-3 | P2  | Report A → B paints A's numbers for one frame                                                            | open                 |
| U-4 | P2  | Double-labelled controls (Field label + `aria-label`); no live region for print progress                 | open                 |
| U-5 | P2  | Barrel and deep imports mixed                                                                            | open                 |
| U-6 | P2  | No component test for the viewer, the center, the backup panel, the layout editor or either detail sheet | open                 |

## Cross-cutting, still owed

- No device/E2E pass for print → share → export; unit coverage is strong (397 tests) but the output paths are platform glue.
- No volume fixture (~5k patients / 20k reports), so the store and analytics performance work cannot be measured.
- `.qoder/repowiki` is stale — it still documents Firebase Auth, Firestore security rules, realtime sync, QR verification and cryptographic signing, none of which exist.
- PDF Unicode font (F-1) is the largest remaining user-visible correctness risk for Indian-language records.
