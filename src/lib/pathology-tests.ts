import { readCustomTests } from './settings';

/**
 * The three populations a report may carry an interval for:
 * **Adult male**, **Adult female** and **Infant**.
 *
 * The boundaries are a product decision, not clinical law, so they live here as
 * named constants rather than magic numbers:
 *
 *  • Infant            — 0 up to `INFANT_MAX_AGE_YEARS` (the 0–24 month band).
 *                        Patient ages are whole years (`ageAsNumber` in
 *                        lib/models.ts — the registration form has no month
 *                        field), so `age < 2` is the closest representable
 *                        "0–24 months". A 24-month-old is therefore already on
 *                        the adult band; give the patient record a month unit
 *                        before that boundary starts to matter clinically.
 *  • Adult male/female — `ADULT_MIN_AGE_YEARS` and above.
 *  • 2 – 11 years      — deliberately has no band of its own. The adult
 *                        interval is used and the row comes back
 *                        `unverifiedForPatient`, so the report says the range
 *                        is not age-validated instead of implying one. Restore
 *                        a paediatric band the day the lab establishes it.
 *
 * Neonates (0–28 days) are not a separate population either — a newborn lands
 * in the Infant band. That is a known simplification and is called out in the
 * implementation report for the lab director to accept or reject.
 */
export const INFANT_MAX_AGE_YEARS = 2;
export const ADULT_MIN_AGE_YEARS = 12;

/** Whether a lab has signed off on an interval. Absent means "no claim made". */
export type RangeVerification = 'approved' | 'requires-lab-verification';

export interface RangeBand {
  min?: number;
  max?: number;
  /** Free-text form, used verbatim when it is what the lab reports. */
  text?: string;
  /** Where the interval came from (ICMR guideline, Tietz, in-house study…). */
  source?: string;
  /**
   * `requires-lab-verification` is rendered as a badge on the report and must
   * never be presented as an approved interval. Leave unset for ranges the
   * catalogue has always shipped (no claim either way).
   */
  verification?: RangeVerification;
  /** ISO date the band was last reviewed. */
  lastReviewed?: string;
}

export interface ReferenceRange {
  /** Adult male — `ADULT_MIN_AGE_YEARS` and above. */
  male?: RangeBand;
  /** Adult female — `ADULT_MIN_AGE_YEARS` and above. */
  female?: RangeBand;
  /** Infant — 0 to 24 months. */
  infant?: RangeBand;
  /**
   * Interval that does not vary by sex or age: qualitative results, titers,
   * urine microscopy, and every test the lab reports as one number for all.
   * Not a fourth population — it is the absence of a split.
   */
  general?: RangeBand;
}

export interface PathologyTest {
  id: string;
  name: string;
  category: string;
  unit?: string;
  /**
   * Explicit result kind. When present it always wins over inference in
   * `resolveTestKind` — prefer declaring it for any custom test whose unit or
   * reference-range text is ambiguous (e.g. "< 5", "NEGATIVE", "1:100").
   */
  kind?: TestKind;
  ranges?: ReferenceRange;
  method?: string;
  /** Specimen the test runs on — printed on the requisition (Serum, Urine, Stool…). */
  specimen?: string;
  /** Collection container / handling the lab has to supply (EDTA, citrate, fluoride…). */
  container?: string;
  /** Patient preparation the result depends on (fasting, 75 g glucose load, timing). */
  preparation?: string;
  /** ISO date this record's clinical data was last reviewed against a source. */
  lastReviewed?: string;
  notes?: string[];
  clinicalSignificance?: string;
  isGroup?: boolean;
  /**
   * Whether this panel's components disappear from the individual-test browse
   * list. `undefined`/true is the long-standing behaviour (CBC, WIDAL, URINE
   * ANALYSIS — their members are only added through the parent panel). New
   * profiles set it to false so that tests which were always pickable on their
   * own — creatinine, bilirubin, HbA1c — stay pickable after a profile is
   * introduced. Adding a profile must never remove an existing way to order a
   * test.
   */
  hideMembersFromBrowse?: boolean;
  isHeader?: boolean;
  includedTests?: string[];
  options?: string[];
  synonyms?: string[];
}

/**
 * How a test's result is entered and validated.
 * - `numeric`     — a number, colour-coded against the reference range
 * - `categorical` — one of a fixed set of `options` (e.g. blood group)
 * - `titer`       — a dilution ratio such as `1:160`
 * - `text`        — free text / qualitative word (e.g. "NEGATIVE")
 */
export type TestKind = 'numeric' | 'categorical' | 'titer' | 'text';

/** Units and range texts that are words, not measurements. */
const QUALITATIVE_TEXTS = [
  'negative',
  'positive',
  'non-reactive',
  'reactive',
  'absent',
  'present',
  'few',
  'nil',
  'normal',
];

/** `1:160`, `1 in 80`, `<1:40` — a dilution rather than a plain measurement. */
const TITER_PATTERN = /\d+\s*[:/]\s*\d+/;

const rangeEntries = (ranges?: ReferenceRange) =>
  ranges ? [ranges.general, ranges.male, ranges.female, ranges.infant] : [];

/**
 * Determine how a test's result should be treated.
 *
 * Previously this logic lived inside ReportsPage as `isNumericTest(testInfo: any)`
 * and inferred the type from `ranges.text`, which mis-classified values like
 * `"< 5"` (read as numeric, fine) and `"NEGATIVE"` (also read as numeric, wrong).
 * An explicit `kind` on the test now short-circuits all inference.
 */
export function resolveTestKind(test?: PathologyTest | null): TestKind {
  if (!test || test.isGroup || test.isHeader) return 'text';
  if (test.kind) return test.kind;
  if (test.options && test.options.length > 0) return 'categorical';

  const unit = (test.unit ?? '').toLowerCase().trim();
  if (unit === 'titer' || unit.includes(':')) return 'titer';

  const texts = rangeEntries(test.ranges)
    .map(r => (r?.text ?? '').trim().toLowerCase())
    .filter(Boolean);

  if (texts.some(t => TITER_PATTERN.test(t))) return 'titer';

  const hasNumericBounds = rangeEntries(test.ranges).some(
    r => typeof r?.min === 'number' || typeof r?.max === 'number',
  );
  if (hasNumericBounds) return 'numeric';

  // A range containing a digit ("< 5", "18-22") implies a measurement, unless
  // every range is a plain qualitative word.
  if (texts.some(t => /[0-9]/.test(t))) return 'numeric';
  if (texts.some(t => QUALITATIVE_TEXTS.includes(t))) return 'text';

  if (unit && !QUALITATIVE_TEXTS.includes(unit)) return 'numeric';
  return 'text';
}

/** True when the result is a number that can be checked against a range. */
export const isNumericTest = (test?: PathologyTest | null): boolean =>
  resolveTestKind(test) === 'numeric';

/**
 * Every `infant` band in the catalogue below was inherited verbatim from the
 * old `child` band, which covered 0–12 years and was never established for
 * 0–24 months. It is still closer to a paediatric interval than the adult one
 * is, so it is kept — but marked, so no report can present it as an approved
 * infant range. Replace band by band as the lab validates each, then drop the
 * marker (and this comment) once none of them are inherited.
 */
const INHERITED_PAEDIATRIC_BAND = {
  verification: 'requires-lab-verification' as const,
  source: 'Inherited from the legacy 0–12 yr band; not validated for 0–24 months',
};

/**
 * Marker on every interval added by the 2026-10 catalogue expansion. These are
 * conventional values seen in Indian practice, not this laboratory's approved
 * ranges: no method validation was done here and no Indian authority was
 * quoted, because doing either would be a claim the code cannot support. They
 * render with the report caveat until the lab confirms or replaces them.
 */
const UNVERIFIED_INTERVAL = {
  verification: 'requires-lab-verification' as const,
  source: 'Added 2026-10 as a conventional value — awaiting laboratory verification',
};

/** Shorthand for the common single-interval case: one range, every patient. */
const generalText = (text: string) => ({ general: { text, ...UNVERIFIED_INTERVAL } });

