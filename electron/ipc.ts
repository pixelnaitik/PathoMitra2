/**
 * The IPC surface between the sandboxed renderer and the main process.
 *
 * Every channel is allow-listed here — the preload only exposes these shapes,
 * never raw ipcRenderer. Paths are validated in the MAIN process (the renderer
 * is the untrusted side in Electron's threat model): anything filesystem-ish
 * must resolve inside an app-owned root, so a compromised page cannot ask for
 * `C:\Users\...\Desktop\...` or walk out with `..`.
 *
 * Roots mirror the Android storage policy in `src/lib/native-files.ts`:
 *   private → app userData (the only root when public exports are off),
 *   public  → Documents/PathoMitra (opt-in per lab, world-readable).
 * The app-relative layout (`PathoMitra/Backups/...`) is kept identical so the
 * backup picker code paths look the same on both platforms.
 */
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { clearEntities, loadEntity, openDatabase, saveEntitiesBulk, saveEntity } from './db';
import { deleteSecret, getSecret, setSecret } from './keyring';
import { isRendererCredentialAccount } from '../src/lib/renderer-credentials';
import { printPdfFile } from './print';
import { type PrintJobRequest, type PrintJobResult, listPrinters, printJob } from './print-window';

/** Collection names from src/data/types.ts — anything else is refused. */
const ENTITIES = new Set([
  'users',
  'patients',
  'doctors',
  'reports',
  'reportNotes',
  'reportVersions',
  'invoices',
  'labSettings',
  'notificationState',
  'meta',
]);

function assertEntity(entity: unknown): string {
  if (typeof entity !== 'string' || !ENTITIES.has(entity)) {
    throw new Error(`unknown collection: ${String(entity)}`);
  }
  return entity;
}

/**
 * The renderer may only name credentials in its own namespace (see
 * `src/lib/renderer-credentials.ts`). The generic keyring channels used to
 * forward any account string, so `get('db-key')` would have handed a compromised
 * page the SQLCipher key; the allow-list refuses `db-key` and every unknown
 * name at the trusted (main-process) boundary.
 */
function assertRendererAccount(account: unknown): string {
  if (typeof account !== 'string') throw new Error('bad keyring args');
  if (!isRendererCredentialAccount(account)) {
    throw new Error(`credential not accessible from the renderer: ${account}`);
  }
  return account;
}

/** Containment test used by both guards; case-insensitive on Windows paths. */
function contains(root: string, abs: string): boolean {
  const r = process.platform === 'win32' ? root.toLowerCase() : root;
  const a = process.platform === 'win32' ? abs.toLowerCase() : abs;
  return a === r || a.startsWith(r + path.sep);
}

/**
 * Join `rel` onto `root`, refusing any escape. The first check is lexical;
 * when the target exists its *real* path is checked too, so a symlink or
 * directory junction placed inside the root cannot point out of it (this is
 * what the module header promises — the lexical check alone would not).
 */
function within(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  if (!contains(root, abs)) {
    throw new Error(`path escapes the app storage root: ${rel}`);
  }

  // Resolve the nearest existing ancestor, not only the final target. A new
  // file under an existing symlink/junction makes realpathSync(abs) fail with
  // ENOENT, which used to skip the real-path check and permit an escaped write.
  const realRoot = fs.realpathSync(root);
  let candidate = abs;
  while (true) {
    try {
      const realCandidate = fs.realpathSync(candidate);
      if (!contains(realRoot, realCandidate)) {
        throw new Error(`path resolves outside the app storage root: ${rel}`);
      }
      break;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('path resolves')) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw new Error(`could not validate storage path: ${rel}`);
      candidate = parent;
    }
  }
  return abs;
}
const privateRoot = (): string => app.getPath('userData');

/**
 * Roots a renderer may name with an absolute path — only the folders the app
 * itself writes into (see `saveFile`). Anything else (a path to someone else's
 * document, a file on a network share) is refused: printing and `shell.openPath`
 * both launch things, so they are the most dangerous paths in the surface.
 */
function withinAppRoots(abs: string): string {
  const normalized = path.resolve(abs);
  const roots = [privateRoot(), app.getPath('documents')];
  if (!roots.some(root => contains(root, normalized))) {
    throw new Error(`path is outside the app's own folders: ${abs}`);
  }
  return normalized;
}

