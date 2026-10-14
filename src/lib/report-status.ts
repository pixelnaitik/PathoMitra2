/**
 * Report-status presentation model — the ONE place Draft / Issued / Amended
 * are turned into a name, a tone, an icon and a set of permitted actions.
 *
 * Why: the same clinical state was being rendered three ways on the Reports
 * tab (a check-circle icon that read as "success", a green pill that said
 * whatever the test name was, and a separate "Draft" pill further down the
 * card). A reviewer could not tell at a glance whether a report was a draft
 * or had actually been handed to the patient — the exact failure the UI/UX
 * audit calls out in UI-P0-01.
 *
 * The model is content-driven, not colour-driven: every status has a
 * distinct label + a distinct icon + a distinct tone, so a viewer with any
 * colour vision deficiency still reads the state correctly, and the icon is
 * duplicated by text inside the badge.
 *
 * Semantics: the underlying schema (ReportStatusSchema in lib/models.ts)
 * only knows two stored values — 'draft' and 'final'. Anything above v1 is
 * treated as 'amended' for display purposes; that is what the patient and
 * the referring doctor actually see on a reissued report.
 *
 * Naming rule: the app does not produce a cryptographically verifiable
 * digital signature (see lib/report-compliance.ts). Every string here says
 * "issued" or "final", never "signed" — otherwise the UI is claiming an
 * assurance the build cannot back up.
 */
import type { PillTone } from '../components/ui/StatusPill';

export type ReportViewStatus = 'draft' | 'issued' | 'amended';

/** The subset of a report record the presentation model needs. */
export interface ReportStatusInput {
  status?: string | null;
  version?: number | string | null;
}

/** Resolve the stored status + version into the three-way view model. */
export function resolveReportViewStatus(input: ReportStatusInput): ReportViewStatus {
  if (input.status === 'draft') return 'draft';
  const version = Number(input.version ?? 1);
  return Number.isFinite(version) && version > 1 ? 'amended' : 'issued';
}

export interface ReportStatusView {
  /** Short, all-caps-friendly label — never relies on colour alone. */
  label: string;
  /** Longer, sentence-friendly form for the card subtitle. */
  description: string;
  /** Semantic tone (mapped through the shared StatusPill palette). */
  tone: PillTone;
  /**
   * Key into the LUCIDE icon set the consumer picks from. A stable string
   * keeps this file import-free (no React), so it can be unit-tested in
   * isolation and reused by the PDF pipeline later.
   */
  icon: 'draft' | 'issued' | 'amended';
  /**
   * Whether the record is safe to hand to a third party (share/print/PDF
   * distribution). A draft has not been reviewed, so every downstream
   * surface keys off this — not off a check-circle icon.
   */
  issuable: boolean;
}

const VIEWS: Record<ReportViewStatus, ReportStatusView> = {
  draft: {
    label: 'Draft',
    description: 'Draft — not yet issued',
    tone: 'warning',
    icon: 'draft',
    issuable: false,
  },
  issued: {
    label: 'Issued',
    description: 'Issued Pathology Report',
    tone: 'success',
    icon: 'issued',
    issuable: true,
  },
  amended: {
    label: 'Amended',
    description: 'Amended issue — supersedes the earlier version',
    tone: 'info',
    icon: 'amended',
    issuable: true,
  },
};

/** The full view bundle for a report record. */
export function reportStatusView(input: ReportStatusInput): ReportStatusView {
  return VIEWS[resolveReportViewStatus(input)];
}

/**
 * Human wording for the primary action that moves a draft into an issued
 * report. The app cannot produce a signed document (see lib/report-compliance
 * .ts), so we say "Issue" not "Sign" — the button label must not promise an
 * operation the build does not perform.
 */
export const ISSUE_REPORT_LABEL = 'Issue report';
/** Secondary wording for a report that already exists but is being re-saved. */
export const SAVE_DRAFT_LABEL = 'Save as draft';