export const DEFAULT_PATHOLOGY_TESTS: PathologyTest[] = [
  // Full Group CBC
  {
    id: 'cbc_group',
    name: 'CBC (COMPLETE BLOOD COUNT)',
    category: 'HAEMATOLOGY',
    isGroup: true,
    synonyms: [
      'cbc',
      'complete blood count',
      'hemogram',
      'cbp',
      'complete blood picture',
      'blood test',
      'khoon ki report',
    ],
    includedTests: [
      'WHITE CELL COUNT(TC)',
      'DIFFERENTIAL COUNT WBC',
      'NEUTROPHIL',
      'LYMPHOCYTE',
      'EOSINOPHIL',
      'MONOCYTE',
      'BASOPHIL',
      'DIFFERENTIAL LEUCOCYTE ABSOLUTE COUNT',
      'ABSOLUTE NEUTROPHIL COUNT',
      'ABSOLUTE LYMPHOCYTE COUNT',
      'ABSOLUTE MONOCYTE COUNT',
      'ABSOLUTE EOSINOPHILL COUNT',
      'ABSOLUTE BASOPHIL COUNT',
      'RBC (RED BLOOD CELLS)',
      'HB (HAEMOGLOBIN)',
      'HCT(PCV)',
      'MCV',
      'MCH',
      'MCHC',
      'RDW%',
      'RDW-SD',
      'PLATELET COUNT',
      'MPV',
      'PDW',
      'PCT',
      'P-LCC',
      'P-LCR',
    ],
  },

  {
    id: 'wbc_tc',
    name: 'WHITE CELL COUNT(TC)',
    category: 'HAEMATOLOGY',
    unit: 'x10³/Cu.mm',
    ranges: {
      infant: { min: 5.0, max: 14.5, text: '5.0 - 14.5', ...INHERITED_PAEDIATRIC_BAND },
      male: { min: 4.0, max: 11.0, text: '4.0 - 11.0' },
      female: { min: 4.0, max: 11.0, text: '4.0 - 11.0' },
      general: { min: 4.0, max: 11.0, text: '4.0 - 11.0' },
    },
  },
  {
    id: 'diff_wbc_header',
    name: 'DIFFERENTIAL COUNT WBC',
    category: 'HAEMATOLOGY',
    isHeader: true,
  },
  {
    id: 'neutrophil',
    name: 'NEUTROPHIL',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '40 - 65' } },
  },
  {
    id: 'lymphocyte',
    name: 'LYMPHOCYTE',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '20 - 40' } },
  },
  {
    id: 'eosinophil',
    name: 'EOSINOPHIL',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '1 - 6' } },
  },
  {
    id: 'monocyte',
    name: 'MONOCYTE',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '2 - 8' } },
  },
  {
    id: 'basophil',
    name: 'BASOPHIL',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '0 - 2' } },
  },

  {
    id: 'diff_abs_header',
    name: 'DIFFERENTIAL LEUCOCYTE ABSOLUTE COUNT',
    category: 'HAEMATOLOGY',
    isHeader: true,
  },
  {
    id: 'abs_neutrophil',
    name: 'ABSOLUTE NEUTROPHIL COUNT',
    category: 'HAEMATOLOGY',
    unit: 'x10³/Cu.mm',
    ranges: { general: { text: '1.8 - 7.8' } },
  },
  {
    id: 'abs_lymphocyte',
    name: 'ABSOLUTE LYMPHOCYTE COUNT',
    category: 'HAEMATOLOGY',
    unit: 'x10³/Cu.mm',
    ranges: { general: { text: '1.0 - 4.8' } },
  },
  {
    id: 'abs_monocyte',
    name: 'ABSOLUTE MONOCYTE COUNT',
    category: 'HAEMATOLOGY',
    unit: 'x10³/Cu.mm',
    ranges: { general: { text: '0 - 0.8' } },
  },
  {
    id: 'abs_eosinophil',
    name: 'ABSOLUTE EOSINOPHILL COUNT',
    category: 'HAEMATOLOGY',
    unit: 'x10³/Cu.mm',
    ranges: { general: { text: '0 - 0.45' } },
  },
  {
    id: 'abs_basophil',
    name: 'ABSOLUTE BASOPHIL COUNT',
    category: 'HAEMATOLOGY',
    unit: 'x10³/Cu.mm',
    ranges: { general: { text: '0 - 0.2' } },
  },

  {
    id: 'rbc',
    name: 'RBC (RED BLOOD CELLS)',
    category: 'HAEMATOLOGY',
    unit: 'mill/cumm',
    ranges: {
      infant: { min: 4.0, max: 5.2, text: '4.0 - 5.2', ...INHERITED_PAEDIATRIC_BAND },
      male: { min: 4.5, max: 5.5, text: '4.5 - 5.5' },
      female: { min: 3.8, max: 4.8, text: '3.8 - 4.8' },
      general: { min: 3.8, max: 5.5, text: '3.8 - 5.5' },
    },
  },
  {
    id: 'hb',
    name: 'HB (HAEMOGLOBIN)',
    category: 'HAEMATOLOGY',
    unit: 'gm/dl',
    ranges: {
      infant: { min: 11.0, max: 14.5, text: '11.0 - 14.5', ...INHERITED_PAEDIATRIC_BAND },
      male: { min: 13.5, max: 17.5, text: '13.5 - 17.5' },
      female: { min: 12.0, max: 15.0, text: '12.0 - 15.0' },
      general: { min: 12.0, max: 17.5, text: '12.0 - 17.5' },
    },
    synonyms: ['hemoglobin (hb)', 'hemoglobin', 'haemoglobin', 'hb', 'khoon ki kami test'],
  },
  {
    id: 'hct',
    name: 'HCT(PCV)',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: {
      infant: { min: 35.0, max: 43.0, text: '35 - 43', ...INHERITED_PAEDIATRIC_BAND },
      male: { min: 40.0, max: 50.0, text: '40 - 50' },
      female: { min: 36.0, max: 46.0, text: '36 - 46' },
      general: { min: 36.0, max: 50.0, text: '36 - 50' },
    },
  },
  {
    id: 'mcv',
    name: 'MCV',
    category: 'HAEMATOLOGY',
    unit: 'fL',
    ranges: { general: { text: '80-100' } },
  },
  {
    id: 'mch',
    name: 'MCH',
    category: 'HAEMATOLOGY',
    unit: 'pg',
    ranges: { general: { text: '26-32' } },
  },
  {
    id: 'mchc',
    name: 'MCHC',
    category: 'HAEMATOLOGY',
    unit: 'gm%',
    ranges: { general: { text: '32-38' } },
  },
  {
    id: 'rdw_cv',
    name: 'RDW%',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '11.5-14.5' } },
  },
  {
    id: 'rdw_sd',
    name: 'RDW-SD',
    category: 'HAEMATOLOGY',
    unit: 'fL',
    ranges: { general: { text: '37.0-54.0' } },
  },

  {
    id: 'platelet',
    name: 'PLATELET COUNT',
    category: 'HAEMATOLOGY',
    unit: 'lakh/cumm',
    ranges: { general: { text: '1.5-4.5' } },
    synonyms: ['platelets', 'thrombocyte count', 'platelet test'],
  },
  {
    id: 'mpv',
    name: 'MPV',
    category: 'HAEMATOLOGY',
    unit: 'fL',
    ranges: { general: { text: '7.4-10.4' } },
  },
  {
    id: 'pdw',
    name: 'PDW',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '10.0-17.0' } },
  },
  {
    id: 'pct',
    name: 'PCT',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '0.15-0.5' } },
  },
  {
    id: 'p_lcc',
    name: 'P-LCC',
    category: 'HAEMATOLOGY',
    unit: 'lakh/Cumm',
    ranges: { general: { text: '30-90' } },
  },
  {
    id: 'p_lcr',
    name: 'P-LCR',
    category: 'HAEMATOLOGY',
    unit: '%',
    ranges: { general: { text: '13.0-43.0' } },
  },

  // WIDAL REACTION
  {
    id: 'widal_group',
    name: 'WIDAL REACTION',
    category: 'SEROLOGY',
    synonyms: [
      'widal',
      'widal test',
      'typhoid',
      'typhoid test',
      'typhi',
      'paratyphi',
      'enteric fever',
      'fever',
    ],
    isGroup: true,
    includedTests: [
      "S. typhi 'o'",
      "S. typhi 'H'",
      'S. Para Typhi "A(H)"',
      'S. para Typhi "B(H)"',
      'Impression',
    ],
  },
  {
    id: 'widal_o',
    name: "S. typhi 'o'",
    category: 'SEROLOGY',
    unit: 'titer',
    options: ['Negative', '1:20', '1:40', '1:80', '1:160', '1:320'],
    ranges: { general: { text: 'Negative' } },
    synonyms: ['typhoid o', 'typhi o', 'widal o', 'o titre', 's typhi o'],
  },
  {
    id: 'widal_h',
    name: "S. typhi 'H'",
    category: 'SEROLOGY',
    unit: 'titer',
    options: ['Negative', '1:20', '1:40', '1:80', '1:160', '1:320'],
    ranges: { general: { text: 'Negative' } },
    synonyms: ['typhoid h', 'typhi h', 'widal h', 'h titre', 's typhi h'],
  },
  {
    id: 'widal_ah',
    name: 'S. Para Typhi "A(H)"',
    category: 'SEROLOGY',
    unit: 'titer',
    options: ['Negative', '1:20', '1:40', '1:80', '1:160', '1:320'],
    ranges: { general: { text: 'Negative' } },
    synonyms: ['paratyphi a', 'typhoid a', 'para typhi a', 'ah titre'],
  },
  {
    id: 'widal_bh',
    name: 'S. para Typhi "B(H)"',
    category: 'SEROLOGY',
    unit: 'titer',
    options: ['Negative', '1:20', '1:40', '1:80', '1:160', '1:320'],
    ranges: { general: { text: 'Negative' } },
    synonyms: ['paratyphi b', 'typhoid b', 'para typhi b', 'bh titre'],
  },
  {
    id: 'widal_impression',
    name: 'Impression',
    category: 'SEROLOGY',
    unit: '',
    options: ['Negative', 'Weak positive', 'Positive'],
    ranges: { general: { text: '' } },
  },

  // URINE ANALYSIS
  {
    id: 'urine_analysis_group',
    name: 'URINE ANALYSIS',
    category: 'CLINICAL PATHOLOGY',
    isGroup: true,
    synonyms: [
      'urine routine',
      'urine microscopy',
      'urine r/e',
      'urine re',
      'urine examination',
      'peshab test',
      'mosa',
    ],
    includedTests: [
      'PHYSICAL EXAMINATION',
      'Quantity',
      'Colour',
      'Consistency',
      'Sediments',
      'Specific Gravity',
      'CHEMICAL EXAMINATION',
      'Reaction',
      'Sugar',
      'Albumin',
      'Phosphate',
      'Bile Salt',
      'Bile Pigment',
      'Acetone',
      'Urobilinogen',
      'Chyle Test',
      'MICROSCOPICAL EXAMINATION',
      'Erythrocytes',
      'Pus Cells',
      'Epithelial Cells',
      'Casts',
      'Crystals',
    ],
  },
  {
    id: 'urine_phys_header',
    name: 'PHYSICAL EXAMINATION',
    category: 'CLINICAL PATHOLOGY',
    isHeader: true,
  },
  { id: 'urine_quantity', name: 'Quantity', category: 'CLINICAL PATHOLOGY' },
  {
    id: 'urine_colour',
    name: 'Colour',
    category: 'CLINICAL PATHOLOGY',
    options: ['Pale yellow', 'Yellow', 'Amber', 'Red', 'Brown'],
  },
  {
    id: 'urine_consistency',
    name: 'Consistency',
    category: 'CLINICAL PATHOLOGY',
    options: ['Clear', 'Slightly turbid', 'Turbid', 'Cloudy'],
  },
  {
    id: 'urine_sediments',
    name: 'Sediments',
    category: 'CLINICAL PATHOLOGY',
    options: ['Absent', 'Present'],
  },
  {
    id: 'urine_sp_gravity',
    name: 'Specific Gravity',
    category: 'CLINICAL PATHOLOGY',
    ranges: { general: { text: '1.005 - 1.030' } },
  },

  {
    id: 'urine_chem_header',
    name: 'CHEMICAL EXAMINATION',
    category: 'CLINICAL PATHOLOGY',
    isHeader: true,
  },
  {
    id: 'urine_reaction',
    name: 'Reaction',
    category: 'CLINICAL PATHOLOGY',
    options: ['Acidic', 'Alkaline', 'Neutral'],
    ranges: { general: { text: '4.5 - 8.0' } },
  },
  {
    id: 'urine_sugar',
    name: 'Sugar',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Trace', '+', '++', '+++', '++++'],
  },
  {
    id: 'urine_albumin',
    name: 'Albumin',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Trace', '+', '++', '+++', '++++'],
  },
  {
    id: 'urine_phosphate',
    name: 'Phosphate',
    category: 'CLINICAL PATHOLOGY',
    options: ['Absent', 'Present'],
  },
  {
    id: 'urine_bile_salt',
    name: 'Bile Salt',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Positive'],
  },
  {
    id: 'urine_bile_pigment',
    name: 'Bile Pigment',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Positive'],
  },
  {
    id: 'urine_acetone',
    name: 'Acetone',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Positive'],
  },
  {
    id: 'urine_urobilinogen',
    name: 'Urobilinogen',
    category: 'CLINICAL PATHOLOGY',
    unit: 'mg/dL',
    ranges: { general: { text: '0.2-1.0' } },
  },
  {
    id: 'urine_chyle',
    name: 'Chyle Test',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Positive'],
  },

  {
    id: 'urine_mic_header',
    name: 'MICROSCOPICAL EXAMINATION',
    category: 'CLINICAL PATHOLOGY',
    isHeader: true,
  },
  {
    id: 'urine_erythrocytes',
    name: 'Erythrocytes',
    category: 'CLINICAL PATHOLOGY',
    unit: '/HPF',
    ranges: { general: { text: '0-2' } },
  },
  {
    id: 'urine_pus',
    name: 'Pus Cells',
    category: 'CLINICAL PATHOLOGY',
    unit: '/HPF',
    ranges: { general: { text: '0-5' } },
  },
  {
    id: 'urine_epi',
    name: 'Epithelial Cells',
    category: 'CLINICAL PATHOLOGY',
    unit: '/HPF',
    ranges: { general: { text: 'Few' } },
  },
  {
    id: 'urine_casts',
    name: 'Casts',
    category: 'CLINICAL PATHOLOGY',
    unit: '/LPF',
    options: ['Absent', 'Granular', 'Hyaline', 'Cellular'],
  },
  {
    id: 'urine_crystals',
    name: 'Crystals',
    category: 'CLINICAL PATHOLOGY',
    options: ['Absent', 'Calcium Oxalate', 'Uric Acid', 'Triple Phosphate'],
  },

  // LFT and KFT individual tests (removed groups as requested)
  {
    id: 'lft_tot_bil',
    name: 'Total Serum Bilirubin',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dL',
    ranges: { general: { text: '0.2-1.2' } },
    synonyms: ['bilirubin', 'total bilirubin'],
  },
  {
    id: 'lft_conj_bil',
    name: 'Direct Bilirubin',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dL',
    ranges: { general: { text: '0-0.2' } },
    synonyms: ['conjugated bilirubin'],
  },
  {
    id: 'lft_unconj_bil',
    name: 'Indirect Bilirubin',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dL',
    ranges: { general: { text: '0.2-0.8' } },
    synonyms: ['unconjugated bilirubin'],
  },
  {
    id: 'lft_sgot',
    name: 'S.G.O.T.',
    category: 'BIO CHEMISTRY',
    unit: 'unit/l',
    ranges: {
      infant: { min: 15, max: 55, text: '15 - 55', ...INHERITED_PAEDIATRIC_BAND },
      male: { max: 40, text: '5 - 40' },
      female: { max: 35, text: '5 - 35' },
      general: { min: 5, max: 35, text: '5 - 35' },
    },
    synonyms: ['sgot', 'ast', 'aspartate aminotransferase'],
  },
  {
    id: 'lft_sgpt',
    name: 'S.G.P.T.',
    category: 'BIO CHEMISTRY',
    unit: 'unit/l',
    ranges: {
      infant: { min: 10, max: 40, text: '10 - 40', ...INHERITED_PAEDIATRIC_BAND },
      male: { max: 45, text: '7 - 45' },
      female: { max: 35, text: '7 - 35' },
      general: { min: 1, max: 40, text: '1 - 40' },
    },
    synonyms: ['sgpt', 'alt', 'alanine aminotransferase'],
  },
  {
    id: 'lft_tot_prot',
    name: 'Total Protein',
    category: 'BIO CHEMISTRY',
    unit: 'g/dL',
    ranges: { general: { text: '6.0-8.3' } },
    synonyms: ['protein'],
  },
  {
    id: 'lft_alb',
    name: 'Albumin',
    category: 'BIO CHEMISTRY',
    unit: 'g/dL',
    ranges: { general: { text: '3.5-5.0' } },
  },
  {
    id: 'lft_alp',
    name: 'Alkaline Phosphaphates',
    category: 'BIO CHEMISTRY',
    unit: 'U/L',
    ranges: {
      infant: { min: 100, max: 350, text: '100 - 350', ...INHERITED_PAEDIATRIC_BAND },
      male: { min: 53, max: 128, text: '53 - 128' },
      female: { min: 42, max: 98, text: '42 - 98' },
      general: { min: 44, max: 147, text: '44 - 147' },
    },
    synonyms: ['alp', 'alkaline phosphatase'],
  },

  // KIDNEY FUNCTION TEST
  {
    id: 'kft_urea',
    name: 'Blood Urea',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: {
      infant: { min: 5, max: 36, text: '5 - 36', ...INHERITED_PAEDIATRIC_BAND },
      male: { min: 15, max: 45, text: '15 - 45' },
      female: { min: 10, max: 40, text: '10 - 40' },
      general: { min: 20, max: 40, text: '20 - 40' },
    },
    synonyms: ['urea', 'bun'],
  },
  {
    id: 'kft_uric_acid',
    name: 'Uric Acid',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: {
      infant: { min: 2.0, max: 5.5, text: '2.0 - 5.5', ...INHERITED_PAEDIATRIC_BAND },
      male: { min: 3.5, max: 7.2, text: '3.5 - 7.2' },
      female: { min: 2.6, max: 6.0, text: '2.6 - 6.0' },
      general: { min: 2.6, max: 7.2, text: '2.6 - 7.2' },
    },
    synonyms: ['uric'],
  },
  {
    id: 'kft_creat',
    name: 'S. creatinine',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: {
      infant: { min: 0.3, max: 0.7, text: '0.3 - 0.7', ...INHERITED_PAEDIATRIC_BAND },
      male: { min: 0.7, max: 1.3, text: '0.7 - 1.3' },
      female: { min: 0.6, max: 1.1, text: '0.6 - 1.1' },
      general: { min: 0.6, max: 1.3, text: '0.6 - 1.3' },
    },
    synonyms: ['creatinine', 'creat'],
  },

  // LIPID PROFILE
  {
    id: 'lipid_group',
    name: 'LIPID PROFILE',
    category: 'BIO CHEMISTRY',
    isGroup: true,
    synonyms: ['lipid', 'cholesterol profile', 'lipid profile', 'lipid panel', 'cholesterol test'],
    includedTests: ['Total cholestrol', 'H.D.L.', 'L.D.L.', 'Triglyceride'],
  },
  {
    id: 'lipid_chol',
    name: 'Total cholestrol',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: {
      infant: { min: 100, max: 170, text: '100 - 170', ...INHERITED_PAEDIATRIC_BAND },
      male: { min: 130, max: 200, text: '130 - 200' },
      female: { min: 130, max: 200, text: '130 - 200' },
      general: { min: 130, max: 200, text: '130 - 200' },
    },
    synonyms: ['cholesterol'],
  },
  {
    id: 'lipid_hdl',
    name: 'H.D.L.',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dL',
    ranges: {
      infant: { min: 45, text: '>= 45', ...INHERITED_PAEDIATRIC_BAND },
      male: { min: 40, text: '>= 40' },
      female: { min: 50, text: '>= 50' },
      general: { min: 40, text: 'M: >= 40, F: >= 50' },
    },
    synonyms: ['hdl', 'good cholesterol'],
  },
  {
    id: 'lipid_ldl',
    name: 'L.D.L.',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dL',
    ranges: {
      infant: { max: 110, text: '< 110', ...INHERITED_PAEDIATRIC_BAND },
      male: { max: 100, text: '< 100' },
      female: { max: 100, text: '< 100' },
      general: { max: 100, text: '< 100' },
    },
    synonyms: ['ldl', 'bad cholesterol'],
  },
  {
    id: 'lipid_trig',
    name: 'Triglyceride',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: { general: { text: '40-160' } },
    synonyms: ['triglycerides', 'tg'],
  },

  // DIABETIC
  {
    id: 'bs_f',
    name: 'Blood Sugar Fasting',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: { general: { text: '60-100' } },
    synonyms: ['fbs', 'bsf', 'glucose fasting', 'fasting sugar', 'khali pet sugar'],
  },
  {
    id: 'bs_pp',
    name: 'Blood Sugar (PP)',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: { general: { text: 'up to 140' } },
    synonyms: ['ppbs', 'bspp', 'glucose pp', 'post meal sugar', 'khane ke baad ki sugar'],
  },
  {
    id: 'bs_r',
    name: 'Blood Sugar Random',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dl',
    ranges: { general: { text: '60-130' } },
    synonyms: ['rbs', 'bsr', 'glucose random', 'random sugar', 'sugar test'],
  },
  {
    id: 'hba1c',
    name: 'HbA1c',
    category: 'BIO CHEMISTRY',
    unit: '%',
    ranges: { general: { min: 4, max: 5.6, text: '4.0 - 5.6' } },
    synonyms: [
      'glycated hemoglobin',
      'glycated haemoglobin',
      'haemoglobin a1c',
      'hemoglobin a1c',
      'a1c',
      'hb a1c',
      'glycohemoglobin',
      'diabetes test',
      'three month sugar',
      '3 mahine ki sugar',
    ],
  },

  // OTHER HEMOTOLOGY & CLINICAL
  {
    id: 'parasites_mp_mf',
    name: 'Parasites MP / MF',
    category: 'HEMOTOLOGY',
    options: ['Negative', 'Positive'],
    synonyms: ['malaria', 'mp', 'mf', 'malaria test', 'tavabuk test'],
  },
  {
    id: 'esr_1st_hr',
    name: 'E.S.R. 1st Hor',
    category: 'HEMOTOLOGY',
    unit: 'mm',
    ranges: {
      infant: { min: 0, max: 10, text: '0 - 10', ...INHERITED_PAEDIATRIC_BAND },
      male: { min: 0, max: 15, text: '0 - 15' },
      female: { min: 0, max: 20, text: '0 - 20' },
      general: { min: 0, max: 15, text: '0 - 15' },
    },
    synonyms: ['esr', 'erythrocyte sedimentation rate', 'sed rate', 'sedimentation rate'],
  },
  {
    id: 'bleeding_time',
    name: 'Bleeding Time',
    category: 'HEMOTOLOGY',
    unit: 'min',
    ranges: { general: { text: '01-03' } },
  },
  {
    id: 'coagulation_time',
    name: 'Coagulation Time',
    category: 'HEMOTOLOGY',
    unit: 'min',
    ranges: { general: { text: '02-08' } },
  },
  {
    id: 'reticulocytes',
    name: 'Reticulocytes',
    category: 'HEMOTOLOGY',
    unit: '%',
    ranges: { general: { text: '0.5-2.0' } },
  },
  {
    id: 'prothrombin_time',
    name: 'Prothrombin Time',
    category: 'HEMOTOLOGY',
    unit: 'sec',
    ranges: { general: { text: 'PT 11-13.5 sec; INR 0.8-1.1' } },
  },
  {
    id: 'anti_hcv',
    name: 'Anti HCV',
    category: 'HEMOTOLOGY',
    options: ['Negative', 'Positive'],
    synonyms: ['hepatitis c', 'hcv'],
  },
  { id: 'aldehyde', name: 'Aldehyde', category: 'HEMOTOLOGY', options: ['Negative', 'Positive'] },
  {
    id: 'hbs_ag',
    name: 'Hbs Ag',
    category: 'HEMOTOLOGY',
    options: ['Negative', 'Positive'],
    synonyms: ['hbsag', 'hepatitis b', 'australian antigen'],
  },
  {
    id: 'ra_test',
    name: 'R.A. Test',
    category: 'HEMOTOLOGY',
    unit: 'IU/mL',
    ranges: { general: { text: '<14' } },
    synonyms: ['ra factor', 'rheumatoid arthritis', 'rheumatoid factor'],
  },
  {
    id: 'vdrl',
    name: 'V.D.R.L',
    category: 'HEMOTOLOGY',
    options: ['Non-reactive', 'Reactive'],
    synonyms: ['syphilis', 'vdrl'],
  },
  {
    id: 'rpr',
    name: 'R.P.R.',
    category: 'HEMOTOLOGY',
    options: ['Non-reactive', 'Reactive'],
    synonyms: ['rpr'],
  },
  {
    id: 'abo_group',
    name: 'A.B.O',
    category: 'HEMOTOLOGY',
    isGroup: true,
    synonyms: ['abo', 'blood group'],
    includedTests: ['ABO Typing', 'RH Typing'],
  },
  {
    id: 'abo_typing',
    name: 'ABO Typing',
    category: 'HEMOTOLOGY',
    options: ['A', 'B', 'AB', 'O'],
    synonyms: ['abo typing'],
  },
  {
    id: 'rh_typing',
    name: 'RH Typing',
    category: 'HEMOTOLOGY',
    options: ['Positive', 'Negative'],
    synonyms: ['rh factor'],
  },
  {
    id: 'mantoux',
    name: 'Mantoux Test',
    category: 'HEMOTOLOGY',
    unit: 'mm induration',
    options: ['Negative', 'Positive'],
    synonyms: ['tb skin test'],
  },
  {
    id: 'aso_titre',
    name: 'Aso Titre',
    category: 'HEMOTOLOGY',
    unit: 'IU/mL',
    ranges: { general: { text: '<200' } },
    synonyms: ['aso'],
  },
  {
    id: 'hiv',
    name: 'H.I.V.',
    category: 'HEMOTOLOGY',
    options: ['Non-reactive', 'Reactive'],
    synonyms: ['hiv', 'aids'],
  },
  {
    id: 'dengue',
    name: 'Dengue',
    category: 'HEMOTOLOGY',
    options: ['Negative', 'Positive NS1', 'Positive IgM', 'Positive IgG'],
    synonyms: ['dengu', 'dengue test', 'ns1 antigen', 'break bone fever'],
  },
  {
    id: 'chikungunya',
    name: 'Chikungunya',
    category: 'HEMOTOLOGY',
    options: ['Negative', 'Positive'],
  },
  {
    id: 'afb_sputum',
    name: 'A.F.B. for sputam',
    category: 'HEMOTOLOGY',
    options: ['Negative', 'Scanty', '+1', '+2', '+3'],
    synonyms: ['afb', 'tb', 'tuberculosis'],
  },
  {
    id: 'pregnancy',
    name: 'PREGNANCY TEST',
    category: 'CLINICAL PATHOLOGY',
    options: ['Negative', 'Positive'],
    synonyms: ['upt', 'pregnancy test', 'urine pregnancy test', 'pt test'],
  },

  // ===========================================================================
  // Catalogue additions — 2026-10 audit against a standard Indian diagnostic
  // lab's menu. Appended below the original list on purpose: no existing id,
  // name, unit or interval was reordered or rewritten, so reports that were
  // already signed still resolve the rows they were printed with.
  //
  // Every interval here carries UNVERIFIED_INTERVAL, which means the report
  // shows it with a caveat until the lab confirms it against its own method.
  // Nothing below was copied from a named Indian authority, and no range should
  // be presented as one until that review happens.
  // ===========================================================================

  // THYROID & HORMONES
  {
    id: 'tsh',
    name: 'T.S.H.',
    category: 'HORMONES',
    unit: 'µIU/mL',
    specimen: 'Serum',
    method: 'CLIA',
    ranges: generalText('0.27 - 4.20'),
    lastReviewed: '2026-10-11',
    synonyms: ['tsh', 'thyroid stimulating hormone', 'thyrotropin', 'thyroid test'],
  },
  {
    id: 'total_t3',
    name: 'Total T3',
    category: 'HORMONES',
    unit: 'ng/mL',
    specimen: 'Serum',
    ranges: generalText('0.80 - 2.00'),
    synonyms: ['t3', 'triiodothyronine', 'total triiodothyronine'],
  },
  {
    id: 'total_t4',
    name: 'Total T4',
    category: 'HORMONES',
    unit: 'µg/dL',
    specimen: 'Serum',
    ranges: generalText('5.1 - 12.0'),
    synonyms: ['t4', 'thyroxine', 'total thyroxine'],
  },
  {
    id: 'free_t3',
    name: 'Free T3 (FT3)',
    category: 'HORMONES',
    unit: 'pg/mL',
    specimen: 'Serum',
    ranges: generalText('2.0 - 4.4'),
    synonyms: ['ft3', 'free triiodothyronine'],
  },
  {
    id: 'free_t4',
    name: 'Free T4 (FT4)',
    category: 'HORMONES',
    unit: 'ng/dL',
    specimen: 'Serum',
    ranges: generalText('0.93 - 1.70'),
    synonyms: ['ft4', 'free thyroxine'],
  },
  {
    id: 'anti_tpo',
    name: 'Anti-TPO Antibodies',
    category: 'HORMONES',
    unit: 'IU/mL',
    specimen: 'Serum',
    ranges: generalText('< 5.61'),
    synonyms: ['antitpo', 'tpo', 'thyroid antibodies', 'hashimoto'],
  },
  {
    id: 'testosterone',
    name: 'Serum Testosterone',
    category: 'HORMONES',
    unit: 'ng/dL',
    specimen: 'Serum',
    preparation: 'Morning sample (8–10 am)',
    ranges: {
      male: { text: '270 - 1070', ...UNVERIFIED_INTERVAL },
      female: { text: '15 - 70', ...UNVERIFIED_INTERVAL },
    },
    synonyms: ['testosterone', 'total testosterone'],
  },
  {
    id: 'prolactin',
    name: 'Serum Prolactin',
    category: 'HORMONES',
    unit: 'ng/mL',
    specimen: 'Serum',
    preparation: 'Avoid breast stimulation and stress before sampling',
    ranges: {
      male: { text: '4.0 - 15.2', ...UNVERIFIED_INTERVAL },
      female: { text: '4.8 - 23.3', ...UNVERIFIED_INTERVAL },
    },
    synonyms: ['prolactin', 'serum prolactin'],
  },
  {
    id: 'fsh',
    name: 'F.S.H.',
    category: 'HORMONES',
    unit: 'mIU/mL',
    specimen: 'Serum',
    ranges: {
      male: { text: '1.5 - 12.4', ...UNVERIFIED_INTERVAL },
      female: { text: '3.5 - 12.5 (follicular)', ...UNVERIFIED_INTERVAL },
    },
    synonyms: ['fsh', 'follicle stimulating hormone', 'follicle-stimulating'],
  },
  {
    id: 'lh',
    name: 'L.H.',
    category: 'HORMONES',
    unit: 'mIU/mL',
    specimen: 'Serum',
    ranges: {
      male: { text: '1.7 - 8.6', ...UNVERIFIED_INTERVAL },
      female: { text: '2.4 - 12.6 (follicular)', ...UNVERIFIED_INTERVAL },
    },
    synonyms: ['lh', 'luteinizing hormone', 'luteinising'],
  },

  // VITAMINS, IRON & NUTRITION
  {
    id: 'vitamin_d',
    name: 'Vitamin D (25-OH)',
    category: 'VITAMINS',
    unit: 'ng/mL',
    specimen: 'Serum',
    ranges: generalText('30.0 - 100.0'),
    notes: ['Deficiency and insufficiency cut-offs are thresholds, not a reference interval.'],
    synonyms: ['vitamin d', '25-hydroxy vitamin d', 'vit d', 'vitamin d total', 'vitamin d3'],
  },
  {
    id: 'vitamin_b12',
    name: 'Vitamin B12',
    category: 'VITAMINS',
    unit: 'pg/mL',
    specimen: 'Serum',
    ranges: generalText('200 - 900'),
    synonyms: ['b12', 'cobalamin', 'vitamin b-12', 'cyanocobalamin'],
  },
  {
    id: 'folic_acid',
    name: 'Folic Acid',
    category: 'VITAMINS',
    unit: 'ng/mL',
    specimen: 'Serum',
    ranges: generalText('3.1 - 20.5'),
    synonyms: ['folate', 'folic acid test'],
  },
  {
    id: 'serum_iron',
    name: 'Serum Iron',
    category: 'VITAMINS',
    unit: 'µg/dL',
    specimen: 'Serum',
    preparation: 'Morning fasting sample preferred',
    ranges: {
      male: { text: '65 - 175', ...UNVERIFIED_INTERVAL },
      female: { text: '43 - 157', ...UNVERIFIED_INTERVAL },
    },
    synonyms: ['iron', 'serum iron test'],
  },
  {
    id: 'tibc',
    name: 'T.I.B.C.',
    category: 'VITAMINS',
    unit: 'µg/dL',
    specimen: 'Serum',
    ranges: generalText('250 - 370'),
    synonyms: ['tibc', 'total iron binding capacity', 'iron binding capacity'],
  },
  {
    id: 'ferritin',
    name: 'Serum Ferritin',
    category: 'VITAMINS',
    unit: 'ng/mL',
    specimen: 'Serum',
    ranges: {
      male: { text: '20 - 250', ...UNVERIFIED_INTERVAL },
      female: { text: '10 - 120', ...UNVERIFIED_INTERVAL },
    },
    synonyms: ['ferritin', 'iron stores'],
  },

  // ELECTROLYTES & MINERALS
  {
    id: 'sodium',
    name: 'Sodium',
    category: 'ELECTROLYTES',
    unit: 'mmol/L',
    specimen: 'Plasma / Serum',
    container: 'Lithium heparin or plain vial',
    ranges: generalText('135 - 145'),
    synonyms: ['na', 'serum sodium', 'salt test'],
  },
  {
    id: 'potassium',
    name: 'Potassium',
    category: 'ELECTROLYTES',
    unit: 'mmol/L',
    specimen: 'Plasma / Serum',
    container: 'Lithium heparin — do not use a tourniquet-heavy draw',
    ranges: generalText('3.5 - 5.0'),
    synonyms: ['k', 'serum potassium'],
  },
  {
    id: 'chloride',
    name: 'Chloride',
    category: 'ELECTROLYTES',
    unit: 'mmol/L',
    specimen: 'Plasma / Serum',
    ranges: generalText('97 - 107'),
    synonyms: ['cl', 'serum chloride'],
  },
  {
    id: 'calcium',
    name: 'Calcium (Total)',
    category: 'ELECTROLYTES',
    unit: 'mg/dL',
    specimen: 'Serum',
    ranges: generalText('8.6 - 10.3'),
    synonyms: ['calcium', 'serum calcium', 'ca'],
  },
  {
    id: 'phosphorus',
    name: 'Phosphorus (Inorganic)',
    category: 'ELECTROLYTES',
    unit: 'mg/dL',
    specimen: 'Serum',
    ranges: generalText('2.5 - 4.5'),
    synonyms: ['phosphorus', 'serum phosphate', 'inorganic phosphorus'],
  },
  {
    id: 'magnesium',
    name: 'Magnesium',
    category: 'ELECTROLYTES',
    unit: 'mg/dL',
    specimen: 'Serum',
    ranges: generalText('1.7 - 2.2'),
    synonyms: ['magnesium', 'mg serum'],
  },

  // BIO CHEMISTRY — kidney, liver, pancreas, muscle, cardiac
  {
    id: 'egfr',
    name: 'eGFR (CKD-EPI)',
    category: 'BIO CHEMISTRY',
    unit: 'mL/min/1.73m²',
    specimen: 'Serum',
    ranges: generalText('> 60'),
    notes: ['Derived from serum creatinine with the patient age and sex.'],
    synonyms: ['egfr', 'glomerular filtration rate', 'kidney filter rate'],
  },
  {
    id: 'microalbumin',
    name: 'Microalbuminuria',
    category: 'BIO CHEMISTRY',
    unit: 'mg/L',
    specimen: 'Urine',
    ranges: generalText('< 30'),
    synonyms: ['microalbumin', 'urine albumin', 'micro albuminuria'],
  },
  {
    id: 'ggt',
    name: 'Gamma GT (G.G.T.)',
    category: 'BIO CHEMISTRY',
    unit: 'U/L',
    specimen: 'Serum',
    ranges: {
      male: { text: '10 - 71', ...UNVERIFIED_INTERVAL },
      female: { text: '5 - 40', ...UNVERIFIED_INTERVAL },
    },
    synonyms: ['ggt', 'gamma gt', 'gamma glutamyl transferase'],
  },
  {
    id: 'ldh',
    name: 'L.D.H.',
    category: 'BIO CHEMISTRY',
    unit: 'U/L',
    specimen: 'Serum',
    ranges: generalText('120 - 246'),
    synonyms: ['ldh', 'lactate dehydrogenase'],
  },
  {
    id: 'amylase',
    name: 'Serum Amylase',
    category: 'BIO CHEMISTRY',
    unit: 'U/L',
    specimen: 'Serum',
    ranges: generalText('25 - 125'),
    synonyms: ['amylase', 'pancreas amylase'],
  },
  {
    id: 'lipase',
    name: 'Serum Lipase',
    category: 'BIO CHEMISTRY',
    unit: 'U/L',
    specimen: 'Serum',
    ranges: generalText('0 - 160'),
    synonyms: ['lipase'],
  },
  {
    id: 'cpk',
    name: 'C.P.K. (Creatine Phosphokinase)',
    category: 'BIO CHEMISTRY',
    unit: 'U/L',
    specimen: 'Serum',
    ranges: {
      male: { text: '38 - 174', ...UNVERIFIED_INTERVAL },
      female: { text: '26 - 140', ...UNVERIFIED_INTERVAL },
    },
    synonyms: ['cpk', 'ck', 'creatine kinase', 'muscle enzyme'],
  },
  {
    id: 'ckmb',
    name: 'C.K.-M.B.',
    category: 'CARDIAC MARKERS',
    unit: 'U/L',
    specimen: 'Serum',
    ranges: generalText('0 - 24'),
    synonyms: ['ckmb', 'ck mb', 'cardiac ck'],
  },
  {
    id: 'troponin_i',
    name: 'Troponin I (Serum)',
    category: 'CARDIAC MARKERS',
    unit: 'ng/mL',
    specimen: 'Serum',
    ranges: generalText('< 0.04'),
    synonyms: ['troponin', 'trop i', 'cardiac troponin', 'heart attack test'],
  },
  {
    id: 'd_dimer',
    name: 'D-Dimer',
    category: 'CARDIAC MARKERS',
    unit: 'µg/L FEU',
    specimen: 'Plasma',
    container: 'Sodium citrate vial',
    ranges: generalText('< 500'),
    synonyms: ['dimer', 'ddimer', 'clot marker'],
  },
  {
    id: 'vldl',
    name: 'V.L.D.L. Cholesterol',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dL',
    specimen: 'Serum',
    preparation: '10–12 hours fasting',
    ranges: generalText('0 - 40'),
    notes: ['Usually calculated as Triglyceride / 5; confirm the lab formula.'],
    synonyms: ['vldl', 'very low density lipoprotein'],
  },
  {
    id: 'crp',
    name: 'C-Reactive Protein',
    category: 'SEROLOGY',
    unit: 'mg/L',
    specimen: 'Serum',
    ranges: generalText('< 5.0'),
    synonyms: ['crp', 'c reactive protein', 'inflammatory marker'],
  },
  {
    id: 'hs_crp',
    name: 'High Sensitivity C.R.P.',
    category: 'SEROLOGY',
    unit: 'mg/L',
    specimen: 'Serum',
    ranges: generalText('< 1.0'),
    synonyms: ['hs crp', 'hscrp', 'high sensitivity crp'],
  },
  {
    id: 'ogtt_2hr',
    name: 'O.G.T.T. (2 Hour)',
    category: 'BIO CHEMISTRY',
    unit: 'mg/dL',
    specimen: 'Plasma',
    container: 'Sodium fluoride oxalate vial',
    preparation: '75 g anhydrous glucose load; sample exactly 2 hours after',
    ranges: generalText('up to 140'),
    synonyms: [
      'ogtt',
      'glucose tolerance test',
      'sugar tolerance test',
      'gestational diabetes test',
    ],
  },
  {
    id: 'fasting_insulin',
    name: 'Serum Insulin (Fasting)',
    category: 'HORMONES',
    unit: 'µIU/mL',
    specimen: 'Serum',
    preparation: 'Fasting sample',
    ranges: generalText('2.6 - 24.9'),
    synonyms: ['insulin', 'fasting insulin', 'serum insulin'],
  },

  // HAEMATOLOGY & PARASITOLOGY additions
  {
    id: 'peripheral_smear',
    name: 'Peripheral Smear Examination',
    category: 'HAEMATOLOGY',
    unit: '',
    kind: 'text',
    specimen: 'Blood',
    container: 'EDTA vial — slide within 2 hours',
    ranges: { general: { text: 'Normal haemogram', ...UNVERIFIED_INTERVAL } },
    synonyms: ['psm', 'peripheral smear', 'blood smear', 'smear for malaria', 'haemogram'],
  },
  {
    id: 'malaria_ag',
    name: 'Malaria Antigen (PF/PAN)',
    category: 'SEROLOGY',
    unit: '',
    kind: 'text',
    specimen: 'Blood',
    options: ['Negative', 'Positive (PF)', 'Positive (PAN)'],
    ranges: { general: { text: 'Negative', ...UNVERIFIED_INTERVAL } },
    synonyms: ['pf antigen', 'pan antigen', 'malaria rapid test', 'malaria antigen'],
  },
  {
    id: 'g6pd',
    name: 'G6PD Assay',
    category: 'HAEMATOLOGY',
    unit: 'U/g Hb',
    specimen: 'Blood',
    container: 'EDTA vial',
    ranges: generalText('7.6 - 13.3'),
    synonyms: ['g6pd', 'glucose 6 phosphate dehydrogenase', 'favism test'],
  },

  // STOOL EXAMINATION — the whole category was absent from the catalogue.
  // Members carry a `Stool` prefix on purpose: the urine panel already owns the
  // bare names 'Pus Cells' and 'Epithelial Cells', and `findTestInfo` resolves
  // by name, so unprefixed duplicates would have read each other's ranges.
  {
    id: 'stool_group',
    name: 'STOOL EXAMINATION',
    category: 'CLINICAL PATHOLOGY',
    isGroup: true,
    hideMembersFromBrowse: false,
    specimen: 'Stool',
    includedTests: [
      'Stool Appearance',
      'Stool Pus Cells',
      'Stool RBC',
      'Stool Epithelial Cells',
      'Stool Ova / Cyst',
      'Stool Fat Globules',
      'Stool Reducing Substances',
      'Stool Occult Blood',
    ],
    synonyms: ['stool', 'stool routine', 'stool microscopy', 'motion test', 'occult blood'],
  },
  {
    id: 'stool_appearance',
    name: 'Stool Appearance',
    category: 'CLINICAL PATHOLOGY',
    kind: 'text',
    options: ['Formed', 'Semi-formed', 'Liquid', 'Mucus present'],
    ranges: { general: { text: 'Formed', ...UNVERIFIED_INTERVAL } },
    synonyms: ['stool consistency'],
  },
  {
    id: 'stool_pus',
    name: 'Stool Pus Cells',
    category: 'CLINICAL PATHOLOGY',
    unit: '/HPF',
    ranges: generalText('0 - 2'),
  },
  {
    id: 'stool_rbc',
    name: 'Stool RBC',
    category: 'CLINICAL PATHOLOGY',
    unit: '/HPF',
    ranges: generalText('0 - 2'),
  },
  {
    id: 'stool_epi',
    name: 'Stool Epithelial Cells',
    category: 'CLINICAL PATHOLOGY',
    unit: '/HPF',
    ranges: { general: { text: 'Few', ...UNVERIFIED_INTERVAL } },
  },
  {
    id: 'stool_ova',
    name: 'Stool Ova / Cyst',
    category: 'CLINICAL PATHOLOGY',
    kind: 'text',
    options: ['Absent', 'Present'],
    ranges: { general: { text: 'Absent', ...UNVERIFIED_INTERVAL } },
    synonyms: ['ova and cyst', 'parasite cyst', 'stool parasite'],
  },
  {
    id: 'stool_fat',
    name: 'Stool Fat Globules',
    category: 'CLINICAL PATHOLOGY',
    kind: 'text',
    options: ['Absent', 'Present'],
    synonyms: ['fat globules', 'steatorrhoea'],
  },
  {
    id: 'stool_reducing',
    name: 'Stool Reducing Substances',
    category: 'CLINICAL PATHOLOGY',
    kind: 'text',
    options: ['Negative', 'Positive'],
    synonyms: ['reducing substance', 'stool sugar'],
  },
  {
    id: 'stool_occult',
    name: 'Stool Occult Blood',
    category: 'CLINICAL PATHOLOGY',
    kind: 'text',
    options: ['Negative', 'Positive'],
    preparation: 'Avoid red meat and vitamin C for 3 days before the sample',
    ranges: { general: { text: 'Negative', ...UNVERIFIED_INTERVAL } },
    synonyms: ['occult blood', 'ob test', 'benzedine test'],
  },

  // CULTURES — reported descriptively, so `kind: 'text'` stops any numeric
  // flagging being attempted on a sensitivity table.
  {
    id: 'blood_culture',
    name: 'Blood Culture & Sensitivity',
    category: 'SEROLOGY',
    kind: 'text',
    specimen: 'Blood',
    preparation: 'Before antibiotics, ideally two sets',
    ranges: { general: { text: 'No growth', ...UNVERIFIED_INTERVAL } },
    synonyms: ['blood culture', 'culture sensitivity', 'c/s test'],
  },
  {
    id: 'urine_culture',
    name: 'Urine Culture & Sensitivity',
    category: 'SEROLOGY',
    kind: 'text',
    specimen: 'Urine',
    preparation: 'Mid-stream early morning sample',
    ranges: { general: { text: 'No growth', ...UNVERIFIED_INTERVAL } },
    synonyms: ['urine culture', 'cs urine', 'uti test'],
  },
  {
    id: 'sputum_culture',
    name: 'Sputum Culture & Sensitivity',
    category: 'SEROLOGY',
    kind: 'text',
    specimen: 'Sputum',
    ranges: { general: { text: 'No growth', ...UNVERIFIED_INTERVAL } },
    synonyms: ['sputum culture', 'throat swab culture'],
  },

  // ===========================================================================
  // Profiles. Every one of these reuses the individual test records above (or
  // the pre-existing ones) by exact name — no component is redefined, so a
  // profile and the same test ordered alone resolve to one record, one unit and
  // one reference interval. `hideMembersFromBrowse: false` keeps each component
  // individually orderable, exactly as it was before the profile existed.
  // Compositions follow common Indian lab practice, not a published standard:
  // the lab director should confirm each panel before it is priced or used.
  // ===========================================================================
  {
    id: 'thyroid_profile',
    name: 'THYROID PROFILE',
    category: 'HORMONES',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: ['T.S.H.', 'Total T3', 'Total T4'],
    synonyms: ['thyroid profile', 'thyroid panel', 'thy', 'thyroid'],
  },
  {
    id: 'thyroid_extended',
    name: 'THYROID PROFILE (EXTENDED)',
    category: 'HORMONES',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: ['T.S.H.', 'Free T3 (FT3)', 'Free T4 (FT4)', 'Anti-TPO Antibodies'],
    synonyms: ['extended thyroid profile', 'thyroid antibodies profile', 'thyroid complete'],
  },
  {
    id: 'kft_profile',
    name: 'KIDNEY FUNCTION TEST (KFT)',
    category: 'BIO CHEMISTRY',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: [
      'Blood Urea',
      'S. creatinine',
      'Uric Acid',
      'Sodium',
      'Potassium',
      'Chloride',
      'Calcium (Total)',
      'Phosphorus (Inorganic)',
      'eGFR (CKD-EPI)',
    ],
    synonyms: ['kft', 'rft', 'renal function test', 'kidney profile', 'kidney test'],
  },
  {
    id: 'lft_profile',
    name: 'LIVER FUNCTION TEST (LFT)',
    category: 'BIO CHEMISTRY',
    isGroup: true,
    hideMembersFromBrowse: false,
    // 'Albumin' is deliberately absent: the URINE ANALYSIS panel already owns
    // that exact name, and the catalogue resolves tests by name, so listing it
    // here would pull the urine row (with its '+' options) into the LFT printout
    // and hide the serum one. Needs a rename decision by the lab — see the
    // audit report.
    includedTests: [
      'Total Serum Bilirubin',
      'Direct Bilirubin',
      'Indirect Bilirubin',
      'S.G.O.T.',
      'S.G.P.T.',
      'Alkaline Phosphaphates',
      'Total Protein',
      'Gamma GT (G.G.T.)',
    ],
    synonyms: ['lft', 'liver profile', 'liver function panel', 'liver test', 'liver'],
  },
  {
    id: 'sugar_profile',
    name: 'BLOOD SUGAR PROFILE',
    category: 'BIO CHEMISTRY',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: ['Blood Sugar Fasting', 'Blood Sugar (PP)', 'HbA1c'],
    synonyms: ['sugar profile', 'blood sugar profile', 'bs profile', 'diabetes profile'],
  },
  {
    id: 'electrolyte_profile',
    name: 'ELECTROLYTE PROFILE',
    category: 'ELECTROLYTES',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: ['Sodium', 'Potassium', 'Chloride', 'Calcium (Total)', 'Magnesium'],
    synonyms: ['electrolyte profile', 'electrolytes', 'salt and water test'],
  },
  {
    id: 'iron_studies',
    name: 'IRON STUDIES',
    category: 'VITAMINS',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: ['Serum Iron', 'T.I.B.C.', 'Serum Ferritin'],
    synonyms: ['iron studies', 'iron profile', 'iron deficiency test'],
  },
  {
    id: 'anaemia_profile',
    name: 'ANAEMIA PROFILE',
    category: 'HAEMATOLOGY',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: [
      'HB (HAEMOGLOBIN)',
      'HCT(PCV)',
      'MCV',
      'MCH',
      'MCHC',
      'RDW%',
      'Reticulocytes',
      'Serum Iron',
      'T.I.B.C.',
      'Serum Ferritin',
    ],
    synonyms: ['anaemia profile', 'anemia profile', 'kan ki kami test', 'haemoglobin profile'],
  },
  {
    id: 'vitamin_profile',
    name: 'VITAMIN PROFILE',
    category: 'VITAMINS',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: ['Vitamin D (25-OH)', 'Vitamin B12', 'Folic Acid'],
    synonyms: ['vitamin profile', 'vitamins test', 'b12 d profile'],
  },
  {
    id: 'fever_profile',
    name: 'FEVER PROFILE',
    category: 'SEROLOGY',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: [
      'WHITE CELL COUNT(TC)',
      'PLATELET COUNT',
      'E.S.R. 1st Hor',
      'C-Reactive Protein',
      'Dengue',
      'Malaria Antigen (PF/PAN)',
      'Parasites MP / MF',
    ],
    synonyms: ['fever profile', 'fever test', 'pyrexia profile', 'bukhar test'],
  },
  {
    id: 'antenatal_profile',
    name: 'ANTENATAL PROFILE',
    category: 'HAEMATOLOGY',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: [
      'HB (HAEMOGLOBIN)',
      'ABO Typing',
      'RH Typing',
      'Blood Sugar Fasting',
      'Total Serum Bilirubin',
      'S. creatinine',
      'Hbs Ag',
      'Anti HCV',
      'H.I.V.',
      'V.D.R.L',
      'T.S.H.',
    ],
    synonyms: ['antenatal profile', 'a/n profile', 'pregnancy profile', 'maternal profile'],
  },
  {
    id: 'cardiac_profile',
    name: 'CARDIAC MARKERS',
    category: 'CARDIAC MARKERS',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: [
      'Troponin I (Serum)',
      'C.K.-M.B.',
      'C.P.K. (Creatine Phosphokinase)',
      'L.D.H.',
      'D-Dimer',
    ],
    synonyms: ['cardiac profile', 'cardiac markers', 'heart test', 'troponin profile'],
  },
  {
    id: 'ra_profile',
    name: 'RHEUMATOID ARTHRITIS PROFILE',
    category: 'SEROLOGY',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: ['R.A. Test', 'Aso Titre', 'C-Reactive Protein', 'E.S.R. 1st Hor'],
    synonyms: ['ra profile', 'arthritis profile', 'rheumatoid profile'],
  },
  {
    id: 'pancreas_profile',
    name: 'PANCREAS PROFILE',
    category: 'BIO CHEMISTRY',
    isGroup: true,
    hideMembersFromBrowse: false,
    includedTests: ['Serum Amylase', 'Serum Lipase'],
    synonyms: ['pancreas profile', 'amylase lipase test', 'pancreatitis test'],
  },
];

