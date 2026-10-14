/**
 * The print dialog's decision logic, kept free of React and of Electron.
 *
 * Everything that can be wrong about a print job — "1-3, 5" parsed wrongly, a
 * range that silently prints the whole report, a page count off by one — is a
 * clinical problem, not a UI problem: the lab prints the wrong pages and notices
 * at the counter. So the parsing lives here, is pure, and is unit-tested; the
 * component only renders the result.
 *
 * Page numbers are **1-based everywhere in this module** because that is what a
 * human reads at the bottom of a report ("Page 1 of 4"). Electron's
 * `PageRanges` is 0-based, which is one of the reasons the print path never
 * passes page ranges at all — see `electron/print-window.ts`: the printed
 * document is built from exactly the selected pages, so there is nothing left
 * for the spooler to subset.
 */
import type { DesktopPrinter } from './desktop-bridge';

/** Page sizes the dialog offers. Values in mm, portrait; landscape swaps them. */
export const PRINT_PAGE_SIZES = [
  { id: 'A4', label: 'A4 — 210 × 297 mm', widthMm: 210, heightMm: 297 },
  { id: 'A5', label: 'A5 — 148 × 210 mm', widthMm: 148, heightMm: 210 },
  { id: 'Letter', label: 'Letter — 8.5 × 11 in', widthMm: 215.9, heightMm: 279.4 },
  { id: 'Legal', label: 'Legal — 8.5 × 14 in', widthMm: 215.9, heightMm: 355.6 },
] as const;

export type PrintPageSizeId = (typeof PRINT_PAGE_SIZES)[number]['id'];

export type PrintRangeMode = 'all' | 'current' | 'custom';
/** `fit` = shrink to the printable area and centre; `actual` = 100 %; `shrink` = never enlarge. */
export type PrintScaleMode = 'fit' | 'actual' | 'shrink';
export type PrintDuplexMode = 'simplex' | 'shortEdge' | 'longEdge';

export interface PrintSettings {
  /** OS printer name (`PrinterInfo.name`), not the friendly name. */
  deviceName: string;
  copies: number;
  collate: boolean;
  duplex: PrintDuplexMode;
  landscape: boolean;
  pageSize: PrintPageSizeId;
  scale: PrintScaleMode;
  rangeMode: PrintRangeMode;
  /** Raw text of the custom field as typed, e.g. `1-3, 5`. */
  rangeText: string;
  /** 1-based page shown for `rangeMode: 'current'`. */
  currentPage: number;
}

/**
 * Raster scale for the printed pages. PDF units are 1/72 in, so scale N renders
 * at N × 72 dpi: 4.17 ≈ 300 dpi, which is beyond what a lab laser printer
 * resolves — the compromise of printing through Chromium (see the dialog's
 * "Print via the PDF app" escape hatch for a vector job).
 */
export const PRINT_RENDER_SCALE = 300 / 72;

/** CSS px per millimetre at 96 dpi — the preview's on-screen geometry. */
export const MM_TO_PX = 96 / 25.4;

export const COPIES_MIN = 1;
export const COPIES_MAX = 99;

/**
 * Pages one job may carry.
 *
 * Declared here because both halves of the pipeline enforce the same number: the
 * dialog refuses an oversized selection *before* spending a minute rasterising it,
 * and `electron/print-window.ts` refuses it again before building the document,
 * because the main process cannot trust a renderer it does not control.
 */
export const MAX_PRINT_PAGES = 200;

export function pageSize(id: PrintPageSizeId): (typeof PRINT_PAGE_SIZES)[number] {
  return PRINT_PAGE_SIZES.find(p => p.id === id) ?? PRINT_PAGE_SIZES[0];
}

/** Physical page box, swapped for landscape. */
export function pageBoxMm(id: PrintPageSizeId, landscape: boolean): { w: number; h: number } {
  const size = pageSize(id);
  return landscape ? { w: size.heightMm, h: size.widthMm } : { w: size.widthMm, h: size.heightMm };
}

export function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return COPIES_MIN;
  return Math.min(COPIES_MAX, Math.max(COPIES_MIN, Math.round(value)));
}

/**
 * Parse a lab-typed page list: `2`, `1-3`, `1,3-5`, `4-` (to the end),
 * `-2` (from the start). Separators may be `,` or the word `and`; range dashes
 * may be `-`, `–`, `—` or `~`.
 *
 * Deliberately strict: an unparseable fragment is an error shown next to the
 * field, never a silent fallback to "print everything" — a whole patient's
 * report coming out of the printer because a comma was typed wrong is the worst
 * possible failure mode for a "helpful" default.
 */
export function parsePageRanges(
  text: string,
  pageCount: number,
): { pages: number[]; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { pages: [], error: 'Enter at least one page, e.g. 1-2.' };
  if (pageCount < 1) return { pages: [], error: 'This report has no pages to print.' };

  const found = new Set<number>();
  for (const rawChunk of trimmed.split(/[,;]|\band\b/i)) {
    const chunk = rawChunk.trim();
    if (!chunk) continue;

    // `2` / `1-3` / `3-` (to the end) / `-2` (from the start). Dashes may be
    // typed as -, –, — or ~ by anyone whose keyboard offers them.
    const range = chunk.match(/^(\d+)?\s*[-–—~]\s*(\d+)?$/);
    const single = chunk.match(/^(\d+)$/);
    let low: number;
    let high: number;

    if (range && (range[1] !== undefined || range[2] !== undefined)) {
      low = range[1] !== undefined ? Number(range[1]) : 1;
      high = range[2] !== undefined ? Number(range[2]) : pageCount;
    } else if (single) {
      low = high = Number(single[1]);
    } else {
      return { pages: [], error: `"${chunk}" is not a page or a page range.` };
    }

    // "5-2" is a slip of the finger, not a misunderstanding: take the span.
    if (low > high) [low, high] = [high, low];

    if (low < 1 || high > pageCount) {
      const offender = low < 1 ? low : high;
      return {
        pages: [],
        error: `Page ${offender} does not exist — this report has ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}.`,
      };
    }
    for (let page = low; page <= high; page += 1) found.add(page);
  }

  if (found.size === 0) return { pages: [], error: 'No pages selected.' };
  return { pages: [...found].sort((a, b) => a - b), error: null };
}

