/**
 * Drawing a generated PDF inside the app.
 *
 * Electron ships no PDF viewer — Chromium's viewer component is not part of the
 * runtime — so a report PDF has nothing to render into, and `webContents.print()`
 * can only print web content. pdf.js closes both gaps: it is the live preview in
 * the print dialog and the rasteriser behind the print job.
 *
 * Desktop-only by construction: every entry point is behind a dynamic `import()`
 * reached from the desktop branch, so the web and APK bundles never load pdf.js
 * (the chunk is emitted and never fetched).
 *
 * Two pdf.js details that bite:
 *   - `getDocument({ data })` **transfers** the buffer to the worker, which
 *     detaches it. Each open gets its own `Uint8Array`.
 *   - Viewport units at scale 1 are PDF points (1/72 in), not pixels. Page
 *     geometry therefore goes through mm explicitly, via MM_PER_PT.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

const MM_PER_PT = 25.4 / 72;

let workerConfigured = false;

/** Load pdf.js and point it at its own worker, once. */
async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  if (!workerConfigured) {
    // Emitted as a file by Vite and served from the app's own privileged scheme.
    // If the worker cannot start, pdf.js falls back to running on the main
    // thread — slower, still correct — so a failure here is not fatal.
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    workerConfigured = true;
  }
  return pdfjs;
}

export interface OpenedPdf {
  readonly doc: PDFDocumentProxy;
  readonly pageCount: number;
  /** The document's own page box in mm, read from page 1 — not the sheet size. */
  readonly pageWidthMm: number;
  readonly pageHeightMm: number;
  /** Releases the worker + document. `destroy()` lives on the loading task. */
  destroy(): Promise<void>;
}

/** Open a document from the base64 jsPDF produced in the renderer. */
export async function openPdf(base64: string): Promise<OpenedPdf> {
  const pdfjs = await loadPdfJs();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  // The loading task owns the worker port; `PDFDocumentProxy` has no destroy().
  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  const first = await doc.getPage(1);
  const box = first.getViewport({ scale: 1 });
  return {
    doc,
    pageCount: doc.numPages,
    pageWidthMm: box.width * MM_PER_PT,
    pageHeightMm: box.height * MM_PER_PT,
    destroy: () => task.destroy(),
  };
}

export interface RenderOptions {
  /** 1-based page number. */
  pageNumber: number;
  /**
   * Extra rotation in degrees, multiple of 90. Used for the dialog's Landscape
   * choice: the page is rotated *into* the sheet, so the print pipeline never
   * has to guess whether the driver or the CSS did the turning.
   */
  rotationDeg?: number;
}

function clampPage(pageNumber: number, pageCount: number): number {
  return Math.min(Math.max(1, Math.round(pageNumber)), Math.max(1, pageCount));
}

function viewportFor(page: PDFPageProxy, scale: number, rotationDeg: number) {
  // pdf.js only accepts whole 90° steps.
  return page.getViewport({ scale, rotation: ((rotationDeg % 360) + 360) % 360 });
}

/**
 * Render one page into an existing canvas, sized by CSS to `cssWidthPx` square.
 * The backing store is scaled by devicePixelRatio so the preview stays crisp on
 * a Hi-DPI lab monitor instead of showing a blurry upscale.
 */
export async function renderPageInto(
  pdf: OpenedPdf,
  canvas: HTMLCanvasElement,
  options: RenderOptions & { cssWidthPx: number },
): Promise<void> {
  await loadPdfJs();
  const page = await pdf.doc.getPage(clampPage(options.pageNumber, pdf.pageCount));
  const natural = viewportFor(page, 1, options.rotationDeg ?? 0);
  const dpr = window.devicePixelRatio || 1;
  const cssHeightPx = options.cssWidthPx * (natural.height / natural.width);
  const viewport = viewportFor(
    page,
    (options.cssWidthPx * dpr) / natural.width,
    options.rotationDeg ?? 0,
  );

  canvas.width = Math.max(1, Math.round(options.cssWidthPx * dpr));
  canvas.height = Math.max(1, Math.round(cssHeightPx * dpr));
  canvas.style.width = `${Math.round(options.cssWidthPx)}px`;
  canvas.style.height = `${Math.round(cssHeightPx)}px`;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This window cannot draw a 2D canvas for the print preview.');
  context.clearRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
}

/**
 * One page as a PNG data URL for the print job.
 *
 * @param scale PDF-units → pixels. `PRINT_RENDER_SCALE` (≈300 dpi) for print;
 *   anything much higher costs memory for no visible gain on paper.
 */
export async function renderPageToPng(
  pdf: OpenedPdf,
  options: RenderOptions & { scale: number },
): Promise<string> {
  await loadPdfJs();
  const page = await pdf.doc.getPage(clampPage(options.pageNumber, pdf.pageCount));
  const viewport = viewportFor(page, options.scale, options.rotationDeg ?? 0);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This window cannot rasterise the report for printing.');
  // Paper is white; a transparent PNG would composite onto whatever the
  // printer's default background is.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/png');
}
