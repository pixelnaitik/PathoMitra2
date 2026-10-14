import { describe, it, expect } from 'vitest';
import {
  buildNotifications,
  formatAge,
  formatAmount,
  hoursBetween,
  resolvePrefs,
  summarizeNotifications,
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationItem,
} from './notification-engine';
import type { InvoiceRecord, PatientRecord, ReportRecord } from './models';

/** Fixed clock so every threshold test is deterministic. */
const NOW = new Date('2026-03-15T12:00:00.000Z');

/** ISO for `hours` before the fixed clock. */
function ago(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function patient(overrides: Partial<PatientRecord> = {}): PatientRecord {
  return {
    id: 'p1',
    name: 'Asha Rao',
    age: 34,
    gender: 'female',
    createdAt: ago(30),
    testSelection: ['CBC', 'Lipid Profile'],
    ...overrides,
  };
}

function report(overrides: Partial<ReportRecord> = {}): ReportRecord {
  return {
    id: 'r1',
    patientId: 'p1',
    patientName: 'Asha Rao',
    resultData: {},
    signature: 'b'.repeat(64),
    status: 'final',
    createdAt: ago(10),
    createdBy: 'uid-1',
    version: 1,
    ...overrides,
  };
}

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'i1',
    reportId: 'r1',
    patientId: 'p1',
    patientName: 'Asha Rao',
    amount: 1200,
    status: 'pending',
    createdAt: ago(24 * 10),
    ...overrides,
  };
}

/** Build items and pick the one category under test. */
function categoriesOf(items: NotificationItem[]): Set<string> {
  return new Set(items.map(item => item.category));
}

describe('hoursBetween', () => {
  it('measures elapsed hours against the supplied clock', () => {
    expect(hoursBetween(ago(6), NOW)).toBeCloseTo(6);
  });

  it('returns null for a missing or unparseable timestamp', () => {
    expect(hoursBetween(undefined, NOW)).toBeNull();
    expect(hoursBetween('', NOW)).toBeNull();
    expect(hoursBetween('not-a-date', NOW)).toBeNull();
  });

  it('returns a negative age for a future-dated record rather than hiding it', () => {
    expect(hoursBetween(ago(-2), NOW)).toBeCloseTo(-2);
  });
});