export const getCustomTests = (): PathologyTest[] => {
  return readCustomTests();
};

export const getPathologyTests = (): PathologyTest[] => {
  return [...DEFAULT_PATHOLOGY_TESTS, ...getCustomTests()];
};

/**
 * The tests a picker may offer as standalone picks, minus the ones already
 * selected. Members of a group panel are added through their parent, so they
 * are excluded here. The exclusion set is built in one pass — the previous
 * inline `catalog.some(g => g.includedTests?.includes(name))` inside a
 * `.filter()` rescanned the whole catalog per row (O(n²)) and called
 * `getPathologyTests()` (which re-reads custom tests from settings) repeatedly.
 */
export const getStandaloneTests = (selected: readonly string[] = []): PathologyTest[] => {
  const all = getPathologyTests();
  const grouped = hiddenGroupMembers(all);
  const selectedSet = new Set(selected);
  return all.filter(t => !t.isHeader && !selectedSet.has(t.name) && !grouped.has(t.name));
};

/**
 * Names owned by a panel that hides its members from the browse list. Opt-out
 * per panel via `hideMembersFromBrowse: false` — see that field.
 */
const hiddenGroupMembers = (all: PathologyTest[]): Set<string> => {
  const grouped = new Set<string>();
  for (const t of all) {
    if (t.hideMembersFromBrowse === false) continue;
    if (t.includedTests) for (const m of t.includedTests) grouped.add(m);
  }
  return grouped;
};