/** Collapse `[1,2,3,5]` into `[{from:1,to:3},{from:5,to:5}]`. */
export function groupPages(pages: number[]): Array<{ from: number; to: number }> {
  const groups: Array<{ from: number; to: number }> = [];
  for (const page of pages) {
    const last = groups[groups.length - 1];
    if (last && page === last.to + 1) last.to = page;
    else groups.push({ from: page, to: page });
  }
  return groups;
}

/** `[1,2,3,5]` → `1–3, 5` — what the dialog echoes back to the user. */
export function formatPageList(pages: number[]): string {
  return groupPages(pages)
    .map(group => (group.from === group.to ? String(group.from) : `${group.from}–${group.to}`))
    .join(', ');
}

/** Resolve whichever mode is active into the concrete 1-based page list. */
export function selectedPages(
  settings: Pick<PrintSettings, 'rangeMode' | 'rangeText' | 'currentPage'>,
  pageCount: number,
): { pages: number[]; error: string | null } {
  if (pageCount < 1) return { pages: [], error: 'This report has no pages to print.' };
  if (settings.rangeMode === 'all') {
    return { pages: Array.from({ length: pageCount }, (_, i) => i + 1), error: null };
  }
  if (settings.rangeMode === 'current') {
    const page = Math.min(Math.max(1, Math.round(settings.currentPage)), pageCount);
    return { pages: [page], error: null };
  }
  return parsePageRanges(settings.rangeText, pageCount);
}

export interface PreviewBox {
  widthPx: number;
  heightPx: number;
  /** How much of the container the sheet fills — shown as the zoom readout. */
  zoom: number;
}

/**
 * Fit a page box into the preview pane (CSS px, 96 dpi). The preview is always
 * "the whole sheet, as large as it fits" — the scale setting changes what the
 * *printer* gets, not what the operator is shown, because a preview that hides
 * part of the page would be worse than useless for a report.
 */
export function previewBox(
  settings: Pick<PrintSettings, 'pageSize' | 'landscape'>,
  containerPx: { width: number; height: number },
): PreviewBox {
  const box = pageBoxMm(settings.pageSize, settings.landscape);
  const pageW = box.w * MM_TO_PX;
  const pageH = box.h * MM_TO_PX;
  const available = Math.min(containerPx.width, containerPx.height * (pageW / pageH));
  const scale = containerPx.width > 0 && pageW > 0 ? available / pageW : 0;
  return { widthPx: pageW * scale, heightPx: pageH * scale, zoom: scale };
}

/** The label under the Print button: what is about to happen, in one line. */
export function describeJob(
  settings: PrintSettings,
  pages: number[],
  pageCount: number,
  printer: DesktopPrinter | null,
): string {
  const sheetCount = pages.length || pageCount;
  const sheets = `${sheetCount} ${sheetCount === 1 ? 'sheet' : 'sheets'}`;
  const copies = settings.copies > 1 ? ` × ${settings.copies} copies` : '';
  const duplex = settings.duplex === 'simplex' ? '' : ', double-sided';
  const who = printer ? printer.displayName || printer.name : 'no printer selected';
  return `${sheets}${copies}${duplex} → ${who}`;
}

/**
 * Printers that write a file instead of paper. Named explicitly — the point is
 * to tell the operator where the job goes, never to guess about unknown devices.
 */
export function isVirtualPrinter(name: string): boolean {
  return /adobe pdf|microsoft print to pdf|onenote|xps|fax/i.test(name);
}

/**
 * Sensible first opening: the system default printer if it is a real one, A4
 * portrait, one copy, every page. A lab whose default printer is a virtual one
 * (Adobe PDF, Microsoft Print to PDF, OneNote) gets that printer *unselected* —
 * silently "printing" into a Save dialog is the complaint this whole dialog
 * exists to fix.
 */
export function initialPrintSettings(
  printers: DesktopPrinter[],
  pageCount: number,
  currentPage = 1,
): PrintSettings {
  const preferred =
    printers.find(p => p.isDefault && !isVirtualPrinter(p.name)) ??
    printers.find(p => !isVirtualPrinter(p.name)) ??
    printers[0];
  return {
    deviceName: preferred?.name ?? '',
    copies: 1,
    collate: true,
    duplex: 'simplex',
    landscape: false,
    pageSize: 'A4',
    scale: 'fit',
    rangeMode: 'all',
    rangeText: pageCount > 1 ? `1-${pageCount}` : '1',
    currentPage: Math.min(Math.max(1, currentPage), Math.max(1, pageCount)),
  };
}

/** True when the job can be handed to the printer at all. */
export function canPrint(settings: PrintSettings, pages: number[], error: string | null): boolean {
  return !error && pages.length > 0 && settings.deviceName.trim().length > 0;
}