/**
 * Resolve whatever the renderer named for a print/open request. `{ filePath }`
 * is the print channel's shape; a bare string still works because the file
 * helpers pass app-relative paths (`PathoMitra/Backups/x.json`) to `pm:shell:show`.
 */
function resolveTarget(target: unknown): string {
  const value =
    typeof target === 'string'
      ? target
      : target && typeof target === 'object'
        ? (target as { filePath?: unknown }).filePath
        : undefined;
  if (typeof value !== 'string' || !value) throw new Error('a filePath is required');
  return path.isAbsolute(value) ? withinAppRoots(value) : within(privateRoot(), value);
}

interface SaveArgs {
  /** App-relative path, e.g. `PathoMitra/Report - John.pdf`; never absolute. */
  relPath: string;
  data: string;
  base64: boolean;
  /** Mirrors candidateDirectories(): public Documents first, step down to private. */
  publicFirst: boolean;
}

function saveFile(args: SaveArgs): { name: string; uri: string; path: string; isPrivate: boolean } {
  if (!args.relPath || path.isAbsolute(args.relPath) || /^[a-zA-Z]:/.test(args.relPath)) {
    throw new Error('save path must be app-relative');
  }
  const buffer = args.base64 ? Buffer.from(args.data, 'base64') : Buffer.from(args.data, 'utf8');
  const attempts: Array<{ root: string; isPrivate: boolean }> = args.publicFirst
    ? [
        { root: app.getPath('documents'), isPrivate: false },
        { root: privateRoot(), isPrivate: true },
      ]
    : [{ root: privateRoot(), isPrivate: true }];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const abs = within(attempt.root, args.relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buffer);
      return {
        name: path.basename(abs),
        uri: pathToFileURL(abs).href,
        path: abs,
        isPrivate: attempt.isPrivate,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('could not write the file');
}

export function registerIpc(): void {
  /* Database façade -------------------------------------------------------- */
  ipcMain.handle('pm:db:init', async () => {
    await openDatabase();
  });
  ipcMain.handle('pm:db:load', (_e, entity: unknown) => loadEntity(assertEntity(entity)));
  ipcMain.handle('pm:db:save', (_e, entity: unknown, json: unknown) => {
    const name = assertEntity(entity);
    if (typeof json !== 'string') throw new Error('db payload must be a JSON string');
    // Parse-on-write: the encrypted file must never hold something the
    // renderer could not have produced — cheap structural guard.
    JSON.parse(json);
    saveEntity(name, json);
  });
  ipcMain.handle('pm:db:clear', () => clearEntities());
  /**
   * Atomic multi-collection write (see `saveEntitiesBulk`). Each entry is
   * validated exactly like a single `pm:db:save` — allow-listed collection name,
   * JSON string payload — and the whole batch is committed inside one SQLite
   * transaction, so the renderer's `transaction()` is only ever atomic or not at
   * all, never half-applied.
   */
  ipcMain.handle('pm:db:commit', (_e, entries: unknown) => {
    if (!Array.isArray(entries)) throw new Error('db commit expects an array of collections');
    const rows = entries.map(entry => {
      const row = entry as { entity?: unknown; json?: unknown } | null;
      const name = assertEntity(row?.entity);
      if (typeof row?.json !== 'string') throw new Error('db payload must be a JSON string');
      JSON.parse(row.json); // the encrypted file must never hold something unparseable
      return { entity: name, json: row.json };
    });
    saveEntitiesBulk(rows);
  });

  /* Files ------------------------------------------------------------------ */
  ipcMain.handle('pm:files:save', (_e, args: SaveArgs) => saveFile(args));
  ipcMain.handle('pm:files:readText', (_e, rel: unknown) => {
    if (typeof rel !== 'string') throw new Error('bad path');
    return fs.readFileSync(within(privateRoot(), rel), 'utf8');
  });
  ipcMain.handle('pm:files:list', (_e, relDir: unknown, extension: unknown) => {
    if (typeof relDir !== 'string') throw new Error('bad path');
    const dir = within(privateRoot(), relDir);
    const ext = typeof extension === 'string' ? extension : '';
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isFile() && (!ext || entry.name.endsWith(ext)))
        .map(entry => entry.name)
        .sort((a, b) => b.localeCompare(a));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  });
  ipcMain.handle('pm:files:uri', (_e, rel: unknown) => {
    if (typeof rel !== 'string') throw new Error('bad path');
    return pathToFileURL(within(privateRoot(), rel)).href;
  });
  /**
   * Delete one app-owned file (the backup list's "delete old snapshots").
   * Confined to the private root like every other files channel, non-recursive
   * (a directory is refused), and narrowed further to the two backup folders
   * the renderer actually lists — a compromised page still cannot wipe the
   * Electron profile or the WAL sidecars of the database.
   */
  ipcMain.handle('pm:files:delete', (_e, rel: unknown) => {
    if (typeof rel !== 'string') throw new Error('bad path');
    const root = privateRoot();
    const abs = within(root, rel);
    const backupDirs = ['PathoMitra/Backups', 'PathLab OS/Backups'].map(dir =>
      path.resolve(root, dir),
    );
    if (!backupDirs.some(dir => abs.startsWith(dir + path.sep))) {
      throw new Error(`only backup snapshots may be deleted here: ${rel}`);
    }
    fs.rmSync(abs, { force: true });
  });

  /* Print + shell ---------------------------------------------------------- */
  /**
   * Print a file that already exists (the saved report): the native print-or-
   * open prompt lives in `print.ts`. Window-modal, so the prompt belongs to the
   * window that asked for it.
   */
  ipcMain.handle('pm:files:print', (event, target: unknown) => {
    const abs = resolveTarget(target);
    return printPdfFile(abs, BrowserWindow.fromWebContents(event.sender) ?? undefined);
  });
  /** Open with the user's default handler, or reveal in Explorer. */
  ipcMain.handle('pm:shell:show', async (_e, target: unknown) => {
    const abs = resolveTarget(target);
    const err = await shell.openPath(abs);
    if (err) throw new Error(err);
  });

  /* In-app print dialog ---------------------------------------------------- */
  /** Installed printers for the dialog's dropdown. */
  ipcMain.handle('pm:print:printers', event =>
    listPrinters(BrowserWindow.fromWebContents(event.sender) ?? undefined),
  );
  /**
   * Spool a job the dialog already rendered. The payload is a page list of PNG
   * data URLs — untrusted input by Electron's rules — so the shape is checked
   * here and every page is re-checked in `print-window.ts` before it reaches the
   * generated document. Failures come back as `{ ok: false }` rather than a
   * rejection: the dialog shows them inline, it does not crash on them.
   */
  ipcMain.handle(
    'pm:print:job',
    (event, request: unknown): Promise<PrintJobResult> | PrintJobResult => {
      const job = request as Partial<PrintJobRequest> | null;
      if (
        !job ||
        !Array.isArray(job.pages) ||
        typeof job.options?.deviceName !== 'string' ||
        typeof job.sheetWidthMm !== 'number' ||
        typeof job.sheetHeightMm !== 'number'
      ) {
        return { ok: false, error: 'The print job was not well formed.' };
      }
      return printJob(
        job as PrintJobRequest,
        BrowserWindow.fromWebContents(event.sender) ?? undefined,
      );
    },
  );

  /* Secure storage (Windows Credential Manager) ---------------------------- */
  /**
   * The auth records the UI legitimately needs, all namespaced `pathlab_*`. The
   * database key is deliberately unreachable here — `assertRendererAccount`
   * denies `db-key` and any name outside the renderer namespace, so this surface
   * cannot read, overwrite or delete the SQLCipher key.
   */
  ipcMain.handle('pm:keyring:set', (_e, account: unknown, secret: unknown) => {
    const name = assertRendererAccount(account);
    if (typeof secret !== 'string') throw new Error('bad keyring args');
    return setSecret(name, secret);
  });
  ipcMain.handle('pm:keyring:get', (_e, account: unknown) =>
    getSecret(assertRendererAccount(account)),
  );
  ipcMain.handle('pm:keyring:delete', (_e, account: unknown) =>
    deleteSecret(assertRendererAccount(account)),
  );
}
