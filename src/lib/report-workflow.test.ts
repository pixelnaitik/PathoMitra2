import { describe, it, expect } from 'vitest';
import {
  findMissingResults,
  isReportContentChanged,
  planReportWrite,
  type ReportContent,
  type StoredReport,
} from './report-workflow';

// A tiny catalogue stand-in: "CBC" is a panel whose members are Hb and WBC; any
// other name is its own leaf. The module is pure, so the expansion is injected.
const expandNames = (names: readonly string[]): string[] => {
  const out: string[] = [];
  for (const n of names) {
    if (n === 'CBC') out.push('Hb', 'WBC');
    else out.push(n);
  }
  return out;
};

const base = {
  patientId: 'p1',
  patientName: 'Asha Rao',
  signature: 'Dr Who',
  createdAt: '2026-10-14T00:00:00.000Z',
  createdBy: 'Dr Who',
};

function content(resultData: Record<string, unknown>, testSelection: string[]): ReportContent {
  return { ...base, resultData, testSelection };
}

function stored(overrides: Partial<StoredReport> = {}): StoredReport {
  return {
    id: 'r1',
    ...base,
    resultData: { Hb: '12', WBC: '7' },
    testSelection: ['CBC'],
    status: 'final',
    version: 1,
    ...overrides,
  };
}

describe('findMissingResults (P0.5)', () => {
  it('treats a blank string as missing, not as a completed result', () => {
    const missing = findMissingResults(content({ Hb: '', WBC: '7' }, ['CBC']), expandNames);
    expect(missing).toEqual(['Hb']);
  });

  it('expands an ordered panel to its members', () => {
    expect(findMissingResults(content({}, ['CBC']), expandNames).sort()).toEqual(['Hb', 'WBC']);
  });

  it('accepts zero and non-empty strings as recorded', () => {
    expect(findMissingResults(content({ Hb: 0, WBC: 'none' }, ['CBC']), expandNames)).toEqual([]);
  });
});

describe('planReportWrite — issuance gate (P0.5)', () => {
  it('rejects issuing a draft whose panel members are blank, listing them', () => {
    const plan = planReportWrite({
      existing: stored({ status: 'draft', resultData: { Hb: '', WBC: '' } }),
      next: { ...content({ Hb: '', WBC: '' }, ['CBC']), status: 'final' },
      operator: 'Dr Who',
      now: '2026-10-14T10:00:00.000Z',
      expandNames,
    });
    expect(plan.ok).toBe(false);
    expect(plan.missing?.sort()).toEqual(['Hb', 'WBC']);
    expect(plan.ops).toHaveLength(0);
  });

  it('lets an incomplete DRAFT be saved (only issuing is gated)', () => {
    const plan = planReportWrite({
      existing: stored({ status: 'draft', resultData: { Hb: '', WBC: '' } }),
      next: { ...content({ Hb: '', WBC: '' }, ['CBC']), status: 'draft' },
      operator: 'Dr Who',
      now: '2026-10-14T10:00:00.000Z',
      expandNames,
    });
    expect(plan.ok).toBe(true);
    expect(plan.ops[0].entity).toBe('reports');
  });

  it('allows issuing once every ordered test has a value', () => {
    const plan = planReportWrite({
      existing: stored({ status: 'draft', resultData: { Hb: '12', WBC: '7' } }),
      next: { ...content({ Hb: '12', WBC: '7' }, ['CBC']), status: 'final' },
      operator: 'Dr Who',
      now: '2026-10-14T10:00:00.000Z',
      expandNames,
    });
    expect(plan.ok).toBe(true);
    expect(plan.issuing).toBe(true);
  });
});

