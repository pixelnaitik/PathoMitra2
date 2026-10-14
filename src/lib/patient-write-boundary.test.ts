import { describe, expect, it } from 'vitest';

import { operatorStamp, toPatientDoc, toPatientUpdateDoc, readPatient } from './models';
import {
  DEFAULT_SETTINGS,
  LETTERHEAD_MAX_CHARS,
  migrateSettings,
  SETTINGS_STORAGE_KEY,
  isLetterheadDataUrl,
} from './settings';
import { REPORT_FIELDS } from './report-layout-spec';

/**
 * The write boundary.
 *
 * Every read in the app already went through a zod reader, but patient records
 * were written as whatever the form object happened to hold — so the shape of a
 * clinical record was decided by whichever screen saved last. These builders are
 * the fix, and they are the code that decides what ends up in the encrypted
 * database, so they are the code worth pinning.
 */
describe('toPatientDoc', () => {
  const form = {
    name: '  Asha  Rao ',
    age: '34',
    gender: 'female',
    phone: '  ',
    doctorName: 'DR M KUMAR',
    address: 'Gaya',
    testSelection: ['CBC', '  ', 'TSH'],
  };

  it('trims the name and stores age as a whole number', () => {
    const doc = toPatientDoc(form);
    expect(doc.name).toBe('Asha  Rao');
    expect(doc.age).toBe(34);
  });

  it('drops a blank optional field instead of writing an empty string', () => {
    const doc = toPatientDoc(form);
    expect('phone' in doc).toBe(false);
    expect(doc.doctorName).toBe('DR M KUMAR');
  });

  it('removes empty entries from the ordered panel list', () => {
    expect(toPatientDoc(form).testSelection).toEqual(['CBC', 'TSH']);
  });

  it('refuses to write NaN, negative or impossible ages', () => {
    expect(toPatientDoc({ ...form, age: 'abc' }).age).toBe(0);
    expect(toPatientDoc({ ...form, age: '-5' }).age).toBe(0);
    expect(toPatientDoc({ ...form, age: 9999 }).age).toBe(150);
    expect(toPatientDoc({ ...form, age: 2 }).age).toBe(2);
  });

  it('stamps a creation date when none is supplied, and keeps one that is', () => {
    const stamped = toPatientDoc(form).createdAt as string;
    expect(stamped).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(toPatientDoc({ ...form, createdAt: '2026-01-02T03:04:05.000Z' }).createdAt).toBe(
      '2026-01-02T03:04:05.000Z',
    );
  });

  it('produces a document the boundary reader accepts unchanged', () => {
    const doc = toPatientDoc({ ...form, phone: '+91 98765 43210' });
    const read = readPatient('26100001', doc);
    expect(read.name).toBe('Asha  Rao');
    expect(read.age).toBe(34);
    expect(read.phone).toBe('+91 98765 43210');
    expect(read.testSelection).toEqual(['CBC', 'TSH']);
  });
});

describe('toPatientUpdateDoc', () => {
  it('never carries a createdAt, so an edit cannot blank the registration date', () => {
    const patch = toPatientUpdateDoc({
      name: 'Asha Rao',
      age: '34',
      gender: 'female',
      testSelection: ['CBC'],
    });
    expect('createdAt' in patch).toBe(false);
    expect(patch.name).toBe('Asha Rao');
  });

  it('leaves the stored registration date intact through a read/write round trip', () => {
    const original = toPatientDoc({
      name: 'Asha Rao',
      age: '34',
      gender: 'female',
      createdAt: '2026-01-02T03:04:05.000Z',
    });
    const merged = {
      ...original,
      ...toPatientUpdateDoc({ name: 'Asha R Kumar', age: '35', gender: 'female' }),
    };
    expect(merged.createdAt).toBe('2026-01-02T03:04:05.000Z');
    expect(merged.name).toBe('Asha R Kumar');
    expect(merged.age).toBe(35);
  });
});

