/**
 * Terms of use / acceptable-use content for PathoMitra.
 *
 * Separate from `lib/privacy-policy.ts` because they answer different questions
 * and are accepted separately: the policy describes what happens to data, the
 * terms are the operator's undertakings. Google Play requires a reachable privacy
 * policy for an app handling health data; it does not require terms, but an
 * app that prints clinical documents and lets one person assert an accreditation
 * in its own name needs the acceptable-use record.
 *
 * Acceptance is stored on the account (`lib/local-account.ts`) with the version
 * number that was accepted. Bump `TERMS_VERSION` whenever a clause changes and
 * the unlock screen re-prompts once — a silent terms change is not an accepted
 * one.
 */
import { PRIVACY_CONTACT_EMAIL, PRIVACY_POLICY_URL } from './privacy-policy';

export const TERMS_VERSION = '1.0';
export const TERMS_LAST_UPDATED = '10 October 2026';

export interface TermsSection {
  heading: string;
  body: string[];
}

export const TERMS_SECTIONS: TermsSection[] = [
  {
    heading: '1. Who may use this software',
    body: [
      'PathoMitra is a laboratory information console for professionals operating a pathology laboratory, and for staff authorised by that laboratory. It is not for self-diagnosis, is not a patient-facing app, and is not a substitute for a qualified clinician\u2019s judgement.',
      'You confirm you are lawfully permitted to operate this laboratory and to process the patient information you enter, including under India\u2019s Digital Personal Data Protection Act, 2023 and any clinical-establishment or laboratory-licensing rules that apply to you.',
    ],
  },
  {
    heading: '2. Patient data is your responsibility',
    body: [
      'You are the data controller — the Data Fiduciary — for every record you enter. You are responsible for obtaining patient consent, for notice, retention limits, breach reporting and for appointing a grievance officer where the law requires one.',
      'The software does not collect, receive, transmit or back up any of that data. It has no network permission. Nothing in these terms transfers any of those duties to the developer.',
    ],
  },
  {
    heading: '3. Claims made on your reports',
    body: [
      'Any accreditation, certification, licence number or registration printed on a report comes from what you entered in Settings \u2192 Lab Organization, and only prints after you tick the statement that the laboratory personally holds it.',
      'You must not enter an accreditation you do not hold. PathoMitra asserts none of its own and is not HIPAA-compliant, NABL-accredited, ISO-certified, CE-marked or SOC 2 audited. Issuing a document that carries a false accreditation mark may be a criminal offence in your jurisdiction, and puts patients and referring doctors at risk.',
    ],
  },
  {
    heading: '4. Not a diagnostic device',
    body: [
      'PathoMitra formats, stores and prints results entered by a human. It performs arithmetic on entered values for derived indices only. It does not interpret images, does not analyse specimens, does not generate findings and does not offer clinical advice.',
      'Report content must be verified by qualified staff before issue. A report is a record of what your laboratory entered at the time it was issued.',
    ],
  },
  {
    heading: '5. Security you must maintain',
    body: [
      'Choose a passcode appropriate to the sensitivity of your records and keep the device screen lock enabled. Do not disable the automatic lock except where your workflow genuinely requires it. Do not use this software on a rooted or jailbroken device, or one shared with unrelated users.',
      'Backups are plaintext JSON by design so that you can always recover your laboratory. Keep them somewhere you control. Exporting to shared storage, printing, and handing files to other apps are all your decisions and your risk.',
    ],
  },
  {
    heading: '6. Amendments, records and no warranty',
    body: [
      'A finalised report can be amended. The app raises its version number and records your stated reason; it does not, and cannot, prove that a document was never altered, because there is no external signing service. Never treat the absence of a version bump as evidence of integrity.',
      'The software is provided as-is, without warranty. The developer is not liable for clinical decisions made from your records, for data lost through device failure, loss or theft, or for regulatory consequences of the content you enter. Maintain your own off-device backups.',
    ],
  },
  {
    heading: '7. No prohibited uses',
    body: [
      'Do not use PathoMitra to fabricate, falsify or backdate laboratory results, to issue reports for specimens that were not analysed, or to misrepresent the identity or qualification of a signer.',
    ],
  },
  {
    heading: '8. Contact',
    body: [
      `Questions about these terms: ${PRIVACY_CONTACT_EMAIL}. See the privacy policy at ${PRIVACY_POLICY_URL}.`,
    ],
  },
];

/** The single undertaking that must be affirmatively ticked — never pre-checked. */
export const ONBOARDING_ATTESTATION =
  'I confirm I am authorised to operate this laboratory and to process the patient information I enter, that I am responsible for every accreditation and result printed on my reports, and that I have read the Terms and the Privacy Policy.';
