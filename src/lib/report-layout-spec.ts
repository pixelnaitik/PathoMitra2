/**
 * Field spec for the report-layout settings — one declarative table that the
 * controls, the validation and the "Reset to recommended" flow all read from.
 * Ranges match the clamps in resolveReportLayout() so a value that passes the
 * UI can never be silently clamped differently by the PDF generator.
 */
import type { LabSettings } from './settings';
import { RECOMMENDED_LAYOUT_DEFAULTS, safeNum } from './report-layout';

export type LayoutFieldKey =
  | 'reportTitleFontSize'
  | 'patientInfoFontSize'
  | 'patientLineHeight'
  | 'reportSectionGap'
  | 'tableHeaderFontSize'
  | 'reportTableBodyFontSize'
  | 'tableCellPadding'
  | 'notesFontSize'
  | 'footerFontSize'
  | 'shareTableBodyFontSize'
  | 'reportMarginTop'
  | 'reportMarginBottom'
  | 'reportMarginLeft'
  | 'reportMarginRight'
  | 'shareMarginTop'
  | 'shareMarginBottom'
  | 'shareMarginLeft'
  | 'shareMarginRight';

export type FieldKind = 'pt' | 'mm';

export interface ReportFieldSpec {
  key: LayoutFieldKey;
  label: string;
  /** Short "what this does" line shown under the control. */
  hint: string;
  kind: FieldKind;
  min: number;
  max: number;
  step: number;
  recommended: number;
}

export const REPORT_FIELDS: Record<LayoutFieldKey, ReportFieldSpec> = {
  reportTitleFontSize: {
    key: 'reportTitleFontSize',
    label: 'Lab title size',
    hint: 'The lab name at the top of the report.',
    kind: 'pt',
    min: 6,
    max: 60,
    step: 0.5,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.reportTitleFontSize,
  },
  patientInfoFontSize: {
    key: 'patientInfoFontSize',
    label: 'Patient details size',
    hint: 'Name, age, referring doctor, dates.',
    kind: 'pt',
    min: 4,
    max: 40,
    step: 0.5,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.patientInfoFontSize,
  },
  patientLineHeight: {
    key: 'patientLineHeight',
    label: 'Patient line spacing',
    hint: 'Vertical gap between patient detail lines.',
    kind: 'mm',
    min: 1,
    max: 30,
    step: 0.5,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.patientLineHeight,
  },
  reportSectionGap: {
    key: 'reportSectionGap',
    label: 'Space between sections',
    hint: 'Gap between the header, table and notes blocks.',
    kind: 'mm',
    min: 0,
    max: 60,
    step: 0.5,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.reportSectionGap,
  },
  tableHeaderFontSize: {
    key: 'tableHeaderFontSize',
    label: 'Table header size',
    hint: 'Column titles: TEST DESCRIPTION, RESULT…',
    kind: 'pt',
    min: 4,
    max: 40,
    step: 0.5,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.tableHeaderFontSize,
  },
  reportTableBodyFontSize: {
    key: 'reportTableBodyFontSize',
    label: 'Result text size',
    hint: 'The test rows of the results table.',
    kind: 'pt',
    min: 4,
    max: 40,
    step: 0.5,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.reportTableBodyFontSize,
  },
  tableCellPadding: {
    key: 'tableCellPadding',
    label: 'Row height',
    hint: 'Breath inside each result row.',
    kind: 'mm',
    min: 0,
    max: 20,
    step: 0.2,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.tableCellPadding,
  },
  notesFontSize: {
    key: 'notesFontSize',
    label: 'Notes size',
    hint: 'Clinical notes under the table.',
    kind: 'pt',
    min: 4,
    max: 40,
    step: 0.5,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.notesFontSize,
  },
  footerFontSize: {
    key: 'footerFontSize',
    label: 'Footer size',
    hint: '"End of report" line at the bottom.',
    kind: 'pt',
    min: 4,
    max: 40,
    step: 0.5,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.footerFontSize,
  },
  shareTableBodyFontSize: {
    key: 'shareTableBodyFontSize',
    label: 'Result text size',
    hint: 'Shared reports are read on phones — 10–11 pt works best.',
    kind: 'pt',
    min: 4,
    max: 40,
    step: 0.5,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.shareTableBodyFontSize,
  },
  reportMarginTop: {
    key: 'reportMarginTop',
    label: 'Top margin',
    hint: 'Space kept free for your pre-printed pad header.',
    kind: 'mm',
    min: 0,
    max: 180,
    step: 1,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.reportMarginTop,
  },
  reportMarginBottom: {
    key: 'reportMarginBottom',
    label: 'Bottom margin',
    hint: 'Space kept free above the pad footer.',
    kind: 'mm',
    min: 0,
    max: 180,
    step: 1,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.reportMarginBottom,
  },
  reportMarginLeft: {
    key: 'reportMarginLeft',
    label: 'Left margin',
    hint: 'Clear of the printer edge / pad binding.',
    kind: 'mm',
    min: 0,
    max: 90,
    step: 1,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.reportMarginLeft,
  },
  reportMarginRight: {
    key: 'reportMarginRight',
    label: 'Right margin',
    hint: 'Clear of the printer edge.',
    kind: 'mm',
    min: 0,
    max: 90,
    step: 1,
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.reportMarginRight,
  },
  shareMarginTop: {
    key: 'shareMarginTop',
    label: 'Top margin',
    kind: 'mm',
    min: 0,
    max: 180,
    step: 1,
    hint: 'Distance below the template artwork.',
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.shareMarginTop,
  },
  shareMarginBottom: {
    key: 'shareMarginBottom',
    label: 'Bottom margin',
    kind: 'mm',
    min: 0,
    max: 180,
    step: 1,
    hint: 'Distance above the template artwork.',
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.shareMarginBottom,
  },
  shareMarginLeft: {
    key: 'shareMarginLeft',
    label: 'Left margin',
    kind: 'mm',
    min: 0,
    max: 90,
    step: 1,
    hint: 'Inner edge of the template artwork.',
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.shareMarginLeft,
  },
  shareMarginRight: {
    key: 'shareMarginRight',
    label: 'Right margin',
    kind: 'mm',
    min: 0,
    max: 90,
    step: 1,
    hint: 'Inner edge of the template artwork.',
    recommended: RECOMMENDED_LAYOUT_DEFAULTS.shareMarginRight,
  },
};

