import { describe, it, expect } from 'vitest';
import { ISSUE_REPORT_LABEL, reportStatusView, resolveReportViewStatus } from './report-status';

describe('report-status view model (UI-P0-01)', () => {
  it('maps the stored enum to the three-way view model', () => {
    expect(resolveReportViewStatus({ status: 'draft', version: 1 })).toBe('draft');
    expect(resolveReportViewStatus({ status: 'final', version: 1 })).toBe('issued');
    expect(resolveReportViewStatus({ status: 'final', version: 2 })).toBe('amended');
    // Version 10 is still >1; the string form read from Firestore documents works too.
    expect(resolveReportViewStatus({ status: 'final', version: '10' })).toBe('amended');
  });

  it('treats unknown status values as draft (fail-closed for clinical display)', () => {
    // The schema only allows 'draft' | 'final'; missing or unknown values may
    // come from legacy backups or malformed records. Fail closed instead of
    // presenting them as safe to distribute.
    expect(resolveReportViewStatus({ status: 'pending', version: 1 })).toBe('draft');
    expect(resolveReportViewStatus({ status: null, version: 1 })).toBe('draft');
    expect(resolveReportViewStatus({ status: undefined, version: 1 })).toBe('draft');
  });

  it('gives each status a distinct label, tone, description, and icon (not colour-only)', () => {
    const draft = reportStatusView({ status: 'draft', version: 1 });
    const issued = reportStatusView({ status: 'final', version: 1 });
    const amended = reportStatusView({ status: 'final', version: 3 });

    // Distinct labels — a reviewer with any colour-vision deficiency can still read the state.
    expect(
      new Set([draft.label, issued.label, amended.label].map(v => v.toLowerCase())),
    ).toHaveProperty('size', 3);
    expect(draft.label).toBe('Draft');
    expect(issued.label).toBe('Issued');
    expect(amended.label).toBe('Amended');

    // Distinct tones AND distinct icons — never rely on colour alone.
    expect(new Set([draft.tone, issued.tone, amended.tone])).toHaveProperty('size', 3);
    expect(new Set([draft.icon, issued.icon, amended.icon])).toHaveProperty('size', 3);

    // Draft description says "not yet issued" — the clinical truth.
    expect(draft.description.toLowerCase()).toContain('draft');
    expect(draft.description.toLowerCase()).toContain('not yet issued');
  });

  it('gates every patient-facing operation on the issuable flag', () => {
    // Draft must not be handed to a third party (share/print/distribute).
    expect(reportStatusView({ status: 'draft', version: 1 }).issuable).toBe(false);
    // Both issued and amended are safe to distribute.
    expect(reportStatusView({ status: 'final', version: 1 }).issuable).toBe(true);
    expect(reportStatusView({ status: 'final', version: 2 }).issuable).toBe(true);
  });

  it('never uses "signed" wording — the build cannot substantiate it (UI-P0-01 acceptance)', () => {
    // The audit is explicit: "Do not change underlying clinical workflow
    // semantics merely to match a label. ... If no verifiable digital-signature
    // operation exists, replace claims of digital signing with accurate
    // language." Every visible string returned by the model has to agree.
    for (const status of ['draft', 'issued', 'amended'] as const) {
      const view = reportStatusView(
        status === 'draft'
          ? { status: 'draft', version: 1 }
          : { status: 'final', version: status === 'amended' ? 2 : 1 },
      );
      expect(view.label.toLowerCase()).not.toContain('signed');
      expect(view.description.toLowerCase()).not.toContain('signed');
    }
    expect(ISSUE_REPORT_LABEL.toLowerCase()).not.toContain('signed');
    expect(ISSUE_REPORT_LABEL.toLowerCase()).toContain('issue');
  });
});
