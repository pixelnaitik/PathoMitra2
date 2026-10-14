import { describe, it, expect } from 'vitest';
import { validateLayoutSettings, sanitizeFieldValue, REPORT_FIELDS } from './report-layout-spec';
import { DEFAULT_SETTINGS } from './settings';
import type { LabSettings } from './settings';

const withSettings = (patch: Partial<LabSettings>): LabSettings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
});

describe('validateLayoutSettings', () => {
  it('accepts the recommended defaults with no issues', () => {
    expect(validateLayoutSettings(DEFAULT_SETTINGS)).toEqual([]);
  });

  it('flags vertical margins that leave no room for content', () => {
    const issues = validateLayoutSettings(
      withSettings({ reportMarginTop: 180, reportMarginBottom: 140 }),
    );
    const v = issues.find(i => i.field === 'reportMarginTop');
    expect(v?.message).toMatch(/277 mm or less/);
    expect(v?.message).toMatch(/only 0 mm/); // clamped display, still explains the fix
  });

  it('does NOT flag a tight-but-valid 180 + 95 mm stack (22 mm remain)', () => {
    const issues = validateLayoutSettings(
      withSettings({ reportMarginTop: 180, reportMarginBottom: 95 }),
    );
    expect(issues.find(i => i.field === 'reportMarginTop')).toBeUndefined();
  });

  it('flags unreadably small result text', () => {
    const issues = validateLayoutSettings(withSettings({ reportTableBodyFontSize: 7 }));
    expect(issues.some(i => i.field === 'reportTableBodyFontSize')).toBe(true);
  });
});

describe('sanitizeFieldValue', () => {
  it('clamps to the field range and rounds to the step without float noise', () => {
    const pad = REPORT_FIELDS.tableCellPadding; // step 0.2
    expect(sanitizeFieldValue(pad, 1.3999999)).toBe(1.4);
    expect(sanitizeFieldValue(pad, 99)).toBe(pad.max);
    expect(sanitizeFieldValue(pad, -5)).toBe(pad.min);
    const mm = REPORT_FIELDS.reportMarginTop; // step 1
    expect(sanitizeFieldValue(mm, 50.4)).toBe(50);
    expect(sanitizeFieldValue(mm, 50.6)).toBe(51);
  });
});