/**
 * The candidate list a test picker searches. With no query it is the browse
 * list (group members hidden — they are added through their parent panel). Once
 * the user types, group members become searchable so a disease term like
 * "typhoid" can surface both the WIDAL group and its "S. typhi 'O' / 'H'"
 * components, not just tests whose literal name contains the query.
 */
export const getSearchableTests = (
  selected: readonly string[] = [],
  query = '',
): PathologyTest[] => {
  const all = getPathologyTests();
  const selectedSet = new Set(selected);
  const candidates = all.filter(t => !t.isHeader && !selectedSet.has(t.name));
  if (query.trim()) return candidates;
  const grouped = hiddenGroupMembers(all);
  return candidates.filter(t => !grouped.has(t.name));
};

/** Which population the band a patient was matched to actually belongs to. */
export type RangeBandKind = 'infant' | 'adult-male' | 'adult-female' | 'general' | 'none';

export interface ResolvedRange {
  kind: RangeBandKind;
  /** What the report prints in the reference-range column. */
  label: string;
  /** Bounds for high/low flagging, or null when the interval is not numeric. */
  values: { min?: number; max?: number } | null;
  /**
   * The interval shown is not established for this patient: a 2–11 year old on
   * the adult band, an infant with no infant band, or a band the catalogue
   * itself marks `requires-lab-verification`. Every caller that renders a range
   * must surface this — a silently-inherited adult range on a child's report is
   * the one failure mode this model cannot be allowed to hide.
   */
  unverifiedForPatient: boolean;
  /** Why `unverifiedForPatient` is set, for the badge / PDF footnote. */
  reason?: string;
}