export const formatFieldValue = (spec: ReportFieldSpec, value: number): string =>
  spec.kind === 'pt' ? `${value} pt` : `${value} mm`;

/** Clamp + round to the field step, so stored values stay clean. */
export function sanitizeFieldValue(spec: ReportFieldSpec, raw: number): number {
  const n = safeNum(raw, spec.recommended);
  const clamped = Math.min(spec.max, Math.max(spec.min, n));
  // Scale by the step's reciprocal *once* (1/0.2 = 5, not 0.2 repeated) to
  // avoid float artifacts like 7 * 0.2 = 1.4000000000000001.
  const inv = 1 / spec.step;
  const stepped = Math.round(clamped * inv) / inv;
  const decimals = Math.min(3, Math.max(0, Math.round(Math.log10(inv))));
  return Number(stepped.toFixed(decimals));
}

export interface FieldIssue {
  field: string;
  message: string;
}

/**
 * Cross-field validation that plain range clamping can't express.
 * Every message says what's wrong *and* how to fix it (no red-only cues).
 */
export function validateLayoutSettings(s: LabSettings): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const top = safeNum(s.reportMarginTop, 50);
  const bottom = safeNum(s.reportMarginBottom, 20);
  if (top + bottom > 277) {
    issues.push({
      field: 'reportMarginTop',
      message: `Top + bottom margins leave only ${Math.max(0, 297 - top - bottom)} mm of page. Keep them at 277 mm or less combined so the report has room for content.`,
    });
  }
  const left = safeNum(s.reportMarginLeft, 8);
  const right = safeNum(s.reportMarginRight, 15);
  if (left + right > 180) {
    issues.push({
      field: 'reportMarginLeft',
      message: `Left + right margins leave only ${Math.max(0, 210 - left - right)} mm of width. Reduce them to 180 mm or less combined.`,
    });
  }
  const body = safeNum(s.reportTableBodyFontSize ?? s.tableBodyFontSize, 10);
  if (body < 8) {
    issues.push({
      field: 'reportTableBodyFontSize',
      message: 'Result text below 8 pt is hard to read in print. Increase it to at least 8 pt.',
    });
  }
  return issues;
}
