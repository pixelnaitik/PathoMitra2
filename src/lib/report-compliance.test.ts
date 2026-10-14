import { describe, it, expect } from 'vitest';
import {
  buildReportLegalLines,
  legalLinesForPrint,
  hasAttestedAccreditation,
  formatIssuedStamp,
  FORBIDDEN_CLAIMS,
  NEUTRAL_TAGLINE,
  PROFESSIONAL_USE_DISCLAIMER,
  type ReportLegalInput,
} from './report-compliance';

/**
 * Guards the Phase 1 fix. Before this, four renderers each hardcoded their own
 * credential claims and the canvas asserted "NABL ACCREDITED LAB •
 * ISO 9001:2015 CERTIFIED REPORT" over an empty `signature` column. If any of
 * those strings comes back — by copy-paste, by a template edit, or by loosening
 * the attestation gate — these tests fail.
 */

const ATTESTED: ReportLegalInput = {
  accreditationBody: 'NABL',
  accreditationNumber: 'MC-2231',
  accreditationAttestedAt: '2026-10-01T09:00:00.000Z',
  licenceNumber: 'DL-9942',
  signerName: 'Dr. A. Kulkarni',
  signedAt: '2026-10-05T04:31:00.000Z',
};

describe('report legal lines — nothing prints without attestation', () => {
  it('falls back to neutral wording when the operator has set nothing', () => {
    const legal = buildReportLegalLines();
    expect(legal.tagline).toBe(NEUTRAL_TAGLINE);
    expect(legal.accreditation).toBe('');
    expect(legal.licence).toBe('');
  });

  it('ignores an accreditation entered without the attestation tick', () => {
    const legal = buildReportLegalLines({
      accreditationBody: 'NABL',
      accreditationNumber: 'MC-2231',
      accreditationAttestedAt: '',
    });
    expect(legal.accreditation).toBe('');
    expect(legal.tagline).toBe(NEUTRAL_TAGLINE);
    expect(
      legalLinesForPrint({ accreditationBody: 'NABL', accreditationNumber: 'X' }),
    ).not.toContain('NABL · Accreditation no. X');
  });

  it('ignores a half-filled credential even when attested', () => {
    expect(
      hasAttestedAccreditation({
        accreditationBody: 'NABL',
        accreditationNumber: '',
        accreditationAttestedAt: '2026-10-01T09:00:00.000Z',
      }),
    ).toBe(false);
    expect(
      hasAttestedAccreditation({
        accreditationBody: '',
        accreditationNumber: '123',
        accreditationAttestedAt: '2026-10-01T09:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('prints the operator-supplied credential once attested', () => {
    const legal = buildReportLegalLines(ATTESTED);
    expect(legal.accreditation).toBe('NABL · Accreditation no. MC-2231');
    expect(legal.tagline).toBe('NABL');
    expect(legal.licence).toBe('Registration no. DL-9942');
  });
});

describe('report legal lines — signer sentence and disclaimer are off reports', () => {
  // Owner decision 2026-10-12: both footers were removed from printed output.
  // These tests exist so the lines cannot creep back via a renderer edit.
  it('prints no signer / verification sentence even when a signer is known', () => {
    const legal = buildReportLegalLines(ATTESTED);
    expect(legal.signer).toBe('');
    const printed = legalLinesForPrint(ATTESTED).join(' ');
    expect(printed).not.toContain('Electronically signed');
    expect(printed).not.toContain('No external verification service');
    expect(printed).not.toContain('Dr. A. Kulkarni');
  });

  it('prints no professional-use disclaimer', () => {
    expect(buildReportLegalLines().disclaimer).toBe('');
    expect(legalLinesForPrint().join(' ')).not.toContain(PROFESSIONAL_USE_DISCLAIMER);
    expect(legalLinesForPrint().join(' ')).not.toContain('clinical judgement');
  });

  it('tolerates a malformed timestamp instead of printing Invalid Date', () => {
    expect(formatIssuedStamp('not-a-date')).toBe('not-a-date');
    expect(formatIssuedStamp('')).toBe('');
    expect(formatIssuedStamp(undefined)).toBe('');
    expect(legalLinesForPrint({ signedAt: 'garbage', signerName: 'X' }).join(' ')).not.toContain(
      'Invalid Date',
    );
  });
});

describe('report legal lines — banned claims stay banned', () => {
  // FORBIDDEN_CLAIMS is about what the *app* is allowed to assert on its own, so
  // these inputs carry no operator-supplied credential text: an accredited lab
  // typing its own real body name is legitimate data, not an app-authored claim.
  const inputs: ReportLegalInput[] = [
    {},
    { signerName: 'Dr. X', signedAt: '2026-10-05T04:31:00.000Z' },
    { licenceNumber: 'DL-1' },
    { licenceNumber: 'DL-1', signerName: 'Y', signedAt: '2026-10-05T04:31:00.000Z' },
  ];

  for (const [index, input] of inputs.entries()) {
    it(`output set ${index} contains no unverifiable authority claim`, () => {
      const printed = legalLinesForPrint(input).join(' ');
      for (const claim of FORBIDDEN_CLAIMS) {
        expect(printed, `unexpected claim: ${claim}`).not.toContain(claim);
      }
    });
  }

  it('never lets the app itself be the named issuer', () => {
    for (const input of inputs) {
      // Matched on the product name rather than a sample string, so the guard
      // survives a rebrand: the issuer line belongs to the laboratory, never to
      // the software that printed it.
      expect(legalLinesForPrint(input).join(' ')).not.toMatch(/pathomitra/i);
    }
  });

  it('never prints a credential body the operator has not attested', () => {
    const unattested: ReportLegalInput = {
      accreditationBody: 'NABL',
      accreditationNumber: 'MC-1',
      accreditationAttestedAt: '',
    };
    expect(legalLinesForPrint(unattested).join(' ')).not.toContain('NABL');
  });
});