/** `text` wins; otherwise the numeric bounds are formatted the way they always were. */
const formatBand = (band: RangeBand): string =>
  band.text || `${band.min?.toFixed(1) || 0} - ${band.max?.toFixed(1) || 0}`;

/** Numeric bounds of a band, read from `min`/`max` or parsed out of its text. */
const bandBounds = (band: RangeBand): { min?: number; max?: number } | null => {
  if (band.min !== undefined || band.max !== undefined) return { min: band.min, max: band.max };
  if (!band.text) return null;

  const match = band.text.match(/([0-9.]+)\s*-\s*([0-9.]+)/);
  if (match) return { min: parseFloat(match[1]), max: parseFloat(match[2]) };

  const gteMatch = band.text.match(/>=\s*([0-9.]+)/);
  if (gteMatch) return { min: parseFloat(gteMatch[1]) };

  const ltMatch = band.text.match(/<\s*([0-9.]+)/);
  if (ltMatch) return { max: parseFloat(ltMatch[1]) };

  const upToMatch = band.text.match(/up to\s*([0-9.]+)/i);
  if (upToMatch) return { max: parseFloat(upToMatch[1]) };

  return null;
};

/**
 * Pick the reference band for one patient. Single source of truth for the
 * editor, the A4 report, the PDF table and the timeline flags, so a range can
 * never read one way on screen and another way on the signed printout.
 */
