/**
 * Getting a generated document onto the device, and off it again.
 *
 * The WebView cannot download: jsPDF's `doc.save()` and the anchor-with-
 * `URL.createObjectURL()` trick both rely on a `DownloadListener` / blob nav
 * that Android's WebView simply does not have, so "Download" and "Export CSV"
 * silently did nothing in the APK. `navigator.share` is not implemented in the
 * WebView either (only in Chrome itself), so the share button fell through to a
 * `wa.me` link the WebView also ignores.
 *
 * Everything the app produces therefore goes through this module: write the
 * bytes with `@capacitor/filesystem`, then hand the resulting `file://` URI to
 * `@capacitor/share` so the user picks the destination (Drive, WhatsApp, Files,
 * Save to device) from the system sheet. The FileProvider declared in
 * AndroidManifest + res/xml/file_paths.xml is what turns that file:// URI into
 * a grantable content:// one.
 *
 * On web every function is a no-op passthrough that keeps the old browser
 * behaviour, and none of the native plugins are even loaded there.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Directory as DirectoryKind } from '@capacitor/filesystem';
import { desktopBridge } from './desktop-bridge';
import { readSettings } from './settings';

/** Sub-folder inside the app's storage area that generated documents land in. */
const OUTPUT_SUBDIR = 'PathoMitra';

/** A file that now exists on the device. */
export interface SavedFile {
  /** File name as it was written, e.g. `Report - John Doe.pdf`. */
  name: string;
  /** `file://` URI the Share plugin accepts (it converts to content://). */
  uri: string;
  /** Absolute filesystem path, shown to the user after a bare save. */
  path: string;
  /** Desktop only: false when the file landed in public Documents. */
  private?: boolean;
}

/** Directory names the plugin understands, used as the storage policy keys. */
type DirName = 'Documents' | 'External' | 'Data';

/**
 * Where generated documents are allowed to go.
 *
 * `Directory.Data` is app-private: no other app, file manager or media indexer
 * can read it. `Documents` and `External` are world-readable shared storage.
 * The report PDFs and CSV exports written here contain patient names, findings
 * and billing amounts, so they used to be the wrong default — the old order put
 * a signed pathology report in `/storage/emulated/0/Documents/` in plaintext,
 * outside the SQLCipher boundary, while the privacy policy said every record sat
 * in the encrypted database.
 *
 * Public storage is now opt-in per laboratory via Settings → Data & Diagnostics,
 * because some labs genuinely want to browse the files themselves.
 */
function candidateDirectories(): DirName[] {
  return readSettings().allowPublicExports ? ['Documents', 'External', 'Data'] : ['Data'];
}

export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

/** Which shell wraps the shared web bundle: the APK, the Electron window, or neither. */
export type ShellKind = 'web' | 'android' | 'desktop';

export function getShellKind(): ShellKind {
  if (desktopBridge()) return 'desktop';
  if (isNativeShell()) return 'android';
  return 'web';
}

/**
 * True when the runtime has real file output (the Electron bridge or the
 * APK's Filesystem plugin) — the condition every "hand the bytes to the OS"
 * path branches on. Web falls through to browser downloads, which still work.
 */
export function hasShellOutput(): boolean {
  return getShellKind() !== 'web';
}

/**
 * Normalise a name for the filesystem. Report titles carry patient names, and
 * `/ \ : * ? " < > |` are rejected on Android (and Windows) — a slash in a
 * patient's name used to be enough to make the write fail.
 */
export function safeFileName(input: string): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    // A leading dot hides the file from every file manager.
    .replace(/^\.+/, '');
  // Keep well under Android's 255-byte limit, leaving room for the suffix a
  // collision check may add.
  return (cleaned || 'document').slice(0, 180);
}

type FilesystemModule = typeof import('@capacitor/filesystem');

async function loadFilesystem(): Promise<FilesystemModule> {
  return import('@capacitor/filesystem');
}

/**
 * Write `data` on the device and return where it went.
 *
 * @param data base64 payload when `encoding` is undefined (the plugin's binary
 *   mode), or the literal text when `encoding` is `'utf8'`.
 */
