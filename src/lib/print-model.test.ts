/**
 * The print dialog's arithmetic — the part that can quietly print the wrong
 * pages. Every case here is a mistake a lab could otherwise only discover at the
 * printer.
 */
import { describe, expect, it } from 'vitest';
import type { DesktopPrinter } from './desktop-bridge';
import {
  clampCopies,
  canPrint,
  describeJob,
  formatPageList,
  groupPages,
  initialPrintSettings,
  isVirtualPrinter,
  pageBoxMm,
  parsePageRanges,
  previewBox,
  selectedPages,
} from './print-model';

const printer = (name: string, isDefault = false): DesktopPrinter => ({
  name,
  displayName: name,
  description: '',
  isDefault,
});

describe('parsePageRanges', () => {
  it('accepts single pages, ranges and mixtures', () => {
    expect(parsePageRanges('2', 5).pages).toEqual([2]);
    expect(parsePageRanges('1-3', 5).pages).toEqual([1, 2, 3]);
    expect(parsePageRanges('1,3-5', 5).pages).toEqual([1, 3, 4, 5]);
    expect(parsePageRanges('1, 2 , 3', 4).pages).toEqual([1, 2, 3]);
    expect(parsePageRanges('2 and 4', 6).pages).toEqual([2, 4]);
  });

  it('tolerates the dashes people actually type', () => {
    expect(parsePageRanges('2–4', 6).pages).toEqual([2, 3, 4]);
    expect(parsePageRanges('2—4', 6).pages).toEqual([2, 3, 4]);
    expect(parsePageRanges('2~4', 6).pages).toEqual([2, 3, 4]);
    expect(parsePageRanges(' 1 - 2 ', 3).pages).toEqual([1, 2]);
  });

  it('reads an open end as "to the end" and an open start as "from the first"', () => {
    expect(parsePageRanges('3-', 5).pages).toEqual([3, 4, 5]);
    expect(parsePageRanges('-2', 5).pages).toEqual([1, 2]);
  });

  it('takes the span when the ends are reversed', () => {
    expect(parsePageRanges('5-2', 6).pages).toEqual([2, 3, 4, 5]);
  });

  it('deduplicates and sorts', () => {
    expect(parsePageRanges('4,1,2-3,3', 4).pages).toEqual([1, 2, 3, 4]);
  });

  it('refuses pages that do not exist rather than clamping them', () => {
    const result = parsePageRanges('1-9', 4);
    expect(result.pages).toEqual([]);
    expect(result.error).toMatch(/Page 9 does not exist/);
    expect(result.error).toMatch(/4 pages/);
  });

  it('refuses garbage instead of falling back to "all pages"', () => {
    // The dangerous alternative is printing a whole report because a comma was
    // typed wrong — so an unparsable field must never mean "everything".
    expect(parsePageRanges('abc', 4).error).toMatch(/not a page/);
    expect(parsePageRanges('1-', 0).error).toBeTruthy();
    expect(parsePageRanges('', 4).error).toMatch(/at least one page/);
    expect(parsePageRanges('0', 4).error).toMatch(/Page 0 does not exist/);
  });
});

describe('groupPages / formatPageList', () => {
  it('collapses runs into ranges for display', () => {
    expect(groupPages([1, 2, 3, 5])).toEqual([
      { from: 1, to: 3 },
      { from: 5, to: 5 },
    ]);
    expect(formatPageList([1, 2, 3, 5])).toBe('1–3, 5');
    expect(formatPageList([2])).toBe('2');
    expect(formatPageList([])).toBe('');
  });
});

describe('selectedPages', () => {
  const base = { rangeText: '2-3', currentPage: 1 };

  it('expands "all" to every page of the document', () => {
    expect(selectedPages({ ...base, rangeMode: 'all' }, 3).pages).toEqual([1, 2, 3]);
  });

  it('clamps "current" into the document', () => {
    expect(selectedPages({ ...base, rangeMode: 'current', currentPage: 9 }, 4).pages).toEqual([4]);
    expect(selectedPages({ ...base, rangeMode: 'current', currentPage: 0 }, 4).pages).toEqual([1]);
  });

  it('passes a bad custom field through as an error', () => {
    const result = selectedPages({ ...base, rangeMode: 'custom', rangeText: 'x' }, 4);
    expect(result.pages).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

describe('geometry', () => {
  it('swaps the box for landscape', () => {
    expect(pageBoxMm('A4', false)).toEqual({ w: 210, h: 297 });
    expect(pageBoxMm('A4', true)).toEqual({ w: 297, h: 210 });
  });

  it('fits the preview inside the pane, honouring the aspect ratio', () => {
    const box = previewBox({ pageSize: 'A4', landscape: false }, { width: 300, height: 900 });
    // Width-limited: 300 px across a 210 mm sheet, height follows the ratio.
    expect(Math.round(box.widthPx)).toBe(300);
    expect(box.heightPx / box.widthPx).toBeCloseTo(297 / 210, 4);

    const short = previewBox({ pageSize: 'A4', landscape: false }, { width: 300, height: 200 });
    // Height-limited: the sheet must not overflow the pane.
    expect(Math.round(short.heightPx)).toBe(200);
    expect(short.widthPx).toBeLessThanOrEqual(300);
  });
});

describe('clampCopies', () => {
  it('keeps the field inside what a printer can do', () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(1000)).toBe(99);
    expect(clampCopies(Number.NaN)).toBe(1);
    expect(clampCopies(2.6)).toBe(3);
  });
});

describe('initialPrintSettings', () => {
  it('skips a virtual default printer — it writes files, not reports', () => {
    const printers = [printer('Adobe PDF', true), printer('HP LaserJet Pro M404')];
    const settings = initialPrintSettings(printers, 4);
    expect(settings.deviceName).toBe('HP LaserJet Pro M404');
    expect(isVirtualPrinter('Adobe PDF')).toBe(true);
    expect(isVirtualPrinter('HP LaserJet Pro M404')).toBe(false);
  });

  it('falls back to the default when it is a real printer', () => {
    const printers = [printer('Adobe PDF'), printer('Canon MF', true)];
    expect(initialPrintSettings(printers, 2).deviceName).toBe('Canon MF');
  });

  it('still opens on a machine with nothing installed', () => {
    const settings = initialPrintSettings([], 1);
    expect(settings.deviceName).toBe('');
    expect(settings.rangeText).toBe('1');
    expect(settings.pageSize).toBe('A4');
  });

  it('pre-fills the custom field with the whole document', () => {
    expect(initialPrintSettings([], 3).rangeText).toBe('1-3');
  });
});

describe('describeJob / canPrint', () => {
  const settings = {
    ...initialPrintSettings([printer('HP')], 4),
    deviceName: 'HP',
    copies: 2,
    collate: true,
    duplex: 'simplex' as const,
    landscape: false,
    pageSize: 'A4' as const,
    scale: 'fit' as const,
    rangeMode: 'custom' as const,
    rangeText: '1-2',
    currentPage: 1,
  };

  it('says what is about to happen', () => {
    expect(describeJob(settings, [1, 2], 4, printer('HP'))).toBe('2 sheets × 2 copies → HP');
  });

  it('refuses a job with no printer or no valid pages', () => {
    expect(canPrint({ ...settings, deviceName: '' }, [1], null)).toBe(false);
    expect(canPrint(settings, [], null)).toBe(false);
    expect(canPrint(settings, [], 'bad range')).toBe(false);
    expect(canPrint(settings, [1], null)).toBe(true);
  });
});
