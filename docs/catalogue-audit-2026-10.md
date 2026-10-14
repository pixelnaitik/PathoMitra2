# Pathology catalogue — 2026-10 audit & implementation report

Scope: the "Enhance Existing Pathology Database for Indian Laboratories" brief, executed against
`src/lib/pathology-tests.ts` and its consumers. Verified 2026-10-11 by `npx vitest run`
(251 passed), `npm run lint:ci` (0 errors, 20 warnings — all pre-existing), `npm run build`.

## Population model (the decision that drove everything else)

Reference ranges now exist for exactly three populations:

| Population   | Applies to         |
| ------------ | ------------------ |
| Adult male   | 12 years and above |
| Adult female | 12 years and above |
| Infant       | 0 – 24 months      |

The old `child` band (0 – 12 years) is **gone**. `2 – 11 years` therefore has no band of its own:
the adult interval is shown, and `resolveReferenceRange()` reports `unverifiedForPatient: true`
with a `reason` for that row.

**As of 2026-10-11 that flag is computed but deliberately not displayed.** The lab removed it
from the product: the ⚠ chip in the report editor, the `*` on the A4 reference-range cell, the
"Reference range caveat" block above the signature, and the jsPDF footnote are all gone. The
trigger was noise — a CBC for a 2-year-old printed twenty near-identical caveat lines on page 2
and pushed the signature block down a page.

The resolver still returns the flag (and the tests still assert a child can never inherit an
adult range _silently_ at the model level), so reinstating it is one render site, not a redesign.
If it comes back, prefer one line per report — "Reference ranges shown are adult values; this
patient's age band is not established" — over one line per parameter.

`resolveReferenceRange()` in `pathology-tests.ts` is now the single source of truth for the editor,
the A4 preview, the PDF table and the timeline flags — a range cannot read one way on screen and
another way on paper.

### Known limitations of the model, stated plainly

1. **Patient age is stored in whole years** (`PatientSchema.age`, and the registration form is a
   plain number input). `age < 2` is the closest representable "0–24 months", so a 23-month-old and
   a 25-month-old sit on opposite sides of the boundary. A month unit or date-of-birth on the
   patient record is the fix, and it is a product decision, not a bug.
2. **Neonates (0–28 days) are not a separate population** — a newborn lands in the Infant band.
   Several tests (Hb, TLC, differential, bilirubin) differ materially in the first weeks. The lab
   director must accept or reject this.
3. **The 14 infant bands were inherited from the legacy 0–12 yr `child` band**, not established for
   infancy. Each carries `verification: 'requires-lab-verification'` and the source string says so.
   They are closer to paediatric truth than the adult numbers are, but they are not approved
   infant ranges.

## §11 deliverable — numbers

1. **Preserved:** all 97 original entries — ids, names, units, synonyms, ordering untouched.
   Historical reports resolve rows by test name, and `getStandaloneTests`/`getSearchableTests`
   behaviour for the five original panels is unchanged (asserted in the test suite).
2. **Added:** 66 entries — 51 individual tests and 15 profiles, all appended below the original
   list. Catalogue is now 163 entries (138 tests, 20 profiles, 5 section headers).
   - New coverage: thyroid (TSH, T3, T4, FT3, FT4, anti-TPO), reproductive hormones
     (testosterone, prolactin, FSH, LH, fasting insulin), vitamins and iron (D, B12, folate, iron,
     TIBC, ferritin), electrolytes and minerals (Na, K, Cl, Ca, P, Mg), liver/kidney additions
     (GGT, LDH, eGFR, microalbuminuria), pancreatic enzymes (amylase, lipase), cardiac and
     inflammation markers (troponin I, CK-MB, CPK, D-dimer, CRP, hs-CRP), glucose dynamics
     (OGTT 2-h), haematology (peripheral smear, malaria antigen, G6PD), **stool examination**
     (a category that was entirely absent — 8 parameters) and three culture & sensitivity tests.
   - New profiles: Thyroid, Thyroid extended, KFT, LFT, Blood sugar, Electrolyte, Iron studies,
     Anaemia, Vitamin, Fever, Antenatal, Cardiac markers, Rheumatoid arthritis, Pancreas, Stool.
3. **Enriched:** 15 existing records gained missing synonyms (CBC, URINE ANALYSIS — which had
   none, Hb, platelet, FBS/PPBS/RBS, HbA1c, lipid profile, ESR, HBsAg, RA, malaria parasite,
   dengue, pregnancy test).
4. **Reference intervals:** 58 newly added bands, every one marked
   `requires-lab-verification`; 14 inherited infant bands likewise marked. **0 intervals claim
   approval, and none were copied from a named Indian authority** — no ICMR / NABH / national
   programme value was verified during this work, and claiming one would have been a fabrication.
   See "What still needs a human" below.
5. **Categories still thin:** urine chemistry has no albumin/creatinine ratio; no hormone panel
   beyond thyroid/reproductive (cortisol, ACTH, DHEA, PSA, AMH); no TORCH or viral serology
   beyond HBsAg/HCV/HIV/Dengue/Chikungunya; no allergy, no histopathology/cytopathology items,
   no hormone stimulation tests; CSF and other body-fluid examinations absent; no
   quantitative immunology (IgG/IgA/IgM).
