/**
 * Sandboxed preload — the ONLY bridge between the renderer (the shared web
 * bundle) and the main process.
 *
 * Bundled separately to `dist-electron/preload.cjs` (sandboxed preload scripts
 * must be CJS and may only require('electron')). Nothing here imports app
 * code or native modules; the surface is plain `ipcRenderer.invoke` wrappers
 * matching `src/lib/desktop-bridge.ts`, which is the typed consumer on the
 * renderer side.
 */
import { contextBridge, ipcRenderer } from 'electron';

/** Mirror of `PrintChoice` in electron/print.ts (a sandboxed preload imports nothing). */
type PrintChoice = 'printed' | 'opened' | 'cancelled';

/** Mirror of `DesktopPrinter` in src/lib/desktop-bridge.ts. */
type PrinterEntry = {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
};

const api = {
  kind: 'desktop' as const,
  version: process.versions.electron,

  db: {
    init: (): Promise<void> => ipcRenderer.invoke('pm:db:init'),
    load: (entity: string): Promise<string | null> => ipcRenderer.invoke('pm:db:load', entity),
    save: (entity: string, json: string): Promise<void> =>
      ipcRenderer.invoke('pm:db:save', entity, json),
    clear: (): Promise<void> => ipcRenderer.invoke('pm:db:clear'),
    /** Write several collections as ONE main-process SQLite transaction. */
    commit: (entries: Array<{ entity: string; json: string }>): Promise<void> =>
      ipcRenderer.invoke('pm:db:commit', entries),
  },

  files: {
    save: (
      args: Readonly<{ relPath: string; data: string; base64: boolean; publicFirst: boolean }>,
    ): Promise<{ name: string; uri: string; path: string; isPrivate: boolean }> =>
      ipcRenderer.invoke('pm:files:save', args),
    readText: (rel: string): Promise<string> => ipcRenderer.invoke('pm:files:readText', rel),
    list: (relDir: string, extension?: string): Promise<string[]> =>
      ipcRenderer.invoke('pm:files:list', relDir, extension),
    uri: (rel: string): Promise<string> => ipcRenderer.invoke('pm:files:uri', rel),
    /** Delete one app-owned file (a stored backup snapshot). Main process
     *  confines it to the private root and refuses the database files. */
    remove: (rel: string): Promise<void> => ipcRenderer.invoke('pm:files:delete', rel),
    /**
     * The app's print prompt for a file on disk (see electron/print.ts): the
     * main process asks the operator — print now / choose printer / open in the
     * PDF viewer / cancel — and reports which one was chosen. Opening the viewer
     * is never the default.
     */
    print: (args: Readonly<{ filePath: string }>): Promise<PrintChoice> =>
      ipcRenderer.invoke('pm:files:print', { filePath: args.filePath }),
  },

  /**
   * The in-app print dialog's backend. The job payload is forwarded untouched —
   * it is validated in the main process, which is the trusted side.
   */
  print: {
    printers: (): Promise<PrinterEntry[]> => ipcRenderer.invoke('pm:print:printers'),
    job: (request: unknown): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('pm:print:job', request),
  },

  shell: {
    /** Open a saved file with the user's default handler (the desktop stand-in
     *  for the Android share sheet AND the PdfViewerPlugin). */
    show: (target: string): Promise<void> => ipcRenderer.invoke('pm:shell:show', target),
  },

  keyring: {
    set: (account: string, secret: string): Promise<void> =>
      ipcRenderer.invoke('pm:keyring:set', account, secret),
    get: (account: string): Promise<string | null> => ipcRenderer.invoke('pm:keyring:get', account),
    remove: (account: string): Promise<boolean> => ipcRenderer.invoke('pm:keyring:delete', account),
  },
};

contextBridge.exposeInMainWorld('pathomitraDesktop', api);
