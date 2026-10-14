/**
 * <PrintDialog> — the app's own print sheet, Windows desktop only.
 *
 * Why this exists instead of the OS prompt: the lab needs to see the report and
 * choose the printer in the same breath. The shell-verb path (`electron/print.ts`)
 * spools blindly to whatever Windows calls the default printer — on a machine
 * whose default is "Adobe PDF" that reads as "the PDF app opened instead of
 * printing", which is exactly what the owner reported twice.
 *
 * The document is rasterised by pdf.js (`src/lib/pdf-preview.ts`) because
 * Electron ships no PDF viewer and `webContents.print()` prints web content, not
 * files. That is a deliberate trade: control over the job (pages, copies,
 * orientation, sheet size, scaling) in exchange for vector text. The vector path
 * stays available under "Advanced" — it is the same shell verb, unchanged.
 *
 * Nothing here runs on Android or web: the caller only mounts it when
 * `getShellKind() === 'desktop'`, and every shell call is behind `bridge`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { desktopBridge, type DesktopPrinter } from '../lib/desktop-bridge';
import { openPdf, renderPageInto, renderPageToPng, type OpenedPdf } from '../lib/pdf-preview';
import {
  COPIES_MAX,
  COPIES_MIN,
  MAX_PRINT_PAGES,
  PRINT_PAGE_SIZES,
  PRINT_RENDER_SCALE,
  clampCopies,
  canPrint,
  describeJob,
  initialPrintSettings,
  isVirtualPrinter,
  pageBoxMm,
  previewBox,
  selectedPages,
  type PrintDuplexMode,
  type PrintPageSizeId,
  type PrintRangeMode,
  type PrintScaleMode,
  type PrintSettings,
} from '../lib/print-model';
import { saveBinaryDocument } from '../lib/native-files';
import { printSavedFile } from '../lib/native-print';
import { Button } from './ui/Button';
import { Field, Select, TextInput } from './ui/Field';
import { SegmentedControl } from './ui/SegmentedControl';
import { Sheet } from './ui/Sheet';
import { Switch } from './ui/Switch';
import { Disclosure } from './ui/Disclosure';
import { cn } from '../lib/utils';

export interface PrintJob {
  /** Job name for the spooler. */
  title: string;
  /** File name used if the operator also saves the report. */
  filename: string;
  /** Raw base64 of the jsPDF document, nothing output. */
  pdfBase64: string;
}

interface Props {
  open: boolean;
  job: PrintJob | null;
  /** 1-based page the operator was looking at, for "Current page". */
  currentPage?: number;
  onClose: () => void;
  /** Called after the spooler accepted the job. */
  onPrinted?: () => void;
}

const SCALE_LABELS: Record<PrintScaleMode, string> = {
  fit: 'Fit to page',
  shrink: 'Shrink oversized pages',
  actual: 'Actual size',
};

const RANGE_LABELS: Record<PrintRangeMode, string> = {
  all: 'All',
  current: 'Current',
  custom: 'Custom',
};

