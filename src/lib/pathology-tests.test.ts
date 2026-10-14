import { describe, it, expect } from 'vitest';
import {
  getReferenceRangeLabel,
  resolveReferenceRange,
  getLevenshteinDistance,
  normalizeSearchTerm,
  searchPathologyTests,
  findTestInfo,
  resolveTestKind,
  isNumericTest,
  getSearchableTests,
  auditPathologyCatalogue,
  DEFAULT_PATHOLOGY_TESTS,
  ADULT_MIN_AGE_YEARS,
  INFANT_MAX_AGE_YEARS,
  type PathologyTest,
  type ReferenceRange,
} from './pathology-tests';

describe('resolveReferenceRange — Adult male / Adult female / Infant bands', () => {
  const ranges: ReferenceRange = {
    male: { min: 13, max: 17 },
    female: { min: 12, max: 16 },
    infant: { min: 9.5, max: 13.5 },
    general: { min: 10, max: 20 },
  };

  it('gives an under-24-month patient the infant band, unflagged', () => {
    const r = resolveReferenceRange(ranges, 1, 'male');
    expect(r.kind).toBe('infant');
    expect(r.label).toBe('9.5 - 13.5');
    expect(r.unverifiedForPatient).toBe(false);
  });

  it('stops applying the infant band at the boundary', () => {
    expect(resolveReferenceRange(ranges, INFANT_MAX_AGE_YEARS - 1, 'male').kind).toBe('infant');
    expect(resolveReferenceRange(ranges, INFANT_MAX_AGE_YEARS, 'male').kind).toBe('adult-male');
  });

  it('applies the gender bands from the adult cut-off up', () => {
    expect(resolveReferenceRange(ranges, ADULT_MIN_AGE_YEARS, 'female').label).toBe('12.0 - 16.0');
    expect(resolveReferenceRange(ranges, 30, 'male').label).toBe('13.0 - 17.0');
    expect(resolveReferenceRange(ranges, 30, 'male').unverifiedForPatient).toBe(false);
  });

  it('shows a 2–11 year old the adult range and says it is not age-validated', () => {
    const r = resolveReferenceRange(ranges, 8, 'male');
    expect(r.label).toBe('13.0 - 17.0');
    expect(r.unverifiedForPatient).toBe(true);
    expect(r.reason).toMatch(/paediatric/i);
  });

  it('flags an infant with no infant interval rather than passing the adult one off', () => {
    const adultOnly: ReferenceRange = { male: ranges.male, female: ranges.female };
    const r = resolveReferenceRange(adultOnly, 0, 'female');
    expect(r.kind).toBe('adult-female');
    expect(r.unverifiedForPatient).toBe(true);
    expect(r.reason).toMatch(/infant/i);
  });

  it('honours a band the catalogue itself marks as awaiting verification', () => {
    const r = resolveReferenceRange(
      { male: { min: 4, max: 11, verification: 'requires-lab-verification' } },
      40,
      'male',
    );
    expect(r.unverifiedForPatient).toBe(true);
    expect(r.reason).toMatch(/awaiting laboratory verification/);
  });

  it('falls back to general when the gender is unknown, and to nothing when there is no band', () => {
    expect(resolveReferenceRange(ranges, 30).label).toBe('10.0 - 20.0');
    expect(resolveReferenceRange({}, 30, 'male').kind).toBe('none');
    expect(resolveReferenceRange(undefined, 30).label).toBe('');
  });

  it('keeps a text band verbatim and still digs out numeric bounds from the chain', () => {
    const textual: ReferenceRange = {
      infant: { text: 'Age dependent' },
      male: { min: 13, max: 17 },
    };
    const r = resolveReferenceRange(textual, 1, 'male');
    expect(r.label).toBe('Age dependent');
    expect(r.values).toEqual({ min: 13, max: 17 });
  });

  it('never lets a child inherit an adult range silently anywhere in the catalogue', () => {
    // The safety net for the removed `child` band: for every test that has adult
    // bands but no infant band, a 5-year-old must come back flagged.
    const offenders = DEFAULT_PATHOLOGY_TESTS.filter(t => {
      const r = resolveReferenceRange(t.ranges, 5, 'male');
      return r.label !== '' && !r.unverifiedForPatient && r.kind !== 'general';
    }).map(t => t.name);
    expect(offenders).toEqual([]);
  });
});

