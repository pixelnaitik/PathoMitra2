/**
 * The PDF output contract, across both platforms.
 *
 * `window.open` returns `null` whenever its feature string contains `noopener`
 * — *even when the tab did open*. Reading that `null` as "blocked" made every
 * single PDF preview report a blocked pop-up, in the web build and in the APK
 * (where `window.open` is refused outright and nothing was ever opened). The
 * mock below follows the spec, so a passing suite means the feature string
 * stayed clean and the native paths kept their fallbacks.
 *
 * The save/share cases exist because the WebView has no download handler and no
 * `navigator.share`: a regression there is invisible (the tap simply does
 * nothing), so the only way to catch it is to assert the plugin call happens.
 *
 * The desktop cases exist because Windows printing is *also* invisible — the
 * shell verb spools with no UI — and the failure mode reported twice was the
 * PDF viewer opening in place of a print job. So they assert the print channel
 * is the one that is called, and that `shell.show` (open with the default
 * handler) is not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import type { jsPDF } from 'jspdf';
import { previewPdf, printPdf, printSavedFile, savePdf, sharePdf } from './native-print';
import type { SavedFile } from './native-files';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn() },
  // The native preview path reaches the app-defined PdfViewer plugin through
  // registerPlugin; the proxy only has to record the openFile call.
  registerPlugin: vi.fn(() => ({ openFile })),
}));
const { openFile } = vi.hoisted(() => ({ openFile: vi.fn() }));
const printBase64 = vi.fn();
vi.mock('@capgo/capacitor-printer', () => ({ Printer: { printBase64 } }));

const writeFile = vi.fn();
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile },
  Directory: { Documents: 'DOCUMENTS', External: 'EXTERNAL', Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
}));

/**
 * Which storage the save helper is allowed to use is a settings decision now:
 * app-private unless the lab opted into shared Documents. Flipping this flag is
 * how the tests below exercise both policies without touching localStorage.
 */
const { storagePolicy } = vi.hoisted(() => ({
  storagePolicy: { allowPublicExports: false },
}));
vi.mock('./settings', () => ({
  readSettings: () => ({ allowPublicExports: storagePolicy.allowPublicExports }),
  SETTINGS_STORAGE_KEY: 'pathologyos_settings',
  writeSettings: () => {},
}));
const share = vi.fn();
vi.mock('@capacitor/share', () => ({ Share: { share } }));

/** A jsPDF that only has to answer what the helpers actually call. */
function fakeDoc() {
  return {
    output: vi.fn((type?: string) =>
      type === 'datauristring' ? 'data:application/pdf;base64,JVBERi0xLg==' : 'blob:report',
    ),
    save: vi.fn(),
    autoPrint: vi.fn(),
  };
}

const asDoc = (doc: ReturnType<typeof fakeDoc>) => doc as unknown as jsPDF;

/** Stands in for a browser that really opened the tab. */
function stubOpen(allowed: boolean) {
  const open = vi.fn((url: string, _target?: string, features?: string) => {
    // The spec behaviour that broke the preview: noopener ⇒ no window handle.
    if (features?.includes('noopener')) return null;
    return allowed ? { url, document: { title: '' } } : null;
  });
  vi.stubGlobal('open', open);
  return open;
}

/**
 * Stand in for the Electron preload's `window.pathomitraDesktop`. The desktop
 * legs are decided by which of these methods gets called, so the mocks record
 * the call instead of asserting a UI nobody can see from a test.
 */
function stubDesktop(choice: 'printed' | 'opened' | 'cancelled' = 'printed') {
  const path = 'C:\\Users\\lab\\AppData\\Roaming\\PathoMitra\\PathoMitra\\report-42.pdf';
  const filesSave = vi.fn().mockResolvedValue({
    name: 'report-42.pdf',
    uri: `file:///${path}`,
    path,
    isPrivate: true,
  });
  const filesPrint = vi.fn().mockResolvedValue(choice);
  const shellShow = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('pathomitraDesktop', {
    kind: 'desktop',
    version: '44.7.0',
    files: { save: filesSave, print: filesPrint },
    shell: { show: shellShow },
  });
  return { path, filesSave, filesPrint, shellShow };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
  writeFile.mockResolvedValue({ uri: 'file:///sdcard/PathoMitra/report-42.pdf' });
  share.mockResolvedValue({ activityType: '' });
  openFile.mockResolvedValue(undefined);
});

