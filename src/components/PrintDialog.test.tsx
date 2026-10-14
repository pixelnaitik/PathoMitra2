/**
 * The Windows print sheet, against a stubbed Electron bridge.
 *
 * These tests exist because the dialog is the only thing standing between a lab
 * and the wrong pages on the wrong printer, and its contract with the main
 * process (`deviceName`, sheet mm, the exact page list) is invisible to the
 * compiler — the preload is a separate CJS bundle. If a payload field drifts,
 * this is where it fails.
 *
 * pdf.js is mocked: jsdom has no 2D canvas, and the raster quality is pdf.js's
 * problem, not the dialog's.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PrintDialog, type PrintJob } from './PrintDialog';
import type { DesktopPrinter } from '../lib/desktop-bridge';

const { openPdf, renderPageInto, renderPageToPng, saveBinaryDocument, printSavedFile } = vi.hoisted(
  () => ({
    openPdf: vi.fn(),
    renderPageInto: vi.fn(),
    renderPageToPng: vi.fn(),
    saveBinaryDocument: vi.fn(),
    printSavedFile: vi.fn(),
  }),
);

vi.mock('../lib/pdf-preview', () => ({ openPdf, renderPageInto, renderPageToPng }));
vi.mock('../lib/native-files', () => ({ saveBinaryDocument }));
vi.mock('../lib/native-print', () => ({ printSavedFile }));

const PRINTERS: DesktopPrinter[] = [
  { name: 'Adobe PDF', displayName: 'Adobe PDF', description: '', isDefault: true },
  { name: 'HP LaserJet', displayName: 'HP LaserJet Pro', description: '', isDefault: false },
];

const JOB: PrintJob = {
  title: 'Report — Anita',
  filename: 'anita_lab_report.pdf',
  pdfBase64: 'AAA',
};

function stubBridge(jobResult: { ok: boolean; error?: string } = { ok: true }) {
  const printJob = vi.fn().mockResolvedValue(jobResult);
  const printers = vi.fn().mockResolvedValue(PRINTERS);
  vi.stubGlobal('pathomitraDesktop', {
    kind: 'desktop',
    version: '44.7.0',
    print: { printers, job: printJob },
    files: { print: vi.fn().mockResolvedValue('printed') },
    shell: { show: vi.fn() },
  });
  return { printJob, printers };
}

function stubDocument(pageCount = 4) {
  openPdf.mockResolvedValue({
    doc: {},
    pageCount,
    pageWidthMm: 210,
    pageHeightMm: 297,
    destroy: vi.fn().mockResolvedValue(undefined),
  });
  renderPageInto.mockResolvedValue(undefined);
  renderPageToPng.mockImplementation(
    async (_pdf: unknown, { pageNumber }: { pageNumber: number }) =>
      `data:image/png;base64,cGFnZS0${pageNumber}`,
  );
}

/** Opens the dialog and waits for the document + printer list to arrive. */
async function renderDialog(bridge = stubBridge()) {
  stubDocument();
  render(<PrintDialog open job={JOB} onClose={vi.fn()} />);
  await waitFor(() => expect(bridge.printers).toHaveBeenCalled());
  return bridge;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PrintDialog', () => {
  it('lists the printers and refuses to preselect the virtual default', async () => {
    await renderDialog();
    const picker = await screen.findByRole('combobox', { name: 'Printer' });
    expect(picker).toHaveTextContent('HP LaserJet Pro');
    expect(picker).toHaveTextContent('Adobe PDF');
    // "Adobe PDF" is the system default on this machine and writes a file, so
    // preselecting it is how the old flow came to look like "the PDF app opened".
    expect((picker as HTMLSelectElement).value).toBe('HP LaserJet');
  });

  it('blocks the job on a page range that does not parse', async () => {
    await renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const field = screen.getByRole('textbox', { name: 'Page numbers' });
    fireEvent.change(field, { target: { value: '1-99' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/Page 99 does not exist/);
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
  });

  it('prints exactly the selected pages to the chosen printer', async () => {
    const { printJob } = await renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Page numbers' }), {
      target: { value: '2-3' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Copies' }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));

    await waitFor(() => expect(printJob).toHaveBeenCalled());
    const [request] = printJob.mock.calls[0];
    expect(request.pages).toHaveLength(2);
    expect(request.options).toMatchObject({
      deviceName: 'HP LaserJet',
      copies: 2,
      collate: true,
      duplex: 'simplex',
      pageSize: 'A4',
    });
    // A4 portrait: 210 × 297 mm, and the image box matches the document.
    expect(request.sheetWidthMm).toBeCloseTo(210);
    expect(request.sheetHeightMm).toBeCloseTo(297);
    expect(request.imageWidthMm).toBeCloseTo(210);
    expect(request.imageHeightMm).toBeCloseTo(297);
    expect(request.pages[0]).toContain('data:image/png;base64,');
  });

  it('swaps the sheet and rotates the pages for landscape', async () => {
    const { printJob } = await renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }));
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));

    await waitFor(() => expect(printJob).toHaveBeenCalled());
    const [request] = printJob.mock.calls[0];
    expect(request.sheetWidthMm).toBeCloseTo(297);
    expect(request.sheetHeightMm).toBeCloseTo(210);
    // The raster carries the rotation, so the print pipeline gets one source of
    // truth for orientation and cannot rotate the page twice.
    expect(renderPageToPng).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rotationDeg: 90 }),
    );
  });

  it('reports the spooler’s own failure instead of pretending success', async () => {
    const bridge = stubBridge({ ok: false, error: 'printer is offline' });
    await renderDialog(bridge);
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(bridge.printJob).toHaveBeenCalled());
    expect(await screen.findByRole('alert')).toHaveTextContent('printer is offline');
  });

  it('keeps the vector escape hatch wired to the shell-verb path', async () => {
    await renderDialog();
    saveBinaryDocument.mockResolvedValue({ name: 'f.pdf', uri: 'file:///f', path: 'C:\\f.pdf' });
    printSavedFile.mockResolvedValue('printed');
    fireEvent.click(screen.getByRole('button', { name: /^Advanced/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Print via the PDF app' }));
    await waitFor(() => expect(printSavedFile).toHaveBeenCalled());
  });
});
