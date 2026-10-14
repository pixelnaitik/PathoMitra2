import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  readPatient,
  readReport,
  readInvoice,
  readUser,
  ageAsNumber,
  toReportDoc,
  toReportUpdateDoc,
} from './models';

vi.mock('./telemetry', () => ({
  captureError: vi.fn(),
}));

import { captureError } from './telemetry';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readPatient', () => {
  it('parses a valid document and attaches the id', () => {
    const patient = readPatient('p1', {
      name: 'Asha Rao',
      age: 34,
      gender: 'female',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(patient).toMatchObject({ id: 'p1', name: 'Asha Rao', age: 34, gender: 'female' });
  });

  it('keeps legacy string ages so existing documents still parse', () => {
    const patient = readPatient('p2', { name: 'K V', age: '45', gender: 'male', createdAt: 'x' });
    expect(patient.age).toBe('45');
    expect(ageAsNumber(patient)).toBe(45);
  });

  it('degrades to a displayable stub and logs instead of throwing', () => {
    // An out-of-range age is rejected by the schema, exactly as the rules do.
    const patient = readPatient('bad1', {
      name: 'Impossible',
      age: 999,
      gender: 'other',
      createdAt: 'x',
    });
    expect(patient.id).toBe('bad1');
    expect(patient.name).toContain('bad1');
    expect(captureError).toHaveBeenCalled();
  });

  it('accepts unknown legacy fields without rejecting the record', () => {
    const patient = readPatient('p3', {
      name: 'Old Record',
      age: 20,
      gender: 'other',
      createdAt: 'x',
      referralNotes: 'written before the schema existed',
    });
    expect(patient.name).toBe('Old Record');
  });
});

describe('ageAsNumber', () => {
  it.each([
    [{ age: 12 }, 12],
    [{ age: '7' }, 7],
    [{ age: 'not a number' }, undefined],
    [{ age: 900 }, undefined],
  ])('normalizes %j to %i', (input, expected) => {
    expect(ageAsNumber(input as never)).toBe(expected);
  });
});

describe('readReport', () => {
  const valid = {
    patientId: 'p1',
    patientName: 'Asha Rao',
    resultData: { HB: 12.1 },
    signature: 'a'.repeat(64),
    status: 'final',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'uid-1',
  };

  it('parses a report and defaults the version', () => {
    const report = readReport('r1', valid);
    expect(report.id).toBe('r1');
    expect(report.version).toBe(1);
    expect(report.status).toBe('final');
  });

  it('accepts drafts', () => {
    const report = readReport('r2', { ...valid, status: 'draft', signature: '' });
    expect(report.status).toBe('draft');
  });

  it('never lets an unknown status silently become a final report', () => {
    // P0.3: an unrecognised status is the ambiguous case — the only safe reading
    // is "needs review", so it is forced to draft (not final) and flagged, while
    // the results/patient link survive so the record stays recoverable.
    const report = readReport('r3', { ...valid, status: 'published-by-mistake' });
    expect(report.status).toBe('draft');
    expect(report.needsReview).toBe(true);
    expect(report.patientId).toBe('p1');
    expect(report.patientName).toBe('Asha Rao');
    expect(report.resultData).toEqual({ HB: 12.1 });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('forces a missing status to a reviewable draft instead of final', () => {
    const { status: _dropped, ...noStatus } = valid;
    const report = readReport('r5', noStatus);
    expect(report.status).toBe('draft');
    expect(report.needsReview).toBe(true);
    expect(report.patientId).toBe('p1');
  });

  it('keeps a genuinely final report unflagged', () => {
    const report = readReport('r6', valid);
    expect(report.status).toBe('final');
    expect(report.needsReview).toBeUndefined();
  });

  it('does not throw on a completely empty document', () => {
    const report = readReport('r4', undefined);
    expect(() => report).not.toThrow();
    expect(report.status).toBe('draft');
    expect(report.needsReview).toBe(true);
  });
});

describe('toReportDoc', () => {
  const input = {
    patientId: 'p1',
    patientName: 'Asha Rao',
    resultData: { HB: '12.1' },
    signature: 'a'.repeat(64),
    status: 'final' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'uid-1',
  };

  it('records the audit fields every report needs', () => {
    const doc = toReportDoc(input);
    expect(doc.version).toBe(1);
    expect(doc.createdBy).toBe('uid-1');
  });

  it('omits optional fields that were not supplied', () => {
    const doc = toReportDoc(input);
    expect('testType' in doc).toBe(false);
    expect('updatedBy' in doc).toBe(false);
  });
});

describe('toReportUpdateDoc', () => {
  it('bumps the version and never rewrites authorship', () => {
    const doc = toReportUpdateDoc(
      {
        patientId: 'p1',
        patientName: 'Asha Rao',
        resultData: {},
        signature: 'b'.repeat(64),
        status: 'final',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'uid-1',
      },
      3,
    );
    expect(doc.version).toBe(4);
    expect('createdBy' in doc).toBe(false);
  });
});

describe('readInvoice', () => {
  it('coerces a string amount so legacy rows still total correctly', () => {
    const invoice = readInvoice('i1', {
      reportId: 'r1',
      patientId: 'p1',
      patientName: 'Asha Rao',
      amount: '250',
      status: 'paid',
      createdAt: 'x',
    });
    expect(invoice.amount).toBe(250);
  });

  it('defaults a missing status to the least-committal value', () => {
    const invoice = readInvoice('i2', {
      reportId: 'r1',
      patientId: 'p1',
      patientName: 'Asha Rao',
      amount: 100,
      createdAt: 'x',
    });
    expect(invoice.status).toBe('pending');
  });
});

describe('readUser', () => {
  it('treats a profile with no role as guest', () => {
    const user = readUser('u1', { name: 'Naitik', email: 'n@x.io', createdAt: 'x' });
    expect(user.role).toBe('guest');
  });

  it('refuses to accept an invented role', () => {
    const user = readUser('u2', {
      name: 'Mallory',
      email: 'm@x.io',
      role: 'superadmin',
      createdAt: 'x',
    });
    expect(user.role).toBe('guest');
    expect(captureError).toHaveBeenCalled();
  });
});
