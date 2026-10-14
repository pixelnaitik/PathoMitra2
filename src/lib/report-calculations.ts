/**
 * Clinical auto-calculations for pathology reports.
 * Derived results (absolute counts, red-cell indices) are recomputed whenever
 * a dependent raw value changes.
 */

/**
 * Strict numeric parse for a raw measurement cell.
 *
 * `parseFloat('60abc')` returns 60 and `parseFloat('  7 ')` returns 7 — so the
 * old code happily derived a clinical value from text the operator never typed,
 * or from a half-entered field. This accepts ONLY a complete signed integer or
 * decimal (optionally surrounding whitespace); anything else — blank, a word,
 * `12.`, `1e3`, a value with trailing junk — is `null` (not a valid measurement).
 * Whether a valid number is also *clinically* plausible is checked at each use.
 */
function parseMeasurement(value: string | undefined): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || !/^[+-]?\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

const WBC_TOTAL = 'WHITE CELL COUNT(TC)';

/**
 * Differential percentages (0–100) and the absolute count each one produces from
 * the total WBC. The output names are the catalogue's canonical test names from
 * `src/lib/pathology-tests.ts` — note `ABSOLUTE EOSINOPHILL COUNT` keeps the
 * catalogue's spelling (double L) so the derived value matches the listed test;
 * the *input* field is `EOSINOPHIL` (single L). Do not "fix" the output spelling
 * in isolation — it would break that match.
 */
const DIFFERENTIALS: ReadonlyArray<{ source: string; output: string }> = [
  { source: 'NEUTROPHIL', output: 'ABSOLUTE NEUTROPHIL COUNT' },
  { source: 'LYMPHOCYTE', output: 'ABSOLUTE LYMPHOCYTE COUNT' },
  { source: 'MONOCYTE', output: 'ABSOLUTE MONOCYTE COUNT' },
  { source: 'EOSINOPHIL', output: 'ABSOLUTE EOSINOPHILL COUNT' },
  { source: 'BASOPHIL', output: 'ABSOLUTE BASOPHIL COUNT' },
];

const RBC_TOTAL = 'RBC (RED BLOOD CELLS)';
const HAEMOGLOBIN = 'HB (HAEMOGLOBIN)';
const HAEMATOCRIT = 'HCT(PCV)';

const WBC_PARAMS: ReadonlyArray<string> = [WBC_TOTAL, ...DIFFERENTIALS.map(d => d.source)];
const RBC_PARAMS: ReadonlyArray<string> = [RBC_TOTAL, HAEMOGLOBIN, HAEMATOCRIT];

/** Write `output` when both inputs are clinically valid, else clear any stale one. */
function derive(
  target: Record<string, string>,
  output: string,
  valid: boolean,
  compute: () => string,
): void {
  if (valid) target[output] = compute();
  else delete target[output];
}

export function recalculateCBC(
  results: Record<string, string>,
  changedName: string,
  changedValue: string,
): Record<string, string> {
  // Keep the operator's raw text in the map; only the derived fields are
  // normalised. This lets an in-progress edit stay visible instead of being
  // silently rewritten to a canonical form.
  const updatedResults = { ...results, [changedName]: changedValue };

  if (WBC_PARAMS.includes(changedName)) {
    const wbc = parseMeasurement(updatedResults[WBC_TOTAL]);
    const wbcValid = wbc !== null && wbc > 0;
    for (const { source, output } of DIFFERENTIALS) {
      const pct = parseMeasurement(updatedResults[source]);
      // A differential is a percentage: reject negatives and anything over 100,
      // not just non-numbers.
      const pctValid = pct !== null && pct >= 0 && pct <= 100;
      derive(updatedResults, output, wbcValid && pctValid, () =>
        (((pct as number) / 100) * (wbc as number)).toFixed(2),
      );
    }
  }

  if (RBC_PARAMS.includes(changedName)) {
    const rbc = parseMeasurement(updatedResults[RBC_TOTAL]);
    const hb = parseMeasurement(updatedResults[HAEMOGLOBIN]);
    const hct = parseMeasurement(updatedResults[HAEMATOCRIT]);
    // Counts are non-negative; the denominators (RBC for MCV/MCH, HCT for MCHC)
    // must be strictly positive. A missing/invalid input clears the dependent
    // index instead of leaving an earlier value on screen (P0.2 stale-derived).
    const rbcValid = rbc !== null && rbc > 0;
    const hbValid = hb !== null && hb >= 0;
    const hctValid = hct !== null && hct >= 0;
    derive(updatedResults, 'MCV', rbcValid && hctValid, () =>
      (((hct as number) * 10) / (rbc as number)).toFixed(1),
    );
    derive(updatedResults, 'MCH', rbcValid && hbValid, () =>
      (((hb as number) * 10) / (rbc as number)).toFixed(1),
    );
    const hctPositive = hct !== null && hct > 0;
    derive(updatedResults, 'MCHC', hbValid && hctPositive, () =>
      (((hb as number) * 100) / (hct as number)).toFixed(1),
    );
  }

  return updatedResults;
}