export const resolveReferenceRange = (
  ranges: ReferenceRange | undefined,
  age?: number,
  gender?: string,
): ResolvedRange => {
  if (!ranges) return { kind: 'none', label: '', values: null, unverifiedForPatient: false };

  const isInfant = age !== undefined && age < INFANT_MAX_AGE_YEARS;
  const isChild = age !== undefined && age >= INFANT_MAX_AGE_YEARS && age < ADULT_MIN_AGE_YEARS;

  const g = (gender || '').toLowerCase();
  const chain: { band: RangeBand; kind: RangeBandKind }[] = [];
  // Order matters: the first entry is the band the report shows. An infant only
  // claims the first slot when the lab actually has an infant interval for this
  // test; otherwise the adult band is shown and marked, rather than nothing.
  if (isInfant && ranges.infant) chain.push({ band: ranges.infant, kind: 'infant' });
  if (g.startsWith('m') && ranges.male) chain.push({ band: ranges.male, kind: 'adult-male' });
  if (g.startsWith('f') && ranges.female) chain.push({ band: ranges.female, kind: 'adult-female' });
  if (ranges.general) chain.push({ band: ranges.general, kind: 'general' });

  const chosen = chain[0];
  if (!chosen) return { kind: 'none', label: '', values: null, unverifiedForPatient: false };

  // A text-only band ("Age dependent", "Few") carries no bounds; walk the rest
  // of the chain for numbers instead of losing the flagging the old cascade gave.
  const values = chain.map(c => bandBounds(c.band)).find(v => v !== null) ?? null;

  const outsidePopulation = (isInfant || isChild) && chosen.kind !== 'infant';
  const awaitingLab = chosen.band.verification === 'requires-lab-verification';
  return {
    kind: chosen.kind,
    label: formatBand(chosen.band),
    values,
    unverifiedForPatient: outsidePopulation || awaitingLab,
    reason: outsidePopulation
      ? isInfant
        ? 'No infant (0–24 months) interval — adult range applied'
        : 'No paediatric interval for this age — adult range applied'
      : awaitingLab
        ? 'Interval awaiting laboratory verification'
        : undefined,
  };
};

