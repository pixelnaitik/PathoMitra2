import { describe, it, expect } from 'vitest';
import { recalculateCBC } from './report-calculations';

describe('recalculateCBC', () => {
  it('derives absolute counts from WBC and differentials', () => {
    const out = recalculateCBC(
      {
        'WHITE CELL COUNT(TC)': '8.0',
        NEUTROPHIL: '60',
        LYMPHOCYTE: '30',
        MONOCYTE: '5',
        EOSINOPHIL: '4',
        BASOPHIL: '1',
      },
      'NEUTROPHIL',
      '50',
    );
    expect(out['ABSOLUTE NEUTROPHIL COUNT']).toBe('4.00');
    expect(out['ABSOLUTE LYMPHOCYTE COUNT']).toBe('2.40');
    expect(out['ABSOLUTE MONOCYTE COUNT']).toBe('0.40');
    // The eosinophil output uses the catalogue's spelling (input EOSINOPHIL →
    // output ABSOLUTE EOSINOPHILL COUNT) so it matches the listed test name.
    expect(out['ABSOLUTE EOSINOPHILL COUNT']).toBe('0.32');
  });

  it('derives red-cell indices (MCV, MCH, MCHC)', () => {
    const out = recalculateCBC(
      {
        'RBC (RED BLOOD CELLS)': '5.0',
        'HB (HAEMOGLOBIN)': '15',
        'HCT(PCV)': '45',
      },
      'HCT(PCV)',
      '40',
    );
    expect(out['MCV']).toBe('80.0');
    expect(out['MCH']).toBe('30.0');
    expect(out['MCHC']).toBe('37.5');
  });

  it('leaves unrelated values untouched', () => {
    const out = recalculateCBC({ PLATELET: '250' }, 'PLATELET', '260');
    expect(out).toEqual({ PLATELET: '260' });
  });

  it('does not derive indices from invalid numbers', () => {
    const out = recalculateCBC({ 'RBC (RED BLOOD CELLS)': 'abc' }, 'HB (HAEMOGLOBIN)', '15');
    expect(out['MCV']).toBeUndefined();
    expect(out['MCH']).toBeUndefined();
  });

  // --- P0.2 hardening ---------------------------------------------------------

  it('rejects a value with trailing junk instead of reading the numeric prefix', () => {
    // parseFloat('60abc') = 60; that silently derived a clinical count from text
    // the operator never entered.
    const out = recalculateCBC({ 'WHITE CELL COUNT(TC)': '8' }, 'NEUTROPHIL', '60abc');
    expect(out['ABSOLUTE NEUTROPHIL COUNT']).toBeUndefined();
  });

  it('clears a stale absolute count when its source is blanked', () => {
    const seeded = {
      'WHITE CELL COUNT(TC)': '8',
      NEUTROPHIL: '50',
      'ABSOLUTE NEUTROPHIL COUNT': '4.00', // an earlier derived value
    };
    const out = recalculateCBC(seeded, 'NEUTROPHIL', '');
    expect(out['ABSOLUTE NEUTROPHIL COUNT']).toBeUndefined();
  });

  it('clears every stale absolute count when the total WBC is removed', () => {
    const seeded = {
      'WHITE CELL COUNT(TC)': '8',
      NEUTROPHIL: '50',
      LYMPHOCYTE: '30',
      'ABSOLUTE NEUTROPHIL COUNT': '4.00',
      'ABSOLUTE LYMPHOCYTE COUNT': '2.40',
    };
    const out = recalculateCBC(seeded, 'WHITE CELL COUNT(TC)', '');
    expect(out['ABSOLUTE NEUTROPHIL COUNT']).toBeUndefined();
    expect(out['ABSOLUTE LYMPHOCYTE COUNT']).toBeUndefined();
  });

  it('rejects a nonsensical differential (out of 0–100 range)', () => {
    const high = recalculateCBC({ 'WHITE CELL COUNT(TC)': '8' }, 'NEUTROPHIL', '140');
    expect(high['ABSOLUTE NEUTROPHIL COUNT']).toBeUndefined();
    const negative = recalculateCBC({ 'WHITE CELL COUNT(TC)': '8' }, 'LYMPHOCYTE', '-5');
    expect(negative['ABSOLUTE LYMPHOCYTE COUNT']).toBeUndefined();
  });

  it('treats whitespace-only as blank, and accepts surrounding spaces on numbers', () => {
    const blank = recalculateCBC({ 'WHITE CELL COUNT(TC)': '   ' }, 'MONOCYTE', '5');
    expect(blank['ABSOLUTE MONOCYTE COUNT']).toBeUndefined();
    const spaced = recalculateCBC({ 'WHITE CELL COUNT(TC)': ' 8 ' }, 'MONOCYTE', ' 5 ');
    expect(spaced['ABSOLUTE MONOCYTE COUNT']).toBe('0.40');
  });

  it('refuses a zero total WBC (nothing is derived, stale counts cleared)', () => {
    const out = recalculateCBC(
      { NEUTROPHIL: '50', 'ABSOLUTE NEUTROPHIL COUNT': '9.00' },
      'WHITE CELL COUNT(TC)',
      '0',
    );
    expect(out['ABSOLUTE NEUTROPHIL COUNT']).toBeUndefined();
  });

  it('clears only the indices whose own source went invalid', () => {
    const seeded = {
      'RBC (RED BLOOD CELLS)': '5.0',
      'HB (HAEMOGLOBIN)': '15',
      'HCT(PCV)': '40',
      MCV: '80.0',
      MCH: '30.0',
      MCHC: '37.5',
    };
    // Blank the HCT: MCV and MCHC depend on it, MCH (Hb/RBC) does not.
    const out = recalculateCBC(seeded, 'HCT(PCV)', '');
    expect(out['MCV']).toBeUndefined();
    expect(out['MCHC']).toBeUndefined();
    expect(out['MCH']).toBe('30.0');
  });

  it('refuses a zero HCT denominator for MCHC but still allows the zero-value MCV', () => {
    const out = recalculateCBC(
      { 'RBC (RED BLOOD CELLS)': '5.0', 'HB (HAEMOGLOBIN)': '15' },
      'HCT(PCV)',
      '0',
    );
    expect(out['MCV']).toBe('0.0'); // 0 * 10 / 5 — a valid zero, not a divide-by-zero
    expect(out['MCHC']).toBeUndefined(); // hb * 100 / 0 refused
  });

  it('rejects a negative haemoglobin rather than deriving a negative index', () => {
    const out = recalculateCBC(
      { 'RBC (RED BLOOD CELLS)': '5.0', 'HCT(PCV)': '40' },
      'HB (HAEMOGLOBIN)',
      '-2',
    );
    expect(out['MCH']).toBeUndefined();
    expect(out['MCHC']).toBeUndefined();
  });
});