describe('operatorStamp', () => {
  it('prefers the readable display name over the fixed local uid', () => {
    expect(operatorStamp({ uid: 'local-admin', displayName: 'Dr Naitik' })).toBe('Dr Naitik');
  });

  it('falls back to the uid, then to unknown — and never an empty audit line', () => {
    expect(operatorStamp({ uid: 'local-admin', displayName: '   ' })).toBe('local-admin');
    expect(operatorStamp(null)).toBe('unknown');
    expect(operatorStamp(undefined)).toBe('unknown');
  });
});

describe('migrateSettings clamps the report layout', () => {
  const clamp = (fields: Record<string, unknown>) =>
    migrateSettings({ ...DEFAULT_SETTINGS, ...fields });

  // Asserted against the spec rather than hand-copied numbers: the whole point of
  // the clamp is that the store cannot hold a value outside the range the
  // controls and the PDF renderer already agree on, so a test with its own
  // constants would drift the moment a range was widened.
  it('pulls a hand-edited font size back inside the range the renderer assumes', () => {
    const spec = REPORT_FIELDS.reportTitleFontSize;
    expect(clamp({ reportTitleFontSize: 900 }).reportTitleFontSize).toBe(spec.max);
    expect(clamp({ reportTitleFontSize: 1 }).reportTitleFontSize).toBe(spec.min);
  });

  it('refuses margins that would leave no printable area', () => {
    expect(clamp({ reportMarginLeft: -50 }).reportMarginLeft).toBe(
      REPORT_FIELDS.reportMarginLeft.min,
    );
    expect(clamp({ reportMarginRight: 500 }).reportMarginRight).toBe(
      REPORT_FIELDS.reportMarginRight.max,
    );
  });

  it('replaces a non-numeric stored value with the recommended one', () => {
    expect(clamp({ notesFontSize: 'large' as unknown as number }).notesFontSize).toBe(
      DEFAULT_SETTINGS.notesFontSize,
    );
  });

  it('leaves a field it does not own alone', () => {
    expect(clamp({ labName: 'City Pathology' }).labName).toBe('City Pathology');
  });

  it('is idempotent — reading a migrated store cannot drift the numbers', () => {
    const once = clamp({ reportSectionGap: 99 });
    expect(clamp(once).reportSectionGap).toBe(once.reportSectionGap);
    expect(once.reportSectionGap).toBe(REPORT_FIELDS.reportSectionGap.max);
  });
});

describe('storage key sanity', () => {
  it('uses the internal key that existing lab data is stored under', () => {
    // Renaming this key silently loses a lab's settings (PROJECT_MEMORY: internal
    // identifiers are load-bearing, not cosmetic).
    expect(SETTINGS_STORAGE_KEY).toBe('pathologyos_settings');
  });
});

describe('the share letterhead must be a drawable inline image', () => {
  const settings = (sharingTemplateImage: unknown) =>
    migrateSettings({ ...DEFAULT_SETTINGS, sharingTemplateImage });

  it('keeps an inline image and the meaningful empty value', () => {
    expect(isLetterheadDataUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(settings('data:image/jpeg;base64,/9j/4AAQ').sharingTemplateImage).toBe(
      'data:image/jpeg;base64,/9j/4AAQ',
    );
    // '' means "no letterhead, use the plain template" — it must survive.
    expect(settings('').sharingTemplateImage).toBe('');
  });

  it('drops a remote URL, which this offline build can neither fetch nor should', () => {
    expect(settings('https://example.com/letterhead.png').sharingTemplateImage).toBe('');
    expect(settings('file:///C:/temp/lb.png').sharingTemplateImage).toBe('');
  });

  it('drops a non-image data URL and anything that is not a string', () => {
    expect(settings('data:application/javascript,alert(1)').sharingTemplateImage).toBe('');
    expect(settings(1234).sharingTemplateImage).toBe('');
    expect(settings(null).sharingTemplateImage).toBe('');
  });

  it('refuses a blob beyond the ceiling, which would be re-encoded on every page', () => {
    const huge = `data:image/png;base64,${'A'.repeat(LETTERHEAD_MAX_CHARS)}`;
    expect(isLetterheadDataUrl(huge)).toBe(false);
    expect(settings(huge).sharingTemplateImage).toBe('');
  });
});