describe('previewPdf in a browser', () => {
  it('reports success when the tab opens, and names the tab after the file', async () => {
    const open = stubOpen(true);
    const doc = fakeDoc();

    expect(await previewPdf(asDoc(doc), 'report-42.pdf')).toBeNull();
    // Exactly two arguments: any feature string is where `noopener` crept in.
    expect(open).toHaveBeenCalledWith('blob:report', '_blank');
    // The handle only exists because no feature string was passed; naming it is
    // what makes the viewer offer "report-42.pdf" on save.
    expect((open.mock.results[0]?.value as { document: { title: string } }).document.title).toBe(
      'report-42.pdf',
    );
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('hands over the file when the tab is genuinely refused', async () => {
    stubOpen(false);
    const doc = fakeDoc();

    const message = await previewPdf(asDoc(doc), 'report-42.pdf');
    expect(message).toContain('downloaded');
    expect(doc.save).toHaveBeenCalledWith('report-42.pdf');
  });
});

describe('printPdf', () => {
  it('arms autoPrint and opens the blob in a browser', async () => {
    const open = stubOpen(true);
    const doc = fakeDoc();

    await printPdf(asDoc(doc), 'report-42.pdf');
    expect(doc.autoPrint).toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
  });

  it('falls back to a download when the print tab is refused', async () => {
    stubOpen(false);
    const doc = fakeDoc();

    await printPdf(asDoc(doc), 'report-42.pdf');
    expect(doc.save).toHaveBeenCalledWith('report-42.pdf');
  });

  it('drives the system print sheet on native and never touches window.open', async () => {
    const open = stubOpen(true);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const doc = fakeDoc();

    await printPdf(asDoc(doc), 'report-A4.pdf');
    // The plugin wants bare base64, not the data URI jsPDF hands out.
    expect(printBase64).toHaveBeenCalledWith({
      data: 'JVBERi0xLg==',
      mimeType: 'application/pdf',
      name: 'report-A4.pdf',
    });
    expect(open).not.toHaveBeenCalled();
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('previews on native in the device PDF viewer, not the print sheet', async () => {
    const open = stubOpen(false);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const doc = fakeDoc();

    // The WebView refuses window.open and cannot render a PDF, so the APK
    // writes the file and hands it to the PdfViewer plugin's ACTION_VIEW
    // intent. The print sheet must stay out of it — that is the behaviour the
    // preview tap used to produce and users read as "printing, not viewing".
    expect(await previewPdf(asDoc(doc), 'report-A4.pdf')).toBeNull();
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ data: 'JVBERi0xLg==' }));
    expect(openFile).toHaveBeenCalledWith({
      uri: 'file:///sdcard/PathoMitra/report-42.pdf',
      mimeType: 'application/pdf',
    });
    expect(printBase64).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('falls back to the print sheet when the device has no PDF viewer', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    openFile.mockRejectedValue(new Error('No app on this device can open this file'));
    const doc = fakeDoc();

    // A device with no PDF-capable app must still show something, and the
    // warning message says why the print sheet appeared instead.
    const message = await previewPdf(asDoc(doc), 'report-A4.pdf');
    expect(message).toContain('print sheet');
    expect(printBase64).toHaveBeenCalled();
  });
});

describe('printPdf on the Windows desktop shell', () => {
  it('writes the report, prints it by path, and never routes through the shell open', async () => {
    const desktop = stubDesktop();
    const open = stubOpen(true);
    const doc = fakeDoc();

    expect(await printPdf(asDoc(doc), 'report-42.pdf')).toBe('printed');
    // The printed artifact is a real file in the app folder: the Windows shell
    // verb needs a path, and a temp copy can be deleted under the PDF handler.
    expect(desktop.filesSave).toHaveBeenCalledWith(
      expect.objectContaining({ base64: true, relPath: 'PathoMitra/report-42.pdf' }),
    );
    expect(desktop.filesPrint).toHaveBeenCalledWith({ filePath: desktop.path });
    // The bug this pins down: opening the file with the default handler is the
    // *viewer* path, and must not be what a print tap does.
    expect(desktop.shellShow).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('reports the choice the operator made instead of guessing', async () => {
    stubDesktop('cancelled');
    expect(await printPdf(asDoc(fakeDoc()), 'report-42.pdf')).toBe('cancelled');

    stubDesktop('opened');
    expect(await printPdf(asDoc(fakeDoc()), 'report-42.pdf')).toBe('opened');
  });

  it('leaves the Android print sheet alone while the desktop bridge is absent', async () => {
    // The same call on the APK: no bridge means the plugin path, unchanged.
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    expect(await printPdf(asDoc(fakeDoc()), 'report-42.pdf')).toBeNull();
    expect(printBase64).toHaveBeenCalledWith({
      data: 'JVBERi0xLg==',
      mimeType: 'application/pdf',
      name: 'report-42.pdf',
    });
  });
});

describe('printSavedFile', () => {
  it('prints an existing file through the desktop print prompt', async () => {
    const desktop = stubDesktop();
    const file: SavedFile = { name: 'report-42.pdf', uri: 'file:///x', path: desktop.path };

    expect(await printSavedFile(file)).toBe('printed');
    expect(desktop.filesPrint).toHaveBeenCalledWith({ filePath: desktop.path });
  });

  it('refuses rather than silently opening a viewer on other shells', async () => {
    const file: SavedFile = {
      name: 'report-42.pdf',
      uri: 'file:///sdcard/PathoMitra/report-42.pdf',
      path: 'PathoMitra/report-42.pdf',
    };

    await expect(printSavedFile(file)).rejects.toThrow(/Windows app/);
  });
});

describe('savePdf', () => {
  it('uses the browser download in a browser', async () => {
    const doc = fakeDoc();

    expect(await savePdf(asDoc(doc), 'report-42.pdf')).toBeNull();
    expect(doc.save).toHaveBeenCalledWith('report-42.pdf');
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('writes the decoded payload through the Filesystem plugin on device', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const doc = fakeDoc();

    const message = await savePdf(asDoc(doc), 'report-42.pdf');
    // `doc.save()` is a silent no-op in the WebView, so the plugin call *is* the
    // fix — and the toast has to name a location the user can actually find.
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ data: 'JVBERi0xLg==' }));
    expect(message).toContain('report-42.pdf');
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('steps down to the app-private directory when a public one refuses', async () => {
    // Opt-in public storage: Documents, then External, then the private fallback.
    storagePolicy.allowPublicExports = true;
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    writeFile
      .mockRejectedValueOnce(new Error('Failed to write file: EACCES (Permission denied)'))
      .mockRejectedValueOnce(new Error('Failed to write file: EACCES (Permission denied)'))
      .mockResolvedValueOnce({
        uri: 'file:///sdcard/Android/data/com.pathomitra.app/files/PathoMitra/report-42.pdf',
      });

    expect(await savePdf(asDoc(fakeDoc()), 'report-42.pdf')).toContain('report-42.pdf');
    expect(writeFile).toHaveBeenCalledTimes(3);
    // Scoped storage (Android 11+) blocks raw writes to Directory.Documents; a
    // retry must move to the next candidate, not repeat the doomed one.
    expect(writeFile.mock.calls[0][0].directory).toBe('DOCUMENTS');
    expect(writeFile.mock.calls[1][0].directory).toBe('EXTERNAL');
    expect(writeFile.mock.calls[2][0].directory).toBe('DATA');
  });

  it('keeps exports inside app-private storage unless the lab opted in', async () => {
    // The default. Report PDFs carry patient data, and shared Documents is
    // readable by other apps, so nothing goes there without the setting on.
    storagePolicy.allowPublicExports = false;
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    writeFile.mockResolvedValueOnce({
      uri: 'file:///data/user/0/com.pathomitra.app/files/PathoMitra/report-42.pdf',
    });

    const message = await savePdf(asDoc(fakeDoc()), 'report-42.pdf');

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][0].directory).toBe('DATA');
    expect(message).toContain('private to this app');
  });

  it('refuses to report success when every directory failed', async () => {
    storagePolicy.allowPublicExports = true;
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    writeFile.mockRejectedValue(new Error('disk full'));

    await expect(savePdf(asDoc(fakeDoc()), 'report-42.pdf')).rejects.toThrow(
      /disk full|could not write/i,
    );
  });
});

describe('sharePdf', () => {
  it('raises the system share sheet with the saved file attached', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

    const message = await sharePdf(
      asDoc(fakeDoc()),
      'report-42.pdf',
      'Diagnostic Report',
      'For John Doe',
    );
    expect(message).toBeNull();
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        files: ['file:///sdcard/PathoMitra/report-42.pdf'],
        title: 'Diagnostic Report',
        text: 'For John Doe',
      }),
    );
  });

  it('says nothing when the user pulls back out of the sheet', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    share.mockRejectedValue(new Error('User cancelled the share sheet'));

    expect(await sharePdf(asDoc(fakeDoc()), 'report-42.pdf', 'Diagnostic Report')).toBeNull();
  });

  it('reports the saved location when no app will take the file', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    share.mockRejectedValue(new Error('No Activity found to handle Intent'));

    // The PDF is on the device either way; a bare "sharing failed" would send
    // the user hunting for a file that already exists.
    expect(await sharePdf(asDoc(fakeDoc()), 'report-42.pdf', 'Diagnostic Report')).toContain(
      'report-42.pdf',
    );
  });

  it('uses Web Share in a browser that has it, and downloads where it is missing', async () => {
    const doc = fakeDoc();
    const webShare = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'share', { configurable: true, value: webShare });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });

    expect(await sharePdf(asDoc(doc), 'report-42.pdf', 'Diagnostic Report')).toBeNull();
    expect(webShare).toHaveBeenCalledWith(expect.objectContaining({ title: 'Diagnostic Report' }));
    expect(doc.save).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();

    webShare.mockClear();
    canShare.mockReturnValue(false);
    const message = await sharePdf(asDoc(doc), 'report-42.pdf', 'Diagnostic Report');
    expect(webShare).not.toHaveBeenCalled();
    expect(doc.save).toHaveBeenCalledWith('report-42.pdf');
    expect(message).toContain('downloaded');

    delete (navigator as { share?: unknown }).share;
    delete (navigator as { canShare?: unknown }).canShare;
  });
});
