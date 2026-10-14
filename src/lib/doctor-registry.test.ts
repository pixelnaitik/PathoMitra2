import { describe, expect, it } from 'vitest';

import {
  dedupeDoctorNames,
  doctorMatchesQuery,
  doctorNameKey,
  groupByDoctorName,
  normaliseDoctorName,
} from './doctor-registry';

/**
 * The referral register is free text, so these tests are all about the same
 * person arriving under three spellings — which is what splits one doctor across
 * three bars of the Top Referring Doctors chart and shows them three times in the
 * registration dropdown.
 */
describe('doctorNameKey', () => {
  it('folds title punctuation and case, but keeps a qualification distinct', () => {
    const a = doctorNameKey('DR MANOJ KUMAR');
    expect(doctorNameKey('DR.MANOJ KUMAR')).toBe(a);
    expect(doctorNameKey('  dr   manoj   kumar  ')).toBe(a);
    // "(MBBS)" survives as a word on purpose: two practitioners can share a name
    // in this register, and merging their histories is worse than listing one
    // doctor under two spellings.
    expect(doctorNameKey('Dr. Manoj Kumar (MBBS)')).toBe('DR MANOJ KUMAR MBBS');
  });

  it('folds the bracketed-suffix style this lab actually uses', () => {
    expect(doctorNameKey('DR GAUTAM KUMAR MS{EYE}')).toBe(
      doctorNameKey('DR Gautam Kumar MS [Eye]'),
    );
  });

  it('keeps two different doctors apart', () => {
    expect(doctorNameKey('DR ARVIND KUMAR')).not.toBe(doctorNameKey('ARBIND KUMAR'));
    expect(doctorNameKey('DR P K SINGH')).not.toBe(doctorNameKey('DR B K SINGH'));
  });

  it('does not invent a key for an empty name', () => {
    expect(doctorNameKey(undefined)).toBe('');
    expect(doctorNameKey('   .,  ')).toBe('');
  });
});

describe('groupByDoctorName', () => {
  const reports = [
    { id: 'r1', doctor: 'DR MANOJ KUMAR' },
    { id: 'r2', doctor: 'DR.MANOJ KUMAR' },
    { id: 'r3', doctor: 'Dr. Manoj Kumar (MBBS)' },
    { id: 'r4', doctor: 'DR ARVIND KUMAR' },
    { id: 'r5', doctor: '' },
    { id: 'r6' },
  ] as { id: string; doctor?: string }[];

  it('collapses the spellings of one doctor into one group', () => {
    const groups = groupByDoctorName(reports, r => r.doctor);
    const manoj = groups.find(g => doctorNameKey(g.name) === doctorNameKey('DR MANOJ KUMAR'));
    expect(manoj?.members).toHaveLength(2);
    // Three distinct keys: the bare name, and the MBBS-suffixed spelling of it.
    expect(groups).toHaveLength(3);
  });

  it('drops records with no referral rather than grouping them as a doctor', () => {
    const groups = groupByDoctorName(reports, r => r.doctor);
    expect(groups.some(g => g.name === '')).toBe(false);
    expect(groups.reduce((n, g) => n + g.members.length, 0)).toBe(4);
  });

  it('shows the spelling the lab used most often', () => {
    const groups = groupByDoctorName(
      [{ name: 'DR MANOJ KUMAR' }, { name: 'DR MANOJ KUMAR' }, { name: 'DR.MANOJ KUMAR' }],
      r => r.name,
    );
    expect(groups[0]?.name).toBe('DR MANOJ KUMAR');
    expect(groups).toHaveLength(1);
  });
});

describe('dedupeDoctorNames', () => {
  it('keeps the first spelling and drops the later variants', () => {
    expect(
      dedupeDoctorNames(['DR ARVIND KUMAR', 'DR. ARVIND KUMAR', 'ARBIND KUMAR', '', '  ']),
    ).toEqual(['DR ARVIND KUMAR', 'ARBIND KUMAR']);
  });
});

describe('doctorMatchesQuery', () => {
  const name = 'DR SHAILENDRA KUMAR MS';

  it('matches words in any position and in any case', () => {
    expect(doctorMatchesQuery(name, 'shailendra ms')).toBe(true);
    expect(doctorMatchesQuery(name, 'KUMAR')).toBe(true);
    expect(doctorMatchesQuery(name, 'dr ms kumar')).toBe(true);
  });

  it('ignores the punctuation someone types', () => {
    expect(doctorMatchesQuery('DR.M.K SINGH', 'dr m k singh')).toBe(true);
  });

  it('shows everything when nothing has been typed', () => {
    expect(doctorMatchesQuery(name, '   ')).toBe(true);
  });

  it('does not match a different doctor', () => {
    expect(doctorMatchesQuery(name, 'shailendra verma')).toBe(false);
  });
});

describe('normaliseDoctorName', () => {
  it('collapses repeated spaces', () => {
    expect(normaliseDoctorName('DR   MANOJ   KUMAR')).toBe('DR MANOJ KUMAR');
  });

  it('leaves an all-caps register entry shouting, and title-cases a lowercase one', () => {
    expect(normaliseDoctorName('DR MANOJ KUMAR')).toBe('DR MANOJ KUMAR');
    expect(normaliseDoctorName('dr manoj kumar')).toBe('Dr Manoj Kumar');
  });
});