export const getReferenceRangeLabel = (
  ranges: ReferenceRange | undefined,
  age?: number,
  gender?: string,
): string => resolveReferenceRange(ranges, age, gender).label;

export const findTestInfo = (query: string): PathologyTest | undefined => {
  if (!query) return undefined;
  const q = query.toLowerCase().trim();
  return getPathologyTests().find(
    t => t.name.toLowerCase() === q || t.synonyms?.some(s => s.toLowerCase() === q),
  );
};

/**
 * What was ordered, expanded into the individual tests it represents.
 *
 * `testSelection` mixes panel names (CBC) with their members (HEMOGLOBIN): the
 * panel is what the lab books, the members are what gets reported. Counting that
 * list as "tests" therefore means two different things depending on which entry
 * a report happened to carry — a CBC counting as 1 in one report and as ~20 in
 * another, which is exactly how the analytics "Total Tests" figure stopped being
 * comparable month to month.
 *
 * Everything that needs a test count goes through here so there is one answer:
 * a panel contributes its members, a member contributes itself, a member already
 * listed separately is not counted twice, and section headers contribute nothing.
 */
export function expandTestSelection(names: readonly string[] = []): string[] {
  const leaves = new Set<string>();
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const info = findTestInfo(name);
    if (info?.isHeader) continue;
    const members = info?.isGroup ? (info.includedTests ?? []) : [];
    if (members.length > 0) {
      for (const member of members) {
        const trimmed = String(member ?? '').trim();
        if (trimmed) leaves.add(trimmed);
      }
      continue;
    }
    // A known group with no members listed is a catalogue gap, not a test.
    if (!info?.isGroup) leaves.add(name);
  }
  return [...leaves];
}

/**
 * Fold the ways the same test gets typed into one comparable form, so a lab
 * assistant doesn't need to know the catalogue's spelling:
 *
 *  • punctuation and spaces — `H.D.L.`, `h d l` and `hdl` are one word
 *  • British / American    — `haemoglobin` and `hemoglobin` (ae→e, oe→e)
 *  • plurals               — `platelets` finds `PLATELET COUNT`
 *  • accents               — typed Hindi transliterations (`hämoglobin`)
 *
 * Used as an extra tier over the raw comparisons below, never instead of them:
 * an exact raw match still outranks a normalised one, so adding aliases can't
 * demote a test someone typed perfectly.
 */
export function normalizeSearchTerm(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/oe/g, 'e')
    .replace(/ae/g, 'e')
    .replace(/s$/, '');
}

export function getLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // Rolling two-row DP: identical result to the full matrix but O(min(m,n))
  // space and far less allocation churn — this runs per candidate word/synonym
  // on every keystroke in the test search.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let prev = Array.from({ length: short.length + 1 }, (_, i) => i);
  let curr = new Array<number>(short.length + 1);
  for (let j = 1; j <= long.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= short.length; i++) {
      const cost = long[j - 1] === short[i - 1] ? 0 : 1;
      curr[i] = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[short.length];
}

