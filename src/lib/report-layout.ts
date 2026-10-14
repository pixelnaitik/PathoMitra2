/**
 * Shared, dependency-free layout math for report PDFs and the live A4 preview.
 *
 * Keeping this in one place guarantees the preview is a faithful representation
 * of the generated PDF: the exact same mm geometry and clamping are consumed by
 * both the jsPDF generator (ReportsPage) and the React preview component.
 */
import type { LabSettings } from './settings';
import { buildReportLegalLines } from './report-compliance';

/** jsPDF draws reports in a 210 × 297 mm coordinate space. */
export const A4 = { widthMm: 210, heightMm: 297 } as const;

/** CSS pixels per millimetre at 100% zoom on a 96 dpi screen (96 / 25.4). */
export const MM_TO_PX_BASE = 96 / 25.4;

/** 1 typographic point (1/72") expressed in millimetres. */
export const PT_TO_MM = 0.3527777778;

/** Coerce any value to a finite number, never NaN/Infinity. */
export function safeNum(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

/** Clamp to [min, max]; falls back to min for invalid input. */
export function clamp(value: number, min: number, max: number): number {
  const n = safeNum(value, min);
  return Math.min(max, Math.max(min, n));
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PrintableArea {
  width: number;
  height: number;
  valid: boolean;
}

/** printableWidth = 210 - left - right ; printableHeight = 297 - top - bottom */
export function getPrintableArea(m: Margins): PrintableArea {
  const width = A4.widthMm - m.left - m.right;
  const height = A4.heightMm - m.top - m.bottom;
  return { width, height, valid: width > 0 && height > 0 };
}

/**
 * Recommended out-of-the-box layout — the single source of truth every
 * "Reset to recommended" action restores. Values are tuned for a standard
 * A4 pathology report printed on a pre-printed pad.
 */
export const RECOMMENDED_LAYOUT_DEFAULTS = {
  reportTemplate: 'blank',
  shareTemplate: 'blank',
  reportMarginTop: 50,
  reportMarginBottom: 20,
  reportMarginLeft: 8,
  reportMarginRight: 15,
  shareMarginTop: 40,
  shareMarginBottom: 20,
  shareMarginLeft: 15,
  shareMarginRight: 15,
  reportTableBodyFontSize: 10,
  shareTableBodyFontSize: 10,
  reportTitleFontSize: 22,
  patientInfoFontSize: 10,
  patientLineHeight: 5.0,
  reportSectionGap: 6,
  tableHeaderFontSize: 10,
  tableBodyFontSize: 10,
  tableCellPadding: 1.4,
  notesFontSize: 9,
  footerFontSize: 10,
} as const;

/** Table column split (mm) shared by the PDF generator, sample export and preview. */
export function getColumnWidths(printableWidth: number): [number, number, number, number] {
  const w = safeNum(printableWidth, 0);
  return [(w * 70) / 180, (w * 30) / 180, (w * 35) / 180, (w * 45) / 180];
}

type Rgb = [number, number, number];

export interface ReportPalette {
  BRAND: Rgb;
  BRAND_DARK: Rgb;
  BRAND_TINT: Rgb;
  BRAND_TINT2: Rgb;
  BRAND_SOFT: Rgb;
  INK: Rgb;
  INK_SOFT: Rgb;
  BLACK: Rgb;
  HAIRLINE: Rgb;
}

const hexToRgb = (hex: string): Rgb => {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
};

const mixWhite = (rgb: Rgb, amt: number): Rgb => [
  Math.round(rgb[0] + (255 - rgb[0]) * amt),
  Math.round(rgb[1] + (255 - rgb[1]) * amt),
  Math.round(rgb[2] + (255 - rgb[2]) * amt),
];

/**
 * The brand ramp used by the PDF, the live preview and the sample export.
 * 'blank' keeps pure black rules (legacy pre-printed-pad rendering).
 */
export function buildReportPalette(themePreviewHex: string, template: string): ReportPalette {
  const legacy = template === 'blank';
  const BRAND = hexToRgb(themePreviewHex);
  const BRAND_DARK: Rgb = [
    Math.round(BRAND[0] * 0.62),
    Math.round(BRAND[1] * 0.62),
    Math.round(BRAND[2] * 0.62),
  ];
  const BLACK: Rgb = [0, 0, 0];
  return {
    BRAND,
    BRAND_DARK,
    BRAND_TINT: mixWhite(BRAND, 0.93),
    BRAND_TINT2: mixWhite(BRAND, 0.8),
    BRAND_SOFT: mixWhite(BRAND, 0.86),
    INK: [29, 29, 31],
    INK_SOFT: [102, 102, 109],
    BLACK,
    HAIRLINE: legacy ? BLACK : mixWhite(BRAND, 0.72),
  };
}

/**
 * Normalised, always-safe description of the report layout, derived
 * straight from LabSettings. Pass 'share' to resolve the share-template
 * variants of the settings. Every field is clamped to a sane range so a
 * malformed / empty input can never break the preview or the PDF.
 *
 * `signerName` is the authenticated operator issuing the report; the real
 * generator passes it, the preview and the sample export leave it blank and
 * get the neutral issuance wording. `legal` rides along on the resolved layout
 * so the live preview, the sample PDF and the patient PDF can never print
 * three different versions of the laboratory's credentials.
 */
export function resolveReportLayout(
  s: LabSettings,
  mode: 'print' | 'share' = 'print',
  signerName = '',
) {
  const share = mode === 'share';
  const margins: Margins = {
    top: clamp(safeNum(share ? s.shareMarginTop : s.reportMarginTop, 50), 0, A4.heightMm),
    right: clamp(safeNum(share ? s.shareMarginRight : s.reportMarginRight, 15), 0, A4.widthMm),
    bottom: clamp(safeNum(share ? s.shareMarginBottom : s.reportMarginBottom, 20), 0, A4.heightMm),
    left: clamp(safeNum(share ? s.shareMarginLeft : s.reportMarginLeft, 8), 0, A4.widthMm),
  };
  const printable = getPrintableArea(margins);
  return {
    mode,
    margins,
    printable,
    columns: getColumnWidths(printable.width),
    template: (share ? s.shareTemplate || s.reportTemplate : s.reportTemplate) || 'blank',
    titleFont: clamp(safeNum(s.reportTitleFontSize, 22), 6, 60),
    patientFont: clamp(safeNum(s.patientInfoFontSize, 10), 4, 40),
    patientLineHeightMm: clamp(safeNum(s.patientLineHeight, 5), 1, 30),
    sectionGapMm: clamp(safeNum(s.reportSectionGap, 6), 0, 60),
    tableHeaderFont: clamp(safeNum(s.tableHeaderFontSize, 10), 4, 40),
    tableBodyFont: clamp(
      (share ? s.shareTableBodyFontSize : s.reportTableBodyFontSize) ?? s.tableBodyFontSize ?? 10,
      4,
      40,
    ),
    tableCellPaddingMm: clamp(safeNum(s.tableCellPadding, 1.4), 0, 20),
    notesFont: clamp(safeNum(s.notesFontSize, 9), 4, 40),
    footerFont: clamp(safeNum(s.footerFontSize, 10), 4, 40),
    themeId: s.themeId || 'navy',
    labName: s.labName || 'PathoMitra Lab',
    legal: buildReportLegalLines({
      accreditationBody: s.accreditationBody,
      accreditationNumber: s.accreditationNumber,
      licenceNumber: s.licenceNumber,
      accreditationAttestedAt: s.accreditationAttestedAt,
      signerName,
    }),
  };
}

export type ResolvedReportLayout = ReturnType<typeof resolveReportLayout>;

export interface MarginIssue {
  level: 'error' | 'warn';
  message: string;
}

/** Human-facing warnings when margins become physically impossible. */
export function validateMargins(m: Margins): MarginIssue[] {
  const issues: MarginIssue[] = [];
  const vh = m.top + m.bottom;
  const hw = m.left + m.right;
  if (vh >= A4.heightMm)
    issues.push({
      level: 'error',
      message: `Top + Bottom margins must stay under ${A4.heightMm} mm (page height) — currently ${vh} mm.`,
    });
  else if (vh > A4.heightMm - 20)
    issues.push({
      level: 'warn',
      message: `Only ${Math.round(A4.heightMm - vh)} mm of vertical space left for content.`,
    });
  if (hw >= A4.widthMm)
    issues.push({
      level: 'error',
      message: `Left + Right margins must stay under ${A4.widthMm} mm (page width) — currently ${hw} mm.`,
    });
  else if (hw > A4.widthMm - 30)
    issues.push({
      level: 'warn',
      message: `Only ${Math.round(A4.widthMm - hw)} mm of horizontal space left for content.`,
    });
  return issues;
}