describe('getReferenceRangeLabel', () => {
  const ranges: ReferenceRange = {
    male: { min: 13, max: 17 },
    female: { min: 12, max: 16 },
    infant: { text: 'Age dependent' },
    general: { min: 10, max: 20 },
  };

  it('is the label of the resolved band', () => {
    expect(getReferenceRangeLabel(ranges, 1, 'male')).toBe('Age dependent');
    expect(getReferenceRangeLabel(ranges, 30, 'male')).toBe('13.0 - 17.0');
    expect(getReferenceRangeLabel(ranges, 30, 'female')).toBe('12.0 - 16.0');
    expect(getReferenceRangeLabel(ranges, 30)).toBe('10.0 - 20.0');
  });

  it('returns empty string for no ranges', () => {
    expect(getReferenceRangeLabel({})).toBe('');
  });

  it('tolerates a missing range map (callers pass test.ranges, which is optional)', () => {
    expect(getReferenceRangeLabel(undefined)).toBe('');
    expect(getReferenceRangeLabel(null as never)).toBe('');
  });
});

describe('resolveTestKind', () => {
  const test = (partial: Partial<PathologyTest>): PathologyTest => ({
    id: 't',
    name: 'TEST',
    category: 'C',
    ...partial,
  });

  it('an explicit kind always wins over inference', () => {
    expect(
      resolveTestKind(
        test({ kind: 'text', unit: 'mg/dL', ranges: { general: { min: 1, max: 2 } } }),
      ),
    ).toBe('text');
  });

  it('treats a test with options as categorical', () => {
    expect(resolveTestKind(test({ options: ['A Positive', 'B Negative'] }))).toBe('categorical');
  });

  it('recognises a dilution as a titer, not a number', () => {
    expect(resolveTestKind(test({ ranges: { general: { text: '1:160' } } }))).toBe('titer');
    expect(resolveTestKind(test({ unit: 'titer' }))).toBe('titer');
  });

  it('classifies numeric bounds and numeric text ranges', () => {
    expect(resolveTestKind(test({ ranges: { general: { min: 10, max: 20 } } }))).toBe('numeric');
    expect(resolveTestKind(test({ ranges: { general: { text: '< 5' } } }))).toBe('numeric');
  });

  it('does not mistake a qualitative word for a number', () => {
    // This is the bug the old regex-based isNumericTest had: "NEGATIVE" read as
    // a measurement, so the UI offered a numeric input and range colouring.
    expect(resolveTestKind(test({ ranges: { general: { text: 'NEGATIVE' } } }))).toBe('text');
    expect(isNumericTest(test({ ranges: { general: { text: 'NON REACTIVE' } } }))).toBe(false);
  });

  it('falls back to the unit when there are no ranges', () => {
    expect(resolveTestKind(test({ unit: 'g/dL' }))).toBe('numeric');
    expect(resolveTestKind(test({}))).toBe('text');
  });

  it('never treats a group or section header as a result field', () => {
    expect(resolveTestKind(test({ isGroup: true, unit: 'cells' }))).toBe('text');
    expect(resolveTestKind(test({ isHeader: true }))).toBe('text');
    expect(resolveTestKind(undefined)).toBe('text');
  });

  it('classifies the shipped catalog without a single "text" numeric misread', () => {
    const grouped = DEFAULT_PATHOLOGY_TESTS.filter(t => t.isGroup || t.isHeader);
    expect(grouped.every(t => !isNumericTest(t))).toBe(true);
    // Every catalog entry must resolve to one of the four known kinds.
    expect(DEFAULT_PATHOLOGY_TESTS.every(t => resolveTestKind(t).length > 0)).toBe(true);
  });
});

