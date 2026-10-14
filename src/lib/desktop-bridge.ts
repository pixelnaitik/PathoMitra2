/**
 * Renderer-side view of the Electron shell.
 *
 * `electron/preload.ts` injects `window.pathomitraDesktop` only in the desktop
 * build; on web and Android it is `undefined`, so every existing code path
 * keeps working untouched and the platform check is one cheap property read —
 * the same role `Capacitor.isNativePlatform()` plays for the APK.
 *
 * The shape here must stay in lockstep with the preload's `api` object; the
 * preload is a sandboxed CJS bundle and cannot import from `src/`, so the
 * pairing is enforced by matching channel names, not by the compiler.
 */

/** Result of a desktop file write — superset of the Android SavedFile shape. */
export interface DesktopSavedResult {
  name: string;
  uri: string;
  /** Absolute Windows path — meaningful to the lab operator, unlike the Android one. */
  path: string;
  /** False when it landed in public Documents (the allowPublicExports opt-in). */
  isPrivate: boolean;
}

/**
 * What the operator chose in the desktop print prompt. Mirrors `PrintChoice` in
 * `electron/print.ts`; the two sides are paired by channel name, not by the
 * compiler, so the union has to be written twice.
 */
export type DesktopPrintChoice = 'printed' | 'opened' | 'cancelled';

/** One entry of `webContents.getPrintersAsync()`, narrowed to what the UI needs. */
export interface DesktopPrinter {
  /** OS name — this is what `deviceName` must be given. */
  name: string;
  /** Name as shown in the OS print UI. */
  displayName: string;
  /** Longer description of the printer type. */
  description: string;
  /** The system default. The dialog still lets the operator move off it. */
  isDefault: boolean;
}

/** How the page image is fitted to the sheet. Mirrors `PrintScaleMode`. */
export type DesktopPrintScale = 'fit' | 'actual' | 'shrink';

/** Everything the main process needs to hand one job to the spooler. */
export interface DesktopPrintRequest {
  /** Job name for the spooler and the temp file. */
  title: string;
  /**
   * Already-rendered pages, in print order, each rotated to the chosen sheet
   * orientation. Rasterised by pdf.js in the renderer — Electron ships no PDF
   * viewer, so a PDF file cannot be printed by the spooler directly.
   */
  pages: string[];
  /** Sheet size in mm as it leaves the printer. */
  sheetWidthMm: number;
  sheetHeightMm: number;
  /** The rendered image's own box in mm — drives `actual` / `shrink` fitting. */
  imageWidthMm: number;
  imageHeightMm: number;
  options: {
    deviceName: string;
    copies: number;
    collate: boolean;
    duplex: 'simplex' | 'shortEdge' | 'longEdge';
    landscape: boolean;
    /** `A4` | `A5` | `Letter` | `Legal` — passed to `pageSize` unless custom. */
    pageSize: string;
    scale: DesktopPrintScale;
  };
}

export interface DesktopPrintResult {
  ok: boolean;
  /** The spooler's own words when `ok` is false. */
  error?: string;
}

export interface DesktopBridge {
  readonly kind: 'desktop';
  readonly version: string;
  db: {
    init(): Promise<void>;
    load(entity: string): Promise<string | null>;
    save(entity: string, json: string): Promise<void>;
    clear(): Promise<void>;
    /**
     * Write several collections as ONE atomic main-process SQLite transaction.
     * Backs `DesktopRepository.transaction()` so a multi-collection change (a
     * report amendment and its history row; a restore) commits together or not
     * at all — the desktop counterpart of the native store's real transaction.
     */
    commit(entries: Array<{ entity: string; json: string }>): Promise<void>;
  };
  files: {
    save(args: {
      relPath: string;
      data: string;
      base64: boolean;
      publicFirst: boolean;
    }): Promise<DesktopSavedResult>;
    readText(rel: string): Promise<string>;
    list(relDir: string, extension?: string): Promise<string[]>;
    uri(rel: string): Promise<string>;
    /** Delete one app-owned file (a stored backup snapshot), private root only. */
    remove(rel: string): Promise<void>;
    /**
     * The app's print prompt for a file that already exists on disk. The main
     * process asks (print now / choose printer / open in PDF viewer / cancel)
     * and reports the choice; `opened` only ever happens when the operator picks
     * it — printing never opens the viewer by itself.
     */
    print(args: { filePath: string }): Promise<DesktopPrintChoice>;
  };
  /** The in-app print dialog's backend. */
  print: {
    /** Installed printers, from `webContents.getPrintersAsync()`. */
    printers(): Promise<DesktopPrinter[]>;
    /**
     * Spool an already-rendered job. Resolves with the spooler's verdict — the
     * call is not optimistic: `ok` is true only when Chromium reported success.
     */
    job(request: DesktopPrintRequest): Promise<DesktopPrintResult>;
  };
  shell: {
    /** Open with the user's default handler — the desktop stand-in for both
     *  the Android share sheet and the PdfViewerPlugin ACTION_VIEW. */
    show(target: string): Promise<void>;
  };
  keyring: {
    set(account: string, secret: string): Promise<void>;
    get(account: string): Promise<string | null>;
    remove(account: string): Promise<boolean>;
  };
}

declare global {
  interface Window {
    pathomitraDesktop?: DesktopBridge;
  }
}

/** True only inside the Electron desktop build. */
export function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && window.pathomitraDesktop?.kind === 'desktop';
}

/** The bridge when present — every call site still branches on null first. */
export function desktopBridge(): DesktopBridge | null {
  return isDesktopShell() ? (window.pathomitraDesktop ?? null) : null;
}