export function searchPathologyTests(query: string, tests: PathologyTest[]): PathologyTest[] {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return tests;

  const scored = tests.map(test => {
    let score = -1;
    const nameLower = test.name.toLowerCase();
    const synonymsLower = (test.synonyms || []).map(s => s.toLowerCase());

    // 1. Exact Match on name
    if (nameLower === cleanQuery) {
      score = Math.max(score, 100);
    }

    // 2. Exact Match on any synonym (Synonym Priority!)
    synonymsLower.forEach(syn => {
      if (syn === cleanQuery) {
        score = Math.max(score, 95);
      }
    });

    // 3. Name starts with query
    if (nameLower.startsWith(cleanQuery)) {
      score = Math.max(score, 85);
    }

    // 4. Synonym starts with query
    synonymsLower.forEach(syn => {
      if (syn.startsWith(cleanQuery)) {
        score = Math.max(score, 80);
      }
    });

    // 5. Word starts with query inside Name
    const nameWords = nameLower.split(/[\s/()_.-]+/);
    nameWords.forEach(word => {
      if (word.startsWith(cleanQuery) && cleanQuery.length >= 2) {
        score = Math.max(score, 75);
      }
    });

    // 6. Word starts with query inside any Synonym
    synonymsLower.forEach(syn => {
      const synWords = syn.split(/[\s/()_.-]+/);
      synWords.forEach(word => {
        if (word.startsWith(cleanQuery) && cleanQuery.length >= 2) {
          score = Math.max(score, 70);
        }
      });
    });

    // 7. Substring match on name
    if (nameLower.includes(cleanQuery)) {
      score = Math.max(score, 65);
    }

    // 8. Substring match on synonym
    synonymsLower.forEach(syn => {
      if (syn.includes(cleanQuery)) {
        score = Math.max(score, 60);
      }
    });

    // 8b. Normalised tiers — same shapes as 1/2/3/4/7/8, one point of rank
    // below the raw version, so `haemoglobin` reaches the Hb record without
    // beating somebody who typed the catalogue name exactly.
    const nQuery = normalizeSearchTerm(cleanQuery);
    if (nQuery.length >= 2) {
      const nName = normalizeSearchTerm(nameLower);
      const nSyns = synonymsLower.map(normalizeSearchTerm);
      if (nName === nQuery) score = Math.max(score, 99);
      if (nSyns.some(s => s === nQuery)) score = Math.max(score, 94);
      if (nName.startsWith(nQuery)) score = Math.max(score, 84);
      if (nSyns.some(s => s.startsWith(nQuery))) score = Math.max(score, 79);
      if (nName.includes(nQuery)) score = Math.max(score, 64);
      if (nSyns.some(s => s.includes(nQuery))) score = Math.max(score, 59);
    }

    // 8c. Every word of a multi-word query is present — 'sugar fasting',
    // 'liver function panel', 'three month sugar test'. Word order in the
    // catalogue rarely matches how staff type it, and substring matching
    // cannot bridge the gap.
    const queryWords = cleanQuery.split(/[\s/()_.-]+/).filter(w => w.length >= 2);
    if (queryWords.length >= 2) {
      const coveredBy = (tokens: string[]) => {
        const normalised = tokens.map(normalizeSearchTerm).filter(Boolean);
        return queryWords.every(w => normalised.some(t => t.startsWith(normalizeSearchTerm(w))));
      };
      if (coveredBy(nameWords)) score = Math.max(score, 76);
      else if (synonymsLower.some(s => coveredBy(s.split(/[\s/()_.-]+/))))
        score = Math.max(score, 72);
    }

    // 9. Length-restricted mild fuzzy fallback.
    //
    // Only reached when no cheaper tier matched: every fuzzy score below is
    // (45 - distance) at most, strictly under the lowest substring tier (60),
    // so a candidate that already scored can never be overtaken by fuzzing —
    // skipping it here is exact and removes the bulk of the edit-distance work.
    if (cleanQuery.length >= 3 && score < 0) {
      // Determine max edit distance threshold
      const maxFuzzyDist = cleanQuery.length <= 4 ? 1 : 2;
      // A length gap larger than the threshold already proves the distance
      // exceeds it, so bail before paying for the DP.
      const distWithin = (candidate: string, limit: number): number =>
        Math.abs(candidate.length - cleanQuery.length) > limit
          ? limit + 1
          : getLevenshteinDistance(cleanQuery, candidate);

      // Entire test name fuzzy
      const distName = distWithin(nameLower, maxFuzzyDist);
      if (distName <= maxFuzzyDist) {
        score = Math.max(score, 45 - distName);
      }

      // Fuzzy on individual words in test name
      nameWords.forEach(word => {
        if (word.length >= 3) {
          const wordMaxDist = cleanQuery.length <= 4 || word.length <= 4 ? 1 : 2;
          const distWord = distWithin(word, wordMaxDist);
          if (distWord <= wordMaxDist) {
            score = Math.max(score, 40 - distWord);
          }
        }
      });

      // Entire synonym fuzzy
      synonymsLower.forEach(syn => {
        const distSyn = distWithin(syn, maxFuzzyDist);
        if (distSyn <= maxFuzzyDist) {
          score = Math.max(score, 35 - distSyn);
        }

        // Fuzzy on word in synonym
        const synWords = syn.split(/[\s/()_.-]+/);
        synWords.forEach(word => {
          if (word.length >= 3) {
            const wordMaxDist = cleanQuery.length <= 4 || word.length <= 4 ? 1 : 2;
            const distSynWord = distWithin(word, wordMaxDist);
            if (distSynWord <= wordMaxDist) {
              score = Math.max(score, 30 - distSynWord);
            }
          }
        });
      });
    }

    return { test, score };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.test);
}

/**
 * Reduce a stored `testSelection` to the *profiles* the user actually picked.
 *
 * When a group (e.g. CBC) is selected, `addTest` also stores every member
 * parameter alongside it, so the raw array length is the number of individual
 * results, not the number of ordered tests. This drops any entry that is a
 * member of another *selected* group, so a lone CBC selection collapses to
 * `['CBC (COMPLETE BLOOD COUNT)']` — one test — while standalone picks and
 * members ordered on their own are preserved.
 */
export function collapseToProfiles(testSelection: readonly string[] | undefined): string[] {
  if (!testSelection || testSelection.length === 0) return [];
  const infoByName = new Map(getPathologyTests().map(t => [t.name, t]));
  const selected = Array.from(
    new Set(testSelection.map(name => (name ?? '').trim()).filter(Boolean)),
  );
  const members = new Set<string>();
  for (const name of selected) {
    const info = infoByName.get(name);
    if (info?.isGroup && info.includedTests) {
      for (const member of info.includedTests) {
        const m = (member ?? '').trim();
        if (m) members.add(m);
      }
    }
  }
  return selected.filter(name => !members.has(name));
}

/**
 * Where a numeric result sits relative to the patient-adjusted reference range.
 * `null` means the value can't be compared (qualitative test, no range, or a
 * non-numeric entry) — callers render those without a coloured flag.
 */
export type ValueStatus = 'normal' | 'low' | 'high';

export interface ResolvedValue {
  status: ValueStatus | null;
  /** Human reference-range label for this patient (age/gender adjusted). */
  rangeLabel: string;
  unit: string;
  /** Band `rangeLabel` came from — 'none' when there is no interval at all. */
  rangeKind: RangeBandKind;
  /** `rangeLabel` is not established for this patient; show the caveat. */
  unverifiedForPatient: boolean;
}

/**
 * Compare a stored result value against the reference range for a given
 * patient. Mirrors the exact low/high/normal decision the report editor and
 * PDF renderer already make (see ReportsPage), so a timeline flag never
 * disagrees with the signed report it came from. Accepts the raw test name as
 * it appears in `resultData`.
 */
export function resolveValueStatus(
  testName: string,
  value: unknown,
  age?: number,
  gender?: string,
): ResolvedValue {
  const testInfo = findTestInfo(testName);
  const resolved = resolveReferenceRange(testInfo?.ranges, age, gender);
  const { label: rangeLabel, values: refValues } = resolved;
  const unit = testInfo?.unit ?? '';

  const raw =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  const verdict = {
    rangeLabel,
    unit,
    rangeKind: resolved.kind,
    unverifiedForPatient: resolved.unverifiedForPatient,
  };
  if (!testInfo || !raw) return { status: null, ...verdict };

  const num = Number(raw);
  if (!refValues || Number.isNaN(num)) return { status: null, ...verdict };

  if (refValues.min !== undefined && num < refValues.min) {
    return { status: 'low', ...verdict };
  }
  if (refValues.max !== undefined && num > refValues.max) {
    return { status: 'high', ...verdict };
  }
  return { status: 'normal', ...verdict };
}

export const getReferenceRangeValues = (
  ranges: ReferenceRange | undefined,
  age?: number,
  gender?: string,
): { min?: number; max?: number } | null => resolveReferenceRange(ranges, age, gender).values;

/** Data-integrity problems the catalogue can be audited for. */
export type CatalogueIssueKind =
  | 'duplicate-id'
  | 'duplicate-name'
  | 'duplicate-synonym'
  | 'synonym-collision'
  | 'unknown-group-member';

export interface CatalogueIssue {
  kind: CatalogueIssueKind;
  id: string;
  detail: string;
}

/**
 * Integrity sweep over the test catalogue. Two records that share a lookup key
 * are the dangerous case — `findTestInfo` returns the first match, so a report
 * row can silently read the other record's unit and reference range — which is
 * why duplicate names are reported rather than merely logged. Run it in the
 * test suite so a new entry can't land on top of an existing name.
 */
export function auditPathologyCatalogue(
  tests: PathologyTest[] = DEFAULT_PATHOLOGY_TESTS,
): CatalogueIssue[] {
  const issues: CatalogueIssue[] = [];
  const idCount = new Map<string, number>();
  const nameKeys = new Map<string, string[]>();
  const synonymOwner = new Map<string, string>();

  for (const test of tests) {
    idCount.set(test.id, (idCount.get(test.id) || 0) + 1);
    const nameKey = normalizeSearchTerm(test.name);
    nameKeys.set(nameKey, [...(nameKeys.get(nameKey) || []), test.name]);

    const seen = new Set<string>();
    for (const synonym of test.synonyms || []) {
      const key = normalizeSearchTerm(synonym);
      if (!key) continue;
      if (seen.has(key)) {
        issues.push({ kind: 'duplicate-synonym', id: test.id, detail: synonym });
      }
      seen.add(key);
      const owner = synonymOwner.get(key);
      if (owner && owner !== test.id) {
        issues.push({
          kind: 'synonym-collision',
          id: test.id,
          detail: `${synonym} (also on ${owner})`,
        });
      } else {
        synonymOwner.set(key, test.id);
      }
    }
  }

  for (const [id, count] of idCount) {
    if (count > 1) issues.push({ kind: 'duplicate-id', id, detail: `${count} records` });
  }
  for (const [, names] of nameKeys) {
    if (names.length > 1) {
      issues.push({
        kind: 'duplicate-name',
        id: names[0],
        detail: `${names.join(' / ')} — one lookup key, first record wins`,
      });
    }
  }

  const names = new Set(tests.map(t => t.name));
  for (const group of tests) {
    for (const member of group.includedTests || []) {
      if (!names.has(member)) {
        issues.push({ kind: 'unknown-group-member', id: group.id, detail: member });
      }
    }
  }

  return issues;
}