describe('getLevenshteinDistance', () => {
  it('computes edit distances', () => {
    expect(getLevenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(getLevenshteinDistance('abc', 'abc')).toBe(0);
    expect(getLevenshteinDistance('', 'abc')).toBe(3);
  });
});

describe('searchPathologyTests / findTestInfo', () => {
  it('finds a test by exact name (case-insensitive)', () => {
    const found = findTestInfo('cbc');
    expect(found).toBeDefined();
  });

  it('ranks synonym matches highly (hemogram -> CBC group)', () => {
    const results = searchPathologyTests('hemogram', DEFAULT_PATHOLOGY_TESTS);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name.toLowerCase()).toContain('complete blood count');
  });

  it('returns all tests for an empty query', () => {
    expect(searchPathologyTests('', DEFAULT_PATHOLOGY_TESTS)).toBe(DEFAULT_PATHOLOGY_TESTS);
  });
});

describe('searchPathologyTests — Indian disease→test relevance', () => {
  it('surfaces the WIDAL group and its S. typhi components for "typhoid"', () => {
    const results = searchPathologyTests('typhoid', DEFAULT_PATHOLOGY_TESTS);
    expect(results.some(r => r.name === 'WIDAL REACTION')).toBe(true);
    expect(results.some(r => /S\. typhi/i.test(r.name))).toBe(true);
    // The group outranks its members because "typhoid" is an exact synonym of it.
    expect(results[0].name).toBe('WIDAL REACTION');
  });

  it('finds HbA1c by its glycated-haemoglobin synonyms', () => {
    for (const q of ['hba1c', 'a1c', 'glycated haemoglobin']) {
      const results = searchPathologyTests(q, DEFAULT_PATHOLOGY_TESTS);
      expect(results.some(r => r.name === 'HbA1c')).toBe(true);
    }
  });

  it('hides group members in the browse list but searches them once typing', () => {
    const browse = getSearchableTests([], '');
    const typed = getSearchableTests([], 'typhi');
    expect(browse.some(t => t.name === "S. typhi 'o'")).toBe(false);
    expect(typed.some(t => t.name === "S. typhi 'o'")).toBe(true);
  });
});

describe('normalizeSearchTerm — spelling tolerance', () => {
  it('folds punctuation, spacing, case, plurals and British / American spellings', () => {
    expect(normalizeSearchTerm('H.D.L.')).toBe(normalizeSearchTerm('hdl'));
    expect(normalizeSearchTerm('haemoglobin')).toBe(normalizeSearchTerm('hemoglobin'));
    expect(normalizeSearchTerm('oedema')).toBe(normalizeSearchTerm('edema'));
    expect(normalizeSearchTerm('platelets')).toBe(normalizeSearchTerm('platelet'));
    expect(normalizeSearchTerm('Complete Blood Count')).toBe(
      normalizeSearchTerm('completebloodcount'),
    );
  });
});

describe('searchPathologyTests — how lab staff actually type', () => {
  const names = (query: string) =>
    searchPathologyTests(query, DEFAULT_PATHOLOGY_TESTS).map(t => t.name);

  it('reaches the Hb record from either spelling', () => {
    expect(names('haemoglobin')).toContain('HB (HAEMOGLOBIN)');
    expect(names('hemoglobin')).toContain('HB (HAEMOGLOBIN)');
  });

  it('matches dotted abbreviations and plurals', () => {
    expect(names('hdl')).toContain('H.D.L.');
    expect(names('platelets')).toContain('PLATELET COUNT');
  });

  it('ignores word order in a multi-word query', () => {
    expect(names('sugar fasting')).toContain('Blood Sugar Fasting');
    expect(names('liver function panel')).toContain('LIVER FUNCTION TEST (LFT)');
  });

  it('finds tests by the Hinglish phrase typed at the counter', () => {
    expect(names('khali pet sugar')).toContain('Blood Sugar Fasting');
    expect(names('khoon ki kami')).toContain('HB (HAEMOGLOBIN)');
    expect(names('peshab')).toContain('URINE ANALYSIS');
  });

  it('keeps clinically distinct tests separate for an ambiguous term', () => {
    const results = names('sugar');
    for (const expected of ['Blood Sugar Fasting', 'Blood Sugar (PP)', 'Blood Sugar Random']) {
      expect(results).toContain(expected);
    }
  });

  it('surfaces a profile and its components without merging them', () => {
    const results = names('thyroid');
    expect(results).toContain('THYROID PROFILE');
    expect(results).toContain('T.S.H.');
  });
});