export function PrintDialog({ open, job, currentPage = 1, onClose, onPrinted }: Props) {
  const bridge = desktopBridge();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  /** Same document as `pdf`, kept only so the cleanup can release it. */
  const pdfRef = useRef<OpenedPdf | null>(null);

  const [printers, setPrinters] = useState<DesktopPrinter[]>([]);
  const [settings, setSettings] = useState<PrintSettings | null>(null);
  /** The opened document; `null` means the dialog is still preparing. */
  const [pdf, setPdf] = useState<OpenedPdf | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by the resize listener so the preview re-fits itself. */
  const [, setResizeTick] = useState(0);

  const patch = useCallback((next: Partial<PrintSettings>) => {
    setSettings(current => (current ? { ...current, ...next } : current));
  }, []);

  /* Open the document + read the printer list once per job. ----------------- */
  useEffect(() => {
    if (!open || !job || !bridge) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, doc] = await Promise.all([bridge.print.printers(), openPdf(job.pdfBase64)]);
        if (cancelled) {
          await doc.destroy();
          return;
        }
        pdfRef.current = doc;
        setPrinters(list);
        setSettings(initialPrintSettings(list, doc.pageCount, currentPage));
        setPreviewPage(1);
        setError(null);
        setPdf(doc);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'The report could not be prepared.');
      }
    })();
    return () => {
      cancelled = true;
      const doc = pdfRef.current;
      pdfRef.current = null;
      if (doc) void doc.destroy();
    };
    // `currentPage` is only an initial value — re-running on it would reload the
    // document every time the operator pages through the preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job, bridge]);

  /* Keep the preview fitted to a resized window. --------------------------- */
  useEffect(() => {
    if (!open) return;
    const onResize = () => setResizeTick(t => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  /* Draw the preview. ------------------------------------------------------ */
  const pageCount = pdf?.pageCount ?? 0;
  const selection = settings ? selectedPages(settings, pageCount) : { pages: [], error: null };
  const selected = selection.pages;
  /**
   * The preview must never show a page that is not in the job — a dialog that
   * displays page 4 while printing 1-2 is worse than no preview at all.
   */
  const shownPage = selected.includes(previewPage) ? previewPage : (selected[0] ?? 1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!open || !canvas || !pdf || !settings) return;
    let stale = false;
    (async () => {
      try {
        // Fit the sheet to the pane in BOTH axes, so a long report on a short
        // window shrinks instead of running out of the dialog.
        const pane = paneRef.current;
        const box = previewBox(
          { pageSize: settings.pageSize, landscape: settings.landscape },
          { width: (pane?.clientWidth ?? 320) - 8, height: (pane?.clientHeight ?? 420) - 8 },
        );
        await renderPageInto(pdf, canvas, {
          pageNumber: shownPage,
          cssWidthPx: Math.max(120, box.widthPx),
          rotationDeg: settings.landscape ? 90 : 0,
        });
      } catch (err) {
        if (!stale) setError(err instanceof Error ? err.message : 'The preview failed.');
      }
    })();
    return () => {
      stale = true;
    };
  }, [open, pdf, shownPage, settings]);

  if (!bridge) return null;

  const selectedPrinter = printers.find(p => p.name === settings?.deviceName) ?? null;
  // The document is still being opened (or failed to): nothing can be printed.
  const loading = !pdf && !error;
  const busy = printing || !pdf;
  const printable = !!settings && canPrint(settings, selected, selection.error);

  const submit = async () => {
    if (!pdf || !settings) return;
    const pages = selectedPages(settings, pdf.pageCount);
    if (pages.error || pages.pages.length === 0) {
      setError(pages.error ?? 'No pages selected.');
      return;
    }
    // Refuse an oversized job before rasterising it, not after. The page ceiling
    // lives in the main process, which only sees the payload once every page has
    // already been drawn — so a mistake used to cost a minute of rendering before
    // being rejected.
    if (pages.pages.length > MAX_PRINT_PAGES) {
      setError(
        `A single print job is limited to ${MAX_PRINT_PAGES} pages — this one has ${pages.pages.length}.`,
      );
      return;
    }
    setError(null);
    setPrinting(true);
    try {
      const rotation = settings.landscape ? 90 : 0;
      const images: string[] = [];
      for (let i = 0; i < pages.pages.length; i += 1) {
        setProgress(
          pages.pages.length > 1
            ? `Preparing page ${pages.pages[i]} (${i + 1} of ${pages.pages.length})…`
            : null,
        );
        images.push(
          await renderPageToPng(pdf, {
            pageNumber: pages.pages[i],
            scale: PRINT_RENDER_SCALE,
            rotationDeg: rotation,
          }),
        );
      }
      const sheet = pageBoxMm(settings.pageSize, settings.landscape);
      const result = await bridge.print.job({
        title: job?.title ?? 'PathoMitra report',
        pages: images,
        sheetWidthMm: sheet.w,
        sheetHeightMm: sheet.h,
        imageWidthMm: rotation ? pdf.pageHeightMm : pdf.pageWidthMm,
        imageHeightMm: rotation ? pdf.pageWidthMm : pdf.pageHeightMm,
        options: {
          deviceName: settings.deviceName,
          copies: settings.copies,
          collate: settings.collate,
          duplex: settings.duplex,
          landscape: settings.landscape,
          pageSize: settings.pageSize,
          scale: settings.scale,
        },
      });
      if (!result.ok) {
        setError(result.error ?? 'The printer refused the job.');
        setPrinting(false);
        return;
      }
      setPrinting(false);
      setProgress(null);
      onPrinted?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Printing failed.');
      setPrinting(false);
    }
  };

  /** The vector route: hand the PDF to the OS handler and let it spool. */
  const printViaPdfApp = async () => {
    if (!job) return;
    setError(null);
    setPrinting(true);
    try {
      const saved = await saveBinaryDocument(job.filename, job.pdfBase64);
      const choice = await printSavedFile(saved);
      if (choice === 'printed') {
        onPrinted?.();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The PDF app could not print the report.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Print report"
      description={job?.title}
      width="xl"
      dismissible={!printing}
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 flex-1 truncate text-xs text-on-surface-variant">
            {settings && describeJob(settings, selected, pageCount, selectedPrinter)}
          </p>
          <div className="flex shrink-0 gap-3">
            <Button variant="primary" size="md" onClick={onClose} disabled={printing}>
              Cancel
            </Button>
            <Button
              variant="brand"
              size="md"
              onClick={submit}
              disabled={!printable || busy}
              className="min-w-32"
            >
              {printing ? (
                'Printing…'
              ) : (
                <>
                  <Printer className="h-4 w-4" /> Print
                </>
              )}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-5 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ---- Controls ------------------------------------------------- */}
        <div className="space-y-4">
          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-error/10 px-3 py-2.5 text-[13px] font-medium text-error"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{error}</span>
            </p>
          )}

          {loading && (
            <p className="py-6 text-center text-sm text-on-surface-variant">
              Preparing the report…
            </p>
          )}

          {settings && pdf && (
            <>
              <Field
                label="Printer"
                hint={
                  printers.length === 0
                    ? 'Windows reported no printer. Check the print spooler service.'
                    : selectedPrinter?.description
                }
                error={settings.deviceName ? undefined : 'No printer selected.'}
              >
                <Select
                  value={settings.deviceName}
                  onChange={e => patch({ deviceName: e.target.value })}
                  aria-label="Printer"
                >
                  <option value="">Choose a printer…</option>
                  {printers.map(printer => (
                    <option key={printer.name} value={printer.name}>
                      {printer.displayName}
                      {printer.isDefault ? ' — default' : ''}
                    </option>
                  ))}
                </Select>
              </Field>

              {selectedPrinter && isVirtualPrinter(selectedPrinter.name) && (
                <p className="flex items-start gap-2 rounded-xl bg-surface-container px-3 py-2.5 text-xs text-on-surface-variant">
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  <span>
                    “{selectedPrinter.displayName}” writes a file rather than printing on paper.
                    Pick a physical printer, or use “Print via the PDF app” for a vector job.
                  </span>
                </p>
              )}

              <fieldset className="space-y-2">
                <legend className="text-[13px] font-semibold text-on-surface-variant">Pages</legend>
                <SegmentedControl
                  id="print-range-mode"
                  aria-label="Which pages"
                  size="sm"
                  value={settings.rangeMode}
                  onChange={value => patch({ rangeMode: value })}
                  items={(Object.keys(RANGE_LABELS) as PrintRangeMode[]).map(mode => ({
                    value: mode,
                    label: RANGE_LABELS[mode],
                  }))}
                />
                {settings.rangeMode === 'custom' && (
                  <div className="flex items-end gap-2">
                    <Field
                      className="min-w-0 flex-1"
                      label="Page numbers"
                      hint="e.g. 1-3 or 2, 4"
                      error={selection.error ?? undefined}
                    >
                      <TextInput
                        value={settings.rangeText}
                        inputMode="numeric"
                        onChange={e => patch({ rangeText: e.target.value })}
                        placeholder="1-3"
                      />
                    </Field>
                    <span className="pb-3 text-xs text-on-surface-variant">of {pageCount}</span>
                  </div>
                )}
              </fieldset>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Copies">
                  <TextInput
                    type="number"
                    min={COPIES_MIN}
                    max={COPIES_MAX}
                    value={String(settings.copies)}
                    onChange={e => patch({ copies: clampCopies(Number(e.target.value)) })}
                  />
                </Field>
                <Field label="Sheet size">
                  <Select
                    value={settings.pageSize}
                    onChange={e => patch({ pageSize: e.target.value as PrintPageSizeId })}
                  >
                    {PRINT_PAGE_SIZES.map(size => (
                      <option key={size.id} value={size.id}>
                        {size.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Orientation">
                  <SegmentedControl
                    id="print-orientation"
                    aria-label="Orientation"
                    size="sm"
                    value={settings.landscape ? 'landscape' : 'portrait'}
                    onChange={value => patch({ landscape: value === 'landscape' })}
                    items={[
                      { value: 'portrait', label: 'Portrait' },
                      { value: 'landscape', label: 'Landscape' },
                    ]}
                  />
                </Field>
                <Field label="Scaling">
                  <Select
                    value={settings.scale}
                    onChange={e => patch({ scale: e.target.value as PrintScaleMode })}
                  >
                    {(Object.keys(SCALE_LABELS) as PrintScaleMode[]).map(mode => (
                      <option key={mode} value={mode}>
                        {SCALE_LABELS[mode]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low px-3.5 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-on-surface">Collate copies</p>
                  <p className="text-xs text-on-surface-variant">
                    {settings.collate
                      ? 'Complete sets: 1-2-3, 1-2-3'
                      : 'Stacked: all of page 1, then page 2'}
                  </p>
                </div>
                <Switch
                  label="Collate copies"
                  checked={settings.collate}
                  onChange={collate => patch({ collate })}
                />
              </div>

              <Field label="Print on both sides">
                <Select
                  value={settings.duplex}
                  onChange={e => patch({ duplex: e.target.value as PrintDuplexMode })}
                >
                  <option value="simplex">Off</option>
                  <option value="longEdge">Long edge (book)</option>
                  <option value="shortEdge">Short edge (calendar)</option>
                </Select>
              </Field>

              <Disclosure title="Advanced" summary="Vector print through the PDF app">
                <p className="pb-2 text-xs leading-relaxed text-on-surface-variant">
                  Sends the PDF itself to Windows, which hands it to the registered PDF app. Text
                  stays vector and the app adds no settings — page selection, copies and scaling are
                  ignored.
                </p>
                <Button variant="outline" size="sm" onClick={printViaPdfApp} disabled={busy}>
                  Print via the PDF app
                </Button>
              </Disclosure>
            </>
          )}
        </div>

        {/* ---- Live preview --------------------------------------------- */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-on-surface-variant">Preview</p>
            <p className="text-xs text-on-surface-variant">
              {selected.length || pageCount} of {pageCount} pages
            </p>
          </div>
          <div
            ref={paneRef}
            className={cn(
              // Centred, not top-pinned: the pane stretches to match the taller
              // controls column, and `items-start` left a dead grey strip under
              // the page on every short report.
              'flex min-h-[220px] flex-1 items-center justify-center rounded-xl border border-outline-variant/60',
              'bg-surface-container-high p-2',
            )}
          >
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`Preview of page ${shownPage} of ${pageCount || 1}`}
              className="rounded-sm bg-white shadow-card"
            />
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="neutral"
              size="sm"
              aria-label="Previous page"
              disabled={busy || selected.indexOf(shownPage) <= 0}
              onClick={() =>
                setPreviewPage(selected[Math.max(0, selected.indexOf(shownPage) - 1)] ?? 1)
              }
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="min-w-24 text-center text-xs text-on-surface-variant">
              {progress ?? `Page ${shownPage} of ${pageCount || 1}`}
            </p>
            <Button
              variant="neutral"
              size="sm"
              aria-label="Next page"
              disabled={busy || selected.indexOf(shownPage) >= selected.length - 1}
              onClick={() =>
                setPreviewPage(
                  selected[Math.min(selected.length - 1, selected.indexOf(shownPage) + 1)] ?? 1,
                )
              }
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-center text-[11px] leading-relaxed text-on-surface-variant">
            Exactly what the printer receives — the same pages are drawn into the job.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