describe('planReportWrite — immutable issued report (P0.4)', () => {
  it('requires an amendment reason when editing an issued report', () => {
    const plan = planReportWrite({
      existing: stored(),
      next: { ...content({ Hb: '11', WBC: '7' }, ['CBC']), status: 'final' },
      reason: '   ',
      operator: 'Dr Who',
      now: '2026-10-14T10:00:00.000Z',
      expandNames,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/must state a reason/);
  });

  it('retains the prior version as reportVersions before bumping the report', () => {
    const plan = planReportWrite({
      existing: stored(),
      next: { ...content({ Hb: '11', WBC: '7' }, ['CBC']), status: 'final' },
      reason: 'Result transcription error',
      operator: 'Dr Who',
      now: '2026-10-14T10:00:00.000Z',
      expandNames,
    });
    expect(plan.ok).toBe(true);
    expect(plan.amended).toBe(true);
    // History is written FIRST so the only prior copy survives even on a
    // non-transactional store.
    expect(plan.ops[0].entity).toBe('reportVersions');
    expect(plan.ops[0].id).toBe('r1__v1');
    expect(plan.ops[0].value).toMatchObject({
      version: 1,
      supersededReason: 'Result transcription error',
    });
    expect('Hb' in plan.ops[0].value).toBe(false); // prior results live under resultData
    const prior = plan.ops[0].value.resultData as Record<string, unknown>;
    expect(prior.Hb).toBe('12'); // the value BEFORE the edit is preserved
    expect(plan.ops[1].entity).toBe('reports');
    expect(plan.ops[1].value.version).toBe(2);
    expect('createdBy' in plan.ops[1].value).toBe(false); // author immutable
  });

  it('refuses to revert an issued report to a draft', () => {
    const plan = planReportWrite({
      existing: stored(),
      next: { ...content({ Hb: '12', WBC: '7' }, ['CBC']), status: 'draft' },
      reason: 'undo it',
      operator: 'Dr Who',
      now: '2026-10-14T10:00:00.000Z',
      expandNames,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/cannot be turned back/);
  });

  it('treats an unchanged issued report as a no-op (no spurious version)', () => {
    const plan = planReportWrite({
      existing: stored(),
      next: { ...content({ Hb: '12', WBC: '7' }, ['CBC']), status: 'final' },
      reason: '',
      operator: 'Dr Who',
      now: '2026-10-14T10:00:00.000Z',
      expandNames,
    });
    expect(plan.ok).toBe(true);
    expect(plan.ops).toHaveLength(0);
    expect(plan.amended).toBe(false);
  });
});

describe('planReportWrite — new reports', () => {
  it('creates a complete new final report in one op', () => {
    const plan = planReportWrite({
      existing: null,
      newId: 'r-new',
      next: { ...content({ Hb: '12', WBC: '7' }, ['CBC']), status: 'final' },
      operator: 'Dr Who',
      now: '2026-10-14T10:00:00.000Z',
      expandNames,
    });
    expect(plan.ok).toBe(true);
    expect(plan.ops).toEqual([expect.objectContaining({ entity: 'reports', id: 'r-new' })]);
  });

  it('refuses to create an incomplete report as already issued', () => {
    const plan = planReportWrite({
      existing: null,
      newId: 'r-new',
      next: { ...content({ Hb: '' }, ['CBC']), status: 'final' },
      operator: 'Dr Who',
      now: '2026-10-14T10:00:00.000Z',
      expandNames,
    });
    expect(plan.ok).toBe(false);
    expect(plan.missing).toContain('WBC');
  });

  it('needs an id when there is no existing report', () => {
    const plan = planReportWrite({
      existing: null,
      next: { ...content({ Hb: '12', WBC: '7' }, ['CBC']), status: 'draft' },
      operator: 'Dr Who',
      now: '2026-10-14T10:00:00.000Z',
      expandNames,
    });
    expect(plan.ok).toBe(false);
  });
});

describe('isReportContentChanged', () => {
  it('flags a changed result value', () => {
    expect(isReportContentChanged(stored(), content({ Hb: '99', WBC: '7' }, ['CBC']))).toBe(true);
  });
  it('ignores a metadata-only difference on the same values', () => {
    expect(
      isReportContentChanged(
        stored({ signature: 'someone else' }),
        content({ Hb: '12', WBC: '7' }, ['CBC']),
      ),
    ).toBe(false);
  });
});