6. **Sources used:** none citable. Intervals follow conventional textbook/lab-menu values and are
   flagged as awaiting verification. This is the honest state, not a shortfall of effort.
7. **Tests run:** `vitest run` 251 passed / 20 files (14 of them new, in
   `pathology-tests.test.ts`); `tsc --noEmit` clean; `eslint .` 0 errors; `vite build` succeeds.
   New coverage includes a catalogue-wide safety net: **no child or infant can inherit an adult
   range anywhere in the catalogue without being flagged**, every numeric test resolves an adult
   interval, every profile member resolves to a real record, and every original ordering position
   is preserved.
8. **Needs the lab director / a qualified pathologist:** see the last section — this is the gate
   before any of the added ranges may be treated as approved.

## Bugs and hazards found during the audit (not silently changed)

1. **Two records share the lookup key `Albumin`.** `lft_alb` (serum albumin, g/dL, numeric) and
   `urine_albumin` (urine albumin, `Negative/Trace/+/++` options). `findTestInfo()` returns the
   first match, so a serum-albumin row on an LFT reads the urine record's options and loses its
   numeric range. Renaming either would rewrite historical reports (reports store the test name as
   the `resultData` key), so it is reported instead. Recommended: rename the LFT record to
   `Serum Albumin` and migrate the affected historical rows deliberately, with the lab's sign-off.
   `auditPathologyCatalogue()` reports it, and a test asserts it stays reported.
2. **`HAEMATOLOGY` vs `HEMOTOLOGY`** — 32 vs 21 entries. The misspelling splits the category
   grouping in the picker and on reports. Fixing it changes how existing reports group rows, so it
   needs a decision rather than a find-and-replace.
3. **A custom test saved with an empty range printed `0 - 0`.** The label falls back to the
   numeric bounds when `text` is empty, and an empty custom range had neither. The settings form now
   stores only populated bands, so an unset range prints as no range.
4. **`Ranges` were not editable per population anywhere.** The custom-test form only ever wrote a
   single `general` text. It now has Adult male / Adult female / Infant fields alongside it, and the
   settings list shows every populated band instead of only the general one.

## Search behaviour (§6)

`normalizeSearchTerm()` folds punctuation and spacing (`H.D.L.` ≡ `hdl`), British/American
spelling (`haemoglobin` ≡ `hemoglobin`, `oedema` ≡ `edema`), trailing plurals (`platelets` ≡
`platelet`) and typed accents. It is applied as **extra tiers ranked one point below their raw
equivalents**, so an exact catalogue-name match still outranks a normalised hit and existing
ranking is undisturbed. A multi-word tier matches when every query word appears in the name or a
synonym, in any order (`sugar fasting` → Blood Sugar Fasting). Hinglish aliases were added where
they are genuinely typed at the counter (`khali pet sugar`, `khane ke baad ki sugar`,
`khoon ki kami`, `peshab`, `3 mahine ki sugar`, `mosa`, `bukhar`, `tavabuk`, `break bone fever`,
`australian antigen`). Ambiguous terms still return distinct clinically-different tests rather than
auto-selecting one (`sugar` → FBS, PPBS, RBS, OGTT).

`auditPathologyCatalogue()` is the duplicate-detection tool: duplicate ids, duplicate names
(one lookup key, first record wins), duplicate synonyms within a record, synonym collisions across
records, and profile members that name a record which does not exist.

## What was NOT done, and why

- **§7 range-management workflow** (lab-specific overrides, effective dates, approval roles, change
  history, preview-before-activate). The data model now carries `source`, `verification` and
  `lastReviewed` per band, and the settings form writes bands — but the workflow needs a Firestore
  schema decision (per-lab collection vs. document field), a role gate for "authorised staff", and
  a migration plan for already-signed reports. That is a feature, not a data edit, and it should be
  planned before it is built.
- **§9 backup / migration mechanism** — the catalogue lives in source, versioned by git; there is no
  runtime database to migrate. Custom tests are in local settings and were not touched.
- **Search analytics / frequently-searched terms** — needs a storage decision and a privacy review
  (search terms in a pathology lab are one step from patient data).
- **Synonym administration UI** (add/edit/remove aliases on any catalogue record) — only _custom_
  tests are editable today; built-in records are still source-only.
- **CBC with ESR as a separate profile** — the brief lists it "where offered as a separate profile",
  and profile composition varies by lab. Inventing a composition would be exactly the assumption
  §3 warns against; it needs the lab's own price list.
- **No visual verification on a signed report** — reaching a real report needs lab credentials.
  The caveat rendering is covered by unit tests on the resolver, not by a screenshot.

## What still needs a human before this ships as "clinical"

1. Verify or replace all 72 flagged intervals (58 new + 14 inherited infant bands) against the
   lab's own method and an Indian reference source, then set `verification: 'approved'`,
   `source`, and `lastReviewed` on each band.
2. Decide the neonate question (limitation 2 above) — either accept the Infant band for 0–28 days
   or add a neonatal band.
3. Decide the 2–11 year question — the adult range is now applied with **no** printed caveat
   (removed 2026-10-11), which makes establishing a paediatric band more urgent, not less.
4. Confirm each new profile's composition and price against the lab's actual menu.
5. Resolve the two `Albumin` records and the `HEMOTOLOGY` spelling.
