/**
 * The in-app print dialog's backend: enumerate printers, and spool an
 * already-rendered job through Chromium's own print pipeline.
 *
 * Why the renderer sends PNGs rather than the PDF: Electron ships no PDF viewer
 * (Chromium's viewer component is not part of the runtime), so there is no way
 * to hand `webContents.print()` a PDF document — it prints *web content*. The
 * alternative that keeps vector text is the shell `Print` verb in `print.ts`,
 * which is why that path still exists and is still offered in the dialog as
 * "Print via the PDF app". The verb cannot honour page ranges, copies, scaling
 * or page size, so the dialog uses this module and rasterises at ~300 dpi.
 *
 * Two things this file is careful about:
 *   1. `webContents.print()` reports through a **callback**, not a promise, and
 *      the callback carries `(success, failureReason)`. Resolving before that
 *      would let a failed job look like a printed one.
 *   2. Page geometry is decided in ONE place — the `@page` CSS rule of the
 *      generated document. `landscape` is deliberately not passed: Blink lets an
 *      `@page` size override the option (documented for `printToPDF`, same code
 *      path here), so passing both is a coin flip on whether a landscape job
 *      comes out rotated twice.
 */
import { BrowserWindow, app, webContents } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readPrintQueue } from './print';

/** Same shape as `DesktopPrinter` in `src/lib/desktop-bridge.ts`. */
export interface PrinterEntry {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

/** Page sizes Electron accepts as a named `pageSize` — anything else is refused. */
const KNOWN_PAGE_SIZES = new Set(['A4', 'A5', 'Letter', 'Legal']);
type NamedPageSize = 'A4' | 'A5' | 'Letter' | 'Legal';

/** Same shape as `DesktopPrintRequest` on the renderer side. */
export interface PrintJobRequest {
  title: string;
  /** `data:image/png;base64,…` per page, already rotated to the sheet orientation. */
  pages: string[];
  sheetWidthMm: number;
  sheetHeightMm: number;
  imageWidthMm: number;
  imageHeightMm: number;
  options: {
    deviceName: string;
    copies: number;
    collate: boolean;
    duplex: 'simplex' | 'shortEdge' | 'longEdge';
    landscape: boolean;
    /** `A4` | `A5` | `Letter` | `Legal` — validated here, never cast. */
    pageSize: string;
    scale: 'fit' | 'actual' | 'shrink';
  };
}

export interface PrintJobResult {
  ok: boolean;
  error?: string;
}

/** A print job longer than this is a mistake, not a workflow. */
const MAX_PAGES = 200;
const MM_TO_PX = 96 / 25.4;

/**
 * Where a spooled job is staged: the app's own profile directory, never the
 * shared temp folder.
 *
 * The staging document is the report — every page rendered, patient name and
 * results included. It used to be written to `%TEMP%\PathoMitra\Print\` with a
 * filename derived from the job title, i.e. plaintext PHI in a directory other
 * applications and any user of that machine can read, in a folder the lab's own
 * backup tools sweep. That sat badly beside shipping the Android build with
 * screenshot protection on by default. Under `userData` the path is per-user,
 * outside every indexer, and the file gets a random name — the title never
 * touches the filesystem.
 */
function printStagingDir(): string {
  return path.join(app.getPath('userData'), 'Print');
}

/** Anything left behind by a crash is deleted on the next job. */
function sweepStaleStaging(dir: string, except: string): void {
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (full === except) continue;
      fs.rm(full, { force: true }, () => {});
    }
  } catch {
    // Nothing to sweep, or the directory is not ours to read. Never fail a job
    // over housekeeping.
  }
}

/**
 * Installed printers.
 *
 * `PrinterInfo` (electron.d.ts) exposes `name`, `displayName`, `description`
 * and an `options` object that is *untyped* — `isDefault` is documented for
 * Windows but not guaranteed by the typings, so the default is cross-checked
 * against WMI (`readPrintQueue`, already used by the shell-verb path) instead
 * of trusted from a dictionary with no type behind it.
 */
export async function listPrinters(parent?: BrowserWindow): Promise<PrinterEntry[]> {
  const contents =
    parent?.webContents ??
    webContents.getAllWebContents().find(c => !c.isDestroyed() && c.getType() === 'window');
  if (!contents) return [];

  let entries: PrinterEntry[];
  try {
    entries = (await contents.getPrintersAsync()).map(printer => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      description: printer.description ?? '',
      isDefault: (printer.options as { isDefault?: boolean } | undefined)?.isDefault === true,
    }));
  } catch {
    // A machine where the print spooler service is stopped still has to answer
    // the dialog; it just cannot list anything to choose from.
    return [];
  }

  const { defaultPrinter } = await readPrintQueue();
  if (defaultPrinter) {
    for (const entry of entries) {
      if (entry.name === defaultPrinter) entry.isDefault = true;
    }
  }
  return entries;
}