async function writeOnDevice(
  filename: string,
  data: string,
  encoding?: 'utf8',
): Promise<SavedFile> {
  const name = safeFileName(filename);
  const bridge = desktopBridge();
  if (bridge) {
    // Desktop: same policy, enforced in the main process (public Documents is
    // the lab's opt-in, app-private userData is always the fallback).
    const saved = await bridge.files.save({
      relPath: `${OUTPUT_SUBDIR}/${name}`,
      data,
      base64: encoding !== 'utf8',
      publicFirst: candidateDirectories().includes('Documents'),
    });
    return { name: saved.name, uri: saved.uri, path: saved.path, private: saved.isPrivate };
  }
  const fs = await loadFilesystem();
  const { Directory, Encoding } = fs;
  const path = `${OUTPUT_SUBDIR}/${name}`;
  const byName: Record<DirName, DirectoryKind> = {
    Documents: Directory.Documents,
    External: Directory.External,
    Data: Directory.Data,
  };

  let lastError: unknown = null;
  for (const candidate of candidateDirectories()) {
    try {
      const written = await fs.Filesystem.writeFile({
        path,
        data,
        directory: byName[candidate],
        // Create `PathoMitra/` on the first save.
        recursive: true,
        ...(encoding === 'utf8' ? { encoding: Encoding.UTF8 } : {}),
      });
      return { name, uri: written.uri, path };
    } catch (err) {
      lastError = err;
      // Reached only when public exports have been switched on and a scoped-
      // storage rule refused the write — falling through to the app-private
      // directory is the intended path, not an error.
      console.warn(`PathoMitra: could not write to ${candidate}, trying the next directory`, err);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Could not write the file on this device.');
}

/**
 * Save a base64-encoded binary document (a PDF) on the device.
 * @returns where it landed, for the caller's confirmation toast.
 */
export async function saveBinaryDocument(filename: string, base64: string): Promise<SavedFile> {
  return writeOnDevice(filename, base64);
}

/**
 * Save a text document (CSV export, JSON backup) on the device. */
export async function saveTextDocument(filename: string, text: string): Promise<SavedFile> {
  return writeOnDevice(filename, text, 'utf8');
}

/* -------------------------------------------------------------------------- */
/* Files the app owns and reads back later                                     */
/* -------------------------------------------------------------------------- */

/**
 * The app-private external directory: always writable with no runtime
 * permission, visible to a file manager or a USB-connected PC, and survives an
 * app update. Used for anything the app must find again — backups above all.
 *
 * `writeOnDevice` above deliberately steps *down* from the public Documents
 * folder when a device refuses it, which is right for a one-off export but
 * useless for a file we intend to re-open: the reader would not know which
 * directory it landed in. These helpers never guess.
 */
async function appExternal() {
  const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem');
  return { Directory, Encoding, Filesystem };
}

/** Write a text file at an exact app-relative path. */
export async function writeAppTextFile(path: string, text: string): Promise<SavedFile> {
  const bridge = desktopBridge();
  if (bridge) {
    // App-owned files (backups above all) always land in the private root —
    // the same "never guess the directory" rule as the Android path.
    const saved = await bridge.files.save({
      relPath: path,
      data: text,
      base64: false,
      publicFirst: false,
    });
    return { name: path.split('/').pop() ?? path, uri: saved.uri, path: saved.path, private: true };
  }
  const { Directory, Encoding, Filesystem } = await appExternal();
  const written = await Filesystem.writeFile({
    path,
    data: text,
    directory: Directory.External,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  return { name: path.split('/').pop() ?? path, uri: written.uri, path };
}

/** Read back a file written by {@link writeAppTextFile}. */
export async function readAppTextFile(path: string): Promise<string> {
  const bridge = desktopBridge();
  if (bridge) return bridge.files.readText(path);
  const { Directory, Encoding, Filesystem } = await appExternal();
  const result = await Filesystem.readFile({
    path,
    directory: Directory.External,
    encoding: Encoding.UTF8,
  });
  if (typeof result.data !== 'string') throw new Error(`Could not read ${path} as text.`);
  return result.data;
}

/** Names of the files directly inside an app-relative directory. */
export async function listAppFiles(dir: string, extension?: string): Promise<string[]> {
  const bridge = desktopBridge();
  if (bridge) {
    try {
      return await bridge.files.list(dir, extension);
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  }
  const { Directory, Filesystem } = await appExternal();
  try {
    const listing = await Filesystem.readdir({ path: dir, directory: Directory.External });
    return listing.files
      .filter(info => info.type === 'file' && (!extension || info.name.endsWith(extension)))
      .map(info => info.name)
      .sort((a, b) => b.localeCompare(a));
  } catch (err) {
    // A folder that was never created simply means there is nothing to list.
    if (isMissing(err)) return [];
    throw err;
  }
}

/**
 * Delete a file written by {@link writeAppTextFile}.
 *
 * Same three-way split as every other app-files helper: the Electron bridge
 * (which confines the delete to the private root in the main process), the
 * Capacitor plugin on the APK, the web filesystem in the browser. Deleting a
 * desktop backup through the *plugin* would target the WebView's OPFS, not the
 * folder the snapshot was written to — the delete would always miss.
 */
export async function deleteAppFile(path: string): Promise<void> {
  const bridge = desktopBridge();
  if (bridge) {
    await bridge.files.remove(path);
    return;
  }
  const { Directory, Filesystem } = await appExternal();
  await Filesystem.deleteFile({ path, directory: Directory.External });
}

/** The `file://` URI for a path in the app's own storage, for sharing. */
export async function getAppFileUri(path: string): Promise<string> {
  const bridge = desktopBridge();
  if (bridge) return bridge.files.uri(path);
  const { Directory, Filesystem } = await appExternal();
  return (await Filesystem.getUri({ path, directory: Directory.External })).uri;
}

/** True when a plugin rejection is a plain "not found" rather than a failure. */
export function isMissing(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return (
    message.includes('does not exist') ||
    message.includes('enoent') ||
    message.includes('not found')
  );
}

/**
 * Show the system share sheet for a file already on the device.
 *
 * @throws when the sheet could not be opened at all — the caller still holds
 *   the saved file, so it can fall back to telling the user where it is.
 */
export async function shareSavedFile(file: SavedFile, title: string, text?: string): Promise<void> {
  const bridge = desktopBridge();
  if (bridge) {
    // Windows has no unified share sheet. The honest desktop equivalent of
    // "hand it to another app" is opening the file with the user's default
    // handler (mail client, WhatsApp Desktop, Drive sync folder — their call).
    // The caller's catch-and-report path stays intact because failures reject.
    await bridge.shell.show(file.path);
    return;
  }
  const { Share } = await import('@capacitor/share');
  await Share.share({
    title,
    ...(text ? { text } : {}),
    files: [file.uri],
    dialogTitle: title,
  });
}

/* -------------------------------------------------------------------------- */
/* Opening a saved file in another app's viewer                                */
/* -------------------------------------------------------------------------- */

/** The app-defined Android plugin behind {@link openSavedFileInViewer}. */
interface PdfViewerPlugin {
  openFile(options: { uri: string; mimeType: string }): Promise<void>;
}

let pdfViewer: PdfViewerPlugin | null = null;

/**
 * Open a file already on the device in whatever app the system resolves for
 * its type — for report PDFs, the device's PDF viewer (Chrome, Drive, an OEM
 * reader).
 *
 * The WebView cannot render a PDF itself, so "preview" on the APK means handing
 * the saved copy to an ACTION_VIEW intent, raised by PdfViewerPlugin in the
 * Android project. The plugin converts the file:// URI into a content:// one
 * through the manifest's FileProvider; without that grant the viewing app
 * could not read a file inside this app's storage.
 *
 * @throws when no installed app can open the type — the caller then decides
 *   what the fallback experience is.
 */
export async function openSavedFileInViewer(file: SavedFile, mimeType: string): Promise<void> {
  const bridge = desktopBridge();
  if (bridge) {
    void mimeType; // the OS picks the handler by extension; the hint is Android's job
    await bridge.shell.show(file.path);
    return;
  }
  // registerPlugin is a pure-JS factory: the native side is looked up by name
  // at call time, so nothing native loads on web, where this is never called.
  if (!pdfViewer) pdfViewer = registerPlugin<PdfViewerPlugin>('PdfViewer');
  await pdfViewer.openFile({ uri: file.uri, mimeType });
}

/** Share a file that already lives in the app's own storage. */
export async function shareAppFile(
  path: string,
  name: string,
  title: string,
  text?: string,
): Promise<void> {
  await shareSavedFile({ name, uri: await getAppFileUri(path), path }, title, text);
}

/** Save and share in one step — the normal "Share report" gesture. */
export async function shareDocument(
  filename: string,
  base64: string,
  title: string,
  text?: string,
): Promise<SavedFile> {
  const file = await saveBinaryDocument(filename, base64);
  await shareSavedFile(file, title, text);
  return file;
}

/**
 * Human-readable destination for a save confirmation. `getExternalFilesDir`
 * paths are unintelligible, so name the app folder rather than the raw path
 * when it is outside anything the user can browse to.
 */
export function describeSavedLocation(file: SavedFile): string {
  if (typeof file.private === 'boolean') {
    // Desktop: absolute Windows paths are meaningful to the operator, so name
    // the real location and flag the one case they cannot browse to.
    return file.private
      ? `${file.path} (private to the app — other programs and File Explorer cannot open it)`
      : file.path;
  }
  const decoded = (() => {
    try {
      return decodeURIComponent(file.uri);
    } catch {
      return file.uri;
    }
  })();
  return decoded.startsWith('file:///storage/emulated/0/Documents/')
    ? `Documents/${OUTPUT_SUBDIR}/${file.name}`
    : `${OUTPUT_SUBDIR}/${file.name} (private to this app — other apps and file managers cannot open it)`;
}
