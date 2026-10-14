import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The store is faked here: registration numbers and the duplicate guard are the
 * parts worth pinning, and both decide what identity a clinical record gets.
 */
const store = vi.hoisted(() => ({
  /** id → document, or undefined when the id is free. */
  documents: new Map<string, Record<string, unknown> | undefined>(),
  writes: [] as { path: string; id: string; data: Record<string, unknown> }[],
}));

vi.mock('../data/fs', () => ({
  db: {},
  doc: (_db: unknown, path: string, id: string) => ({ path, id }),
  getDoc: async (ref: { path: string; id: string }) => {
    const found = store.documents.get(`${ref.path}/${ref.id}`);
    return { exists: () => found !== undefined, data: () => found ?? {} };
  },
  setDoc: async (ref: { path: string; id: string }, data: Record<string, unknown>) => {
    store.documents.set(`${ref.path}/${ref.id}`, data);
    store.writes.push({ path: ref.path, id: ref.id, data });
  },
}));

import {
  allocatePatientId,
  findProbableDuplicates,
  normalisePhone,
  patientMonthKey,
  patientNameKey,
  validatePatientForm,
} from './patient-registry';

const NOW = new Date('2026-10-13T09:00:00.000Z');

beforeEach(() => {
  store.documents.clear();
  store.writes.length = 0;
});

describe('validatePatientForm', () => {
  const base = { name: 'Asha Rao', age: '34', phone: '', address: '' };

  it('requires a name and an age', () => {
    expect(validatePatientForm({ ...base, name: '   ' })).toMatch(/Full Name is required/);
    expect(validatePatientForm({ ...base, age: '' })).toMatch(/Age is required/);
  });

  it('refuses a non-integer or out-of-range age instead of clamping it silently', () => {
    expect(validatePatientForm({ ...base, age: 'abc' })).toMatch(/whole number/);
    expect(validatePatientForm({ ...base, age: '-5' })).toMatch(/whole number/);
    expect(validatePatientForm({ ...base, age: '250' })).toMatch(/between 0 and 150/);
    expect(validatePatientForm(base)).toBeNull();
  });

  it('accepts a phone with separators and rejects letters', () => {
    expect(validatePatientForm({ ...base, phone: '+91 98765 43210' })).toBeNull();
    expect(validatePatientForm({ ...base, phone: 'call me later' })).toMatch(/digits/);
  });

  it('caps the address like the schema does', () => {
    expect(validatePatientForm({ ...base, address: 'x'.repeat(501) })).toMatch(/500 characters/);
  });
});

describe('normalisePhone and patientNameKey', () => {
  it('compares digits only', () => {
    expect(normalisePhone('+91 98765-4321')).toBe('91987654321');
    expect(normalisePhone(undefined)).toBe('');
  });

  it('folds case, punctuation and repeated spaces in a name', () => {
    expect(patientNameKey('  ASHA   RAO ')).toBe('asha rao');
    expect(patientNameKey('Asha Rao.')).toBe('asha rao');
  });
});

describe('findProbableDuplicates', () => {
  const records = [
    { id: '26100001', name: 'Asha Rao', age: 34, phone: '+91 98765 43210' },
    { id: '26100002', name: 'Asha Rao', age: 34 },
    { id: '26100003', name: 'Vikram Rao', age: 8, phone: '9811111111' },
  ];

  it('flags an identical phone regardless of formatting', () => {
    const matches = findProbableDuplicates(
      { name: 'Asha R', age: '34', phone: '9876543210' },
      records,
    );
    expect(matches.map(m => m.id)).toEqual(['26100001']);
    expect(matches[0]?.reason).toContain('same phone number');
  });

  it('flags the same name and age even with no phone on either side', () => {
    const matches = findProbableDuplicates({ name: 'asha rao', age: '34', phone: '' }, records);
    expect(matches.map(m => m.id).sort()).toEqual(['26100001', '26100002']);
  });

  it('does not interrupt a registration for a different person', () => {
    expect(findProbableDuplicates({ name: 'Vikram Rao', age: '40', phone: '' }, records)).toEqual(
      [],
    );
  });

  it('never flags the record being edited as its own duplicate', () => {
    const matches = findProbableDuplicates(
      { name: 'Asha Rao', age: '34', phone: '9876543210' },
      records,
      '26100001',
    );
    expect(matches.map(m => m.id)).not.toContain('26100001');
  });
});

describe('allocatePatientId', () => {
  it('starts each month at 0001 and keeps the prefix readable', async () => {
    const id = await allocatePatientId(NOW);
    expect(id).toBe(`${patientMonthKey(NOW)}0001`);
    expect(
      store.writes.some(w => w.path === 'meta' && w.id === `patient-id-${patientMonthKey(NOW)}`),
    ).toBe(true);
  });

  it('continues from the stored counter rather than probing at random', async () => {
    const month = patientMonthKey(NOW);
    store.documents.set(`meta/patient-id-${month}`, { value: 41, allocatedAt: NOW.toISOString() });

    expect(await allocatePatientId(NOW)).toBe(`${month}0042`);
  });

  it('walks past an id that is already taken', async () => {
    const month = patientMonthKey(NOW);
    store.documents.set(`patients/${month}0001`, { name: 'Someone Else' });

    expect(await allocatePatientId(NOW)).toBe(`${month}0002`);
  });

  it('does not report success when it cannot find a number', async () => {
    const month = patientMonthKey(NOW);
    for (let n = 1; n <= 200; n++) {
      store.documents.set(`patients/${month}${String(n).padStart(4, '0')}`, { name: 'Taken' });
    }
    await expect(allocatePatientId(NOW)).rejects.toThrow(/could not be advanced/);
  });
});