/** The one HTML construct this module builds, so it can be audited in one look. */
function pageCss(request: PrintJobRequest): string {
  const { sheetWidthMm, sheetHeightMm, imageWidthMm, imageHeightMm } = request;
  // `fit` = always fill the sheet (shrink *and* enlarge), `shrink` = natural size
  // capped to the sheet, `actual` = natural size, clipped by the sheet.
  const imageRule =
    request.options.scale === 'fit'
      ? `width: 100%; height: 100%; object-fit: contain;`
      : request.options.scale === 'shrink'
        ? `max-width: 100%; max-height: 100%; width: ${imageWidthMm}mm; height: ${imageHeightMm}mm; object-fit: contain;`
        : `width: ${imageWidthMm}mm; height: ${imageHeightMm}mm; object-fit: fill;`;
  return `
    @page { size: ${sheetWidthMm}mm ${sheetHeightMm}mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .sheet {
      position: relative;
      width: ${sheetWidthMm}mm; height: ${sheetHeightMm}mm;
      overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      page-break-after: always; break-after: page;
    }
    .sheet:last-child { page-break-after: auto; break-after: auto; }
    .sheet img { display: block; ${imageRule} }
  `;
}

function buildDocument(request: PrintJobRequest): string {
  const title = request.title.replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
  const sheets = request.pages
    .map(src => `<div class="sheet"><img src="${src}" alt=""></div>`)
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${pageCss(request)}</style></head><body>${sheets}</body></html>`;
}

/** Only a base64 PNG data URL is allowed into the generated document. */
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** A render of `Infinity` or `NaN` in the CSS is a silently broken page. */
const isPositiveFinite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

function validate(request: PrintJobRequest): string | null {
  if (typeof request.title !== 'string') return 'The print job had no title.';
  if (!request.options.deviceName.trim()) return 'No printer is selected.';
  if (!Array.isArray(request.pages) || request.pages.length === 0) {
    return 'There are no pages in this print job.';
  }
  if (request.pages.length > MAX_PAGES) {
    return `A job is limited to ${MAX_PAGES} pages (this one has ${request.pages.length}).`;
  }
  for (const page of request.pages) {
    if (typeof page !== 'string' || !PNG_DATA_URL.test(page)) {
      return 'A page of the job was not a PNG image.';
    }
  }
  if (!isPositiveFinite(request.sheetWidthMm) || !isPositiveFinite(request.sheetHeightMm)) {
    return 'The sheet size is invalid.';
  }
  // The image box feeds `@page`-relative mm values straight into the generated
  // CSS — an unchecked NaN/Infinity prints white sheets instead of failing.
  if (!isPositiveFinite(request.imageWidthMm) || !isPositiveFinite(request.imageHeightMm)) {
    return 'The page image size is invalid.';
  }
  if (!KNOWN_PAGE_SIZES.has(request.options.pageSize)) {
    return `Unsupported page size: ${request.options.pageSize}.`;
  }
  return null;
}

/**
 * Spool one job. Resolves with the spooler's own verdict.
 *
 * @param parent the dialog's window — used only to inherit the app icon/owner so
 *   the hidden print window does not spawn a stray taskbar entry.
 */
export async function printJob(
  request: PrintJobRequest,
  parent?: BrowserWindow,
): Promise<PrintJobResult> {
  const invalid = validate(request);
  if (invalid) return { ok: false, error: invalid };

  const dir = printStagingDir();
  // Random name, no title: the filename must not be a second copy of the
  // patient's identity.
  const file = path.join(dir, `${crypto.randomUUID()}.html`);
  let win: BrowserWindow | undefined;

  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    sweepStaleStaging(dir, file);
    fs.writeFileSync(file, buildDocument(request), { encoding: 'utf8', mode: 0o600 });

    const widthPx = Math.round(request.sheetWidthMm * MM_TO_PX);
    const heightPx = Math.round(request.sheetHeightMm * MM_TO_PX);
    win = new BrowserWindow({
      show: false,
      width: widthPx,
      height: heightPx,
      skipTaskbar: true,
      resizable: false,
      frame: false,
      parent,
      webPreferences: {
        // The document is generated here and contains images only: no bridge,
        // no node, no script execution surface.
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // A hidden window must still paint, or the job prints blank.
        backgroundThrottling: false,
      },
    });

    await win.loadFile(file);
    // Layout is done at `loadFile`, but the page images still need decoding —
    // printing before that yields white sheets on a slow disk.
    await win.webContents.executeJavaScript(
      'Promise.all([...document.images].map(i => i.decode().catch(() => null)))',
      true,
    );

    const options = request.options;
    const contents = win.webContents;
    return await new Promise<PrintJobResult>(resolve => {
      contents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: options.deviceName,
          copies: Math.max(1, Math.round(options.copies) || 1),
          collate: options.collate,
          duplexMode: options.duplex,
          pageSize: options.pageSize as NamedPageSize,
          // The PDF carries its own margins; the sheet *is* the page.
          margins: { marginType: 'none' },
        },
        (success, failureReason) =>
          resolve({ ok: success, error: success ? undefined : failureReason || 'print failed' }),
      );
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    win?.destroy();
    // The spooler has the bytes by now; the staging document is ours and
    // disposable, and it holds patient data — so it is removed even when the job
    // threw.
    fs.rm(file, { force: true }, () => {});
  }
}