describe('auditPathologyCatalogue', () => {
  const issues = auditPathologyCatalogue();

  it('ships without duplicate ids or dangling profile members', () => {
    expect(issues.filter(i => i.kind === 'duplicate-id')).toEqual([]);
    expect(issues.filter(i => i.kind === 'unknown-group-member')).toEqual([]);
  });

  it('reports the known "Albumin" name collision instead of letting it pass', () => {
    // Serum albumin (LFT) and urine albumin share one lookup key, and
    // findTestInfo returns the first match — so the LFT row reads the urine
    // record's '+' options. Renaming either would rewrite historical reports,
    // so it is reported for the lab to decide rather than fixed silently.
    const collisions = issues.filter(i => i.kind === 'duplicate-name').map(i => i.detail);
    expect(collisions.some(d => /Albumin/.test(d))).toBe(true);
  });
});

describe('catalogue coverage after the 2026-10 expansion', () => {
  it('gives every numeric test an interval an adult can be reported against', () => {
    const missing = DEFAULT_PATHOLOGY_TESTS.filter(
      t => isNumericTest(t) && resolveReferenceRange(t.ranges, 30, 'male').label === '',
    ).map(t => t.name);
    expect(missing).toEqual([]);
  });

  it('marks every interval in a newly added category as awaiting lab verification', () => {
    // Nothing new may claim an approval it has not earned.
    const NEW_CATEGORIES = ['HORMONES', 'VITAMINS', 'ELECTROLYTES', 'CARDIAC MARKERS'];
    const unmarked = DEFAULT_PATHOLOGY_TESTS.filter(
      t =>
        NEW_CATEGORIES.includes(t.category) &&
        Object.values(t.ranges ?? {}).some(band => band !== undefined && !band.verification),
    ).map(t => t.name);
    expect(unmarked).toEqual([]);
  });

  it('adds the profiles the audit found missing', () => {
    const groups = DEFAULT_PATHOLOGY_TESTS.filter(t => t.isGroup).map(t => t.name);
    for (const expected of [
      'THYROID PROFILE',
      'KIDNEY FUNCTION TEST (KFT)',
      'LIVER FUNCTION TEST (LFT)',
      'BLOOD SUGAR PROFILE',
      'ELECTROLYTE PROFILE',
      'IRON STUDIES',
      'ANAEMIA PROFILE',
      'VITAMIN PROFILE',
      'FEVER PROFILE',
      'ANTENATAL PROFILE',
      'CARDIAC MARKERS',
      'RHEUMATOID ARTHRITIS PROFILE',
      'PANCREAS PROFILE',
      'STOOL EXAMINATION',
    ]) {
      expect(groups).toContain(expected);
    }
  });

  it('keeps every new-profile component individually orderable', () => {
    // A profile must not remove an existing way to order a test.
    const browse = getSearchableTests([], '').map(t => t.name);
    for (const stillOrderable of [
      'S. creatinine',
      'HbA1c',
      'Total Serum Bilirubin',
      'Sodium',
      'Serum Ferritin',
      'T.S.H.',
    ]) {
      expect(browse).toContain(stillOrderable);
    }
    // …and the panels that always hid their members must still hide them:
    // Hb is ordered through the CBC panel, before and after this expansion.
    expect(browse).not.toContain('HB (HAEMOGLOBIN)');
    expect(browse).not.toContain("S. typhi 'o'");
  });

  it('preserves the original catalogue order ahead of the additions', () => {
    // Historical reports resolve rows by name, and the picker shows this order.
    const names = DEFAULT_PATHOLOGY_TESTS.map(t => t.name);
    expect(names.slice(0, 3)).toEqual([
      'CBC (COMPLETE BLOOD COUNT)',
      'WHITE CELL COUNT(TC)',
      'DIFFERENTIAL COUNT WBC',
    ]);
    expect(names.indexOf('CBC (COMPLETE BLOOD COUNT)')).toBeLessThan(
      names.indexOf('THYROID PROFILE'),
    );
    expect(names.indexOf('PREGNANCY TEST')).toBeLessThan(names.indexOf('T.S.H.'));
  });
});
