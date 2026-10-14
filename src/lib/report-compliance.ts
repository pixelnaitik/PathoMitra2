/**
 * The only place the wording on an issued report is decided.
 *
 * Why this exists: four separate renderers used to state their own version of
 * the laboratory's credentials — the live A4 preview (`ReportPreview.tsx`), the
 * PDF the lab actually hands over (`ReportsPage.tsx`), the sample PDF
 * (`report-sample-pdf.ts`) and the canvas background baked into share templates
 * (`default-template.ts`). Three of them hardcoded "Certified Diagnostic
 * Pathology Laboratory" and the canvas asserted "NABL ACCREDITED LAB •
 * ISO 9001:2015 CERTIFIED REPORT" plus "This document is electronically
 * verified" — none of which the app can substantiate. There is no signing
 * service, no verification endpoint and no registry check, and the `signature`
 * column is written empty (`ReportsPage.tsx`, `models.ts`).
 *
 * A pathology report is a clinical document. Asserting an accreditation the
 * operator does not hold, or an electronic verification that does not happen,
 * is a misrepresentation to the patient and the referring doctor — and, for a
 * Google Play submission, an Impersonation and Deceptive-Behaviour violation.
 *
 * So: every claim-bearing string is derived here from operator-supplied,
 * attested data, and renders nothing when that data is absent. Neutral,
 * factual wording is the floor.
 */

/** Factual descriptor used when the lab has supplied no accreditation. */
export const NEUTRAL_TAGLINE = 'Diagnostic Pathology Report';

/**
 * Kept as the single source of truth for wording that COULD print; the owner
 * took both the signer sentence and this disclaimer off printed reports on
 * 2026-10-12 ("remove this part … from the report"), so `buildReportLegalLines`
 * returns them empty and every renderer's `.filter(Boolean)` drops the line.
 * The constants remain so a future reinstatement changes one place, not four.
 */
export const PROFESSIONAL_USE_DISCLAIMER =
  'For use by qualified healthcare professionals. Not a substitute for clinical judgement.';

/**
 * What the offline build can honestly say about how the report was issued.
 * Deliberately avoids "verified", "sealed", "tamper-evident" and "certified":
 * the report is stored on-device and carries no signature a third party could
 * check, so the sentence describes the act of issuing, not an assurance.
 */
export const SIGNER_SUFFIX =
  "from the operator's device. No external verification service is available.";

export interface ReportLegalInput {
  /** Values from `LabSettings`. All optional — absent means nothing is printed. */
  accreditationBody?: string;
  accreditationNumber?: string;
  licenceNumber?: string;
  /** Timestamp of the operator's attestation; empty/absent disables the claim. */
  accreditationAttestedAt?: string;
  /** Display name of the authenticated local account that issued the report. */
  signerName?: string;
  /** ISO issue timestamp from the report record. */
  signedAt?: string;
}

export interface ReportLegalLines {
  /** Descriptor printed under the lab name in the masthead. */
  tagline: string;
  /** Accreditation claim, or '' when not attested. */
  accreditation: string;
  /** Statutory lab registration/licence number, or ''. */
  licence: string;
  /** Issuance/signer statement — empty since 2026-10-12: no longer printed. */
  signer: string;
  /** Professional-use disclaimer — empty since 2026-10-12: no longer printed. */
  disclaimer: string;
}

const clean = (value: string | undefined): string => (value ?? '').trim();

/**
 * True only when the operator has actually attested to holding the credential
 * AND supplied both the body and its number. An unchecked half-filled record
 * must not put a certification mark on a patient document.
 */
export function hasAttestedAccreditation(input: ReportLegalInput): boolean {
  return Boolean(
    clean(input.accreditationAttestedAt) &&
    clean(input.accreditationBody) &&
    clean(input.accreditationNumber),
  );
}

/** Render an ISO timestamp without ever throwing or printing "Invalid Date". */
export function formatIssuedStamp(iso: string | undefined): string {
  const raw = clean(iso);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The name that may be printed as the issuing operator.
 *
 * `signature` holds it on every report written since that column was repurposed.
 * Older documents — restored backups, records from before the change — carry
 * nothing, and the honest answer then is *nobody*, not "whoever is looking at it".
 * Both the PDF pipeline and the on-screen viewer used to fall back to the viewing
 * operator's own name, which is a fresh misattribution: it puts a colleague's
 * report under the name of the person standing at the keyboard.
 */
export function resolveSigner(issue: { signature?: string; createdBy?: string }): string {
  const signer = clean(issue.signature);
  if (signer) return signer.slice(0, 128);
  // `createdBy` is written with the issuing operator's name (see `operatorStamp`
  // in lib/models.ts) — the same person this line is meant to name.
  const author = clean(issue.createdBy);
  return author === 'unknown' ? '' : author.slice(0, 128);
}

/** Build every claim-bearing line on the report from one input. */
export function buildReportLegalLines(input: ReportLegalInput = {}): ReportLegalLines {
  const attested = hasAttestedAccreditation(input);

  return {
    // A claimed accreditation replaces the neutral descriptor; it never stacks
    // on top of it, so an accredited report still reads as one line.
    tagline: attested ? clean(input.accreditationBody) : NEUTRAL_TAGLINE,
    accreditation: attested
      ? `${clean(input.accreditationBody)} · Accreditation no. ${clean(input.accreditationNumber)}`
      : '',
    licence: clean(input.licenceNumber) ? `Registration no. ${clean(input.licenceNumber)}` : '',
    // Owner decision 2026-10-12: the "Electronically signed by … No external
    // verification service is available." sentence and the professional-use
    // disclaimer were taking space at the foot of every report and the lab
    // asked for them off. The stamp/signer plumbing stays (the viewer header
    // still shows when a report was issued); these two print lines are dead.
    signer: '',
    disclaimer: '',
  };
}

/**
 * The masthead line, then any attested credential lines, in print order.
 * Callers that only have room for one line use `lines[0]`.
 */
export function legalLinesForPrint(input: ReportLegalInput = {}): string[] {
  const { tagline, accreditation, licence } = buildReportLegalLines(input);
  return [
    tagline,
    ...(accreditation && accreditation !== tagline ? [accreditation] : []),
    licence,
  ].filter(Boolean);
}

/**
 * Strings that must never reappear in the product. Kept here so a test can
 * assert against the same list the auditors read, rather than a copy that can
 * drift out of date.
 */
export const FORBIDDEN_CLAIMS = [
  'NABL',
  'ISO 9001',
  'Certified Diagnostic Pathology Laboratory',
  'electronically verified',
  'No physical signature required',
  'Tamper-proof',
  'tamper-evident',
  'SHA-256 sealed',
  'Report verified',
  'HIPAA Compliant',
] as const;