describe('resolvePrefs', () => {
  it('falls back to every default when nothing is stored', () => {
    expect(resolvePrefs()).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it('fills a partial channel object from the defaults', () => {
    expect(resolvePrefs({ channels: {} }).channels).toEqual(DEFAULT_NOTIFICATION_PREFS.channels);
    expect(resolvePrefs({ channels: { desktop: true } }).channels.desktop).toBe(true);
  });

  it('keeps default thresholds when only categories are overridden', () => {
    const prefs = resolvePrefs({ categories: { due: false } as never });
    expect(prefs.categories.due).toBe(false);
    expect(prefs.categories.overdue).toBe(true);
    expect(prefs.dueDays).toBe(7);
  });
});

describe('buildNotifications — awaiting reports', () => {
  it('alerts when a patient with collected tests has no report yet', () => {
    const items = buildNotifications({
      patients: [patient()],
      reports: [],
      invoices: [],
      now: NOW,
    });
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe('overdue');
    expect(items[0].id).toBe('overdue:p1');
    // Deep link starts composing the missing report for that patient.
    expect(items[0].link).toEqual({ tab: 'reports', param: { key: 'patient', value: 'p1' } });
  });

  it('escalates to critical once twice the threshold has passed', () => {
    const build = (hours: number) =>
      buildNotifications({
        patients: [patient({ createdAt: ago(hours) })],
        reports: [],
        invoices: [],
        now: NOW,
      });
    expect(build(25)[0]?.severity).toBe('warning');
    expect(build(49)[0]?.severity).toBe('critical');
  });

  it('stays quiet inside the configured grace window', () => {
    expect(
      buildNotifications({
        patients: [patient({ createdAt: ago(5) })],
        reports: [],
        invoices: [],
        now: NOW,
      }),
    ).toHaveLength(0);
  });

  it('honours a custom threshold', () => {
    const items = buildNotifications({
      patients: [patient({ createdAt: ago(6) })],
      reports: [],
      invoices: [],
      prefs: { overdueHours: 4 },
      now: NOW,
    });
    expect(items[0]?.category).toBe('overdue');
  });

  it('ignores walk-in registrations with no tests selected', () => {
    expect(
      categoriesOf(
        buildNotifications({
          patients: [patient({ testSelection: [] })],
          reports: [],
          invoices: [],
          now: NOW,
        }),
      ).has('overdue'),
    ).toBe(false);
  });

  it('says nothing once any report exists for the patient', () => {
    expect(
      categoriesOf(
        buildNotifications({
          patients: [patient()],
          reports: [report({ status: 'draft' })],
          invoices: [],
          now: NOW,
        }),
      ).has('overdue'),
    ).toBe(false);
  });

  it('drops a patient whose createdAt cannot be parsed', () => {
    expect(
      buildNotifications({
        patients: [patient({ createdAt: 'garbage' })],
        reports: [],
        invoices: [],
        now: NOW,
      }),
    ).toHaveLength(0);
  });
});

describe('buildNotifications — drafts', () => {
  it('flags a draft that has not been issued', () => {
    const items = buildNotifications({
      patients: [],
      reports: [report({ status: 'draft', patientId: '', createdAt: ago(30) })],
      invoices: [],
      now: NOW,
    });
    expect(items[0]?.category).toBe('draft');
    // Honest wording: this build has no patient-facing surface and no signing
    // service, so a draft alert must not promise a visibility or a signature that
    // cannot exist (see lib/report-compliance).
    expect(items[0]?.body).toContain('It stays in the lab until the report is issued.');
    expect(items[0]?.body).not.toMatch(/invisible to the patient|signed/i);
  });

  it('judges a draft by its last edit, not by when it was created', () => {
    const items = buildNotifications({
      patients: [],
      reports: [report({ status: 'draft', patientId: '', createdAt: ago(200), updatedAt: ago(2) })],
      invoices: [],
      now: NOW,
    });
    expect(items).toHaveLength(0);
  });

  it('never flags a finalized report as a draft', () => {
    expect(
      categoriesOf(
        buildNotifications({
          patients: [],
          reports: [report({ status: 'final', createdAt: ago(200) })],
          invoices: [],
          now: NOW,
        }),
      ).has('draft'),
    ).toBe(false);
  });
});

describe('buildNotifications — amendments', () => {
  it('surfaces a versioned-up issued report as informational', () => {
    const items = buildNotifications({
      patients: [],
      reports: [report({ version: 2, updatedAt: ago(5), amendReason: 'Transcription error' })],
      invoices: [],
      now: NOW,
    });
    expect(items[0]?.category).toBe('amended');
    expect(items[0]?.severity).toBe('info');
    expect(items[0]?.body).toContain('Transcription error');
  });

  it('loudens when the same report has been amended more than once', () => {
    const items = buildNotifications({
      patients: [],
      reports: [report({ version: 3, updatedAt: ago(5) })],
      invoices: [],
      now: NOW,
    });
    expect(items[0]?.severity).toBe('warning');
    expect(items[0]?.body).toContain('more than once');
  });

  it('stops reporting an amendment after it stops being news', () => {
    expect(
      categoriesOf(
        buildNotifications({
          patients: [],
          reports: [report({ version: 2, updatedAt: ago(24 * 10) })],
          invoices: [],
          now: NOW,
        }),
      ).has('amended'),
    ).toBe(false);
  });

  it('ignores version 1 reports', () => {
    expect(
      buildNotifications({
        patients: [],
        reports: [report({ version: 1, updatedAt: ago(2) })],
        invoices: [],
        now: NOW,
      }),
    ).toHaveLength(0);
  });
});

describe('buildNotifications — payments', () => {
  it('alerts on an invoice past its due window', () => {
    const items = buildNotifications({
      patients: [],
      reports: [],
      invoices: [invoice()],
      now: NOW,
    });
    expect(items[0]?.category).toBe('due');
    expect(items[0]?.title).toContain('₹1,200');
    expect(items[0]?.amount).toBe(1200);
  });

  it('caps payment alerts at warning, however old the dues are', () => {
    const items = buildNotifications({
      patients: [],
      reports: [],
      invoices: [invoice({ createdAt: ago(24 * 90) })],
      now: NOW,
    });
    expect(items[0]?.severity).toBe('warning');
  });

  it('says nothing about an invoice that is already paid', () => {
    expect(
      buildNotifications({
        patients: [],
        reports: [],
        invoices: [invoice({ status: 'paid' })],
        now: NOW,
      }),
    ).toHaveLength(0);
  });

  it('deep-links to the report the invoice belongs to', () => {
    const items = buildNotifications({
      patients: [],
      reports: [],
      invoices: [invoice({ reportId: 'r9' })],
      now: NOW,
    });
    expect(items[0]?.link).toEqual({ tab: 'reports', param: { key: 'report', value: 'r9' } });
  });

  it('still alerts, without a deep link, for an invoice with no report id', () => {
    const items = buildNotifications({
      patients: [],
      reports: [],
      invoices: [invoice({ reportId: '' })],
      now: NOW,
    });
    expect(items[0]?.link).toEqual({ tab: 'reports' });
  });
});

describe('buildNotifications — preferences and ordering', () => {
  it('respects a disabled category', () => {
    const items = buildNotifications({
      patients: [patient()],
      reports: [],
      invoices: [invoice()],
      prefs: { categories: { overdue: false, draft: true, amended: true, due: true } },
      now: NOW,
    });
    expect(categoriesOf(items).has('overdue')).toBe(false);
    expect(categoriesOf(items).has('due')).toBe(true);
  });

  it('sorts critical first, then warning, then info', () => {
    const items = buildNotifications({
      patients: [patient({ id: 'p9', createdAt: ago(100) })],
      reports: [report({ id: 'r2', patientId: 'p2', version: 2, updatedAt: ago(1) })],
      invoices: [invoice()],
      now: NOW,
    });
    expect(items.map(item => item.severity)).toEqual(['critical', 'warning', 'info']);
  });

  it('breaks severity ties by oldest record first', () => {
    const items = buildNotifications({
      patients: [
        patient({ id: 'a', createdAt: ago(30) }),
        patient({ id: 'b', createdAt: ago(40) }),
      ],
      reports: [],
      invoices: [],
      now: NOW,
    });
    expect(items.map(item => item.entityId)).toEqual(['b', 'a']);
  });

  it('produces nothing for an empty lab', () => {
    expect(buildNotifications({ patients: [], reports: [], invoices: [], now: NOW })).toEqual([]);
  });
});

describe('summarizeNotifications', () => {
  const items = buildNotifications({
    patients: [patient({ id: 'p9', createdAt: ago(100) })],
    reports: [report({ id: 'r2', patientId: 'p2', version: 2, updatedAt: ago(1) })],
    invoices: [invoice({ id: 'i1', amount: 500 }), invoice({ id: 'i2', amount: 700 })],
    now: NOW,
  });

  it('counts severities and totals outstanding dues', () => {
    const summary = summarizeNotifications(items);
    expect(summary.critical).toBe(1);
    expect(summary.dueAmount).toBe(1200);
    expect(summary.byCategory.due).toBe(2);
    expect(summary.total).toBe(items.length);
  });

  it('separates unread from already-handled alerts', () => {
    const read = items.map(item => ({ ...item, read: true }));
    expect(summarizeNotifications(items).unread).toBe(items.length);
    expect(summarizeNotifications(read).unread).toBe(0);
  });

  it('reports an all-clear cleanly for no alerts', () => {
    expect(summarizeNotifications([])).toMatchObject({
      total: 0,
      unread: 0,
      critical: 0,
      dueAmount: 0,
    });
  });
});

describe('formatters', () => {
  it('renders currency with Indian grouping', () => {
    expect(formatAmount(1200)).toBe('₹1,200');
    expect(formatAmount(123456)).toBe('₹1,23,456');
  });

  it('treats a non-finite amount as zero instead of printing NaN', () => {
    expect(formatAmount(Number.NaN)).toBe('₹0');
  });

  it('compacts an age to the smallest useful unit', () => {
    expect(formatAge(0.4)).toBe('<1h');
    expect(formatAge(5.2)).toBe('5h');
    expect(formatAge(30)).toBe('1d 6h');
    expect(formatAge(48)).toBe('2d');
  });
});
