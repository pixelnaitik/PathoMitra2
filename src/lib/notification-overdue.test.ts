import { describe, expect, it } from 'vitest';

import { buildNotifications, type NotificationItem } from './notification-engine';
import type { PatientRecord, ReportRecord } from './models';

/**
 * The "awaiting report" rule, per ordered panel.
 *
 * This is the alert a missed sample hides behind, so the tests cover the three
 * ways a lab can be misled: silence because *some* report exists, silence because
 * the ordered list was replaced by an unrelated one, and an alert that names the
 * wrong number of pending tests.
 */

const NOW = new Date('2026-10-10T12:00:00.000Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const patient = (over: Partial<PatientRecord> = {}): PatientRecord =>
  ({
    id: '26100001',
    name: 'Asha Rao',
    age: 34,
    gender: 'female',
    createdAt: ago(30),
    testSelection: ['CBC', 'URINE ANALYSIS', 'LIPID PROFILE'],
    ...over,
  }) as PatientRecord;

const report = (over: Partial<ReportRecord> = {}): ReportRecord =>
  ({
    id: 'r1',
    patientId: '26100001',
    patientName: 'Asha Rao',
    resultData: {},
    signature: 'Dr Naitik',
    status: 'final',
    createdAt: ago(2),
    createdBy: 'Dr Naitik',
    version: 1,
    testSelection: [],
    ...over,
  }) as ReportRecord;

const overdueFor = (
  patients: PatientRecord[],
  reports: ReportRecord[],
  expandNames?: (names: readonly string[]) => string[],
): NotificationItem[] =>
  buildNotifications({ patients, reports, invoices: [], now: NOW, expandNames }).filter(
    item => item.category === 'overdue',
  );

describe('overdue alerts are per ordered panel', () => {
  it('alerts when nothing has been reported', () => {
    const items = overdueFor([patient()], []);
    expect(items).toHaveLength(1);
    expect(items[0]?.body).toContain('3 of 3 tests');
  });

  it('keeps alerting while only one of the ordered panels has been reported', () => {
    const items = overdueFor([patient()], [report({ testSelection: ['CBC'] })]);
    expect(items).toHaveLength(1);
    // The CBC is answered; the other two are the news.
    expect(items[0]?.body).toContain('2 of 3 tests');
    expect(items[0]?.body).toContain('URINE ANALYSIS');
    expect(items[0]?.body).not.toContain('CBC,');
  });

  it('goes quiet once every ordered panel has a report', () => {
    const items = overdueFor(
      [patient()],
      [
        report({ id: 'r1', testSelection: ['CBC'] }),
        report({ id: 'r2', testSelection: ['URINE ANALYSIS'] }),
        report({ id: 'r3', testSelection: ['LIPID PROFILE'] }),
      ],
    );
    expect(items).toHaveLength(0);
  });

  it('treats a draft as undelivered work rather than a delivered report', () => {
    const items = overdueFor([patient()], [report({ status: 'draft', testSelection: ['CBC'] })]);
    expect(items).toHaveLength(1);
    expect(items[0]?.body).toContain('2 of 3 tests');
  });

  it('does not invent an alert for a report that names no panel', () => {
    // An older document with no ordered list covers everything or nothing, and
    // guessing "nothing" would shout about a patient who plainly has a report.
    expect(overdueFor([patient()], [report({ testSelection: [] })])).toHaveLength(0);
  });

  it('ignores a walk-in registration with nothing ordered', () => {
    expect(overdueFor([patient({ testSelection: [] })], [])).toHaveLength(0);
  });

  it('waits for the configured threshold before alerting', () => {
    const fresh = patient({ createdAt: ago(3) });
    expect(overdueFor([fresh], [])).toHaveLength(0);
  });

  it('expands panels through the injected catalogue, so a member counts for its panel', () => {
    const expandNames = (names: readonly string[]) =>
      names.flatMap(name => (name === 'CBC' ? ['HEMOGLOBIN', 'PCV'] : [name]));

    // Ordered as panels, reported as members: without the expander this looks like
    // nothing was delivered, and the lab gets shouted at over a finished CBC.
    const items = overdueFor(
      [patient({ testSelection: ['CBC', 'LIPID PROFILE'] })],
      [report({ testSelection: ['HEMOGLOBIN', 'PCV'] })],
      expandNames,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.body).toContain('1 of 3 tests');
  });
});
