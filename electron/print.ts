/**
 * Printing a finished report PDF on Windows.
 *
 * Electron ships no PDF viewer (Chromium's viewer component is not included), so
 * there is no in-window document to hand to a print API, and `shell.printFile()`
 * does not exist in Electron's API surface (checked against
 * `node_modules/electron/electron.d.ts`: `shell` exposes `openPath`, `openExternal`,
 * `showItemInFolder` … nothing print-related). The only way to get the file into
 * the Windows print pipeline is the shell verb — `Print` (spool to the default
 * printer) or `PrintTo` (spool to a named printer) — which is what the
 * registered PDF handler itself offers in Explorer's context menu.
 *
 * Owner decision 2026-10-11, after "the PDF app opens instead of printing" was
 * reported twice: the action asks the operator, and the viewer is never the
 * default.
 *
 *   Print now            → shell verb `Print`   — spools via the PDF handler.
 *   Choose printer…      → listed printers, then shell verb `PrintTo` with the
 *                          chosen name — the closest thing to a printer picker a
 *                          foreign file type allows.
 *   Open in PDF viewer   → `shell.openPath` — opt-in only (the viewer's own
 *                          Ctrl+P is then the operator's next keystroke).
 *   Cancel               → nothing happens.
 *
 * Two failure modes this module exists to kill:
 *   1. `Start-Process -Verb …` reports failure as a *non-terminating* error, so
 *      powershell.exe still exits 0. Reading only the exit code made a failed
 *      print look like a successful one. The script prints a sentinel instead.
 *   2. A lab whose default printer is a virtual one (Adobe PDF, Microsoft Print
 *      to PDF, OneNote) "prints" into a save dialog and reads as the PDF app
 *      opening. The prompt therefore names the default printer and flags the
 *      known virtual ones before the job is spooled.
 *
 * Known limit: no paper/duplex options here — that is the viewer path or
 * Windows' own print dialog, reachable through "Open in PDF viewer".
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { type BrowserWindow, dialog, shell } from 'electron';

/** What the operator chose in the print prompt. */
export type PrintChoice = 'printed' | 'opened' | 'cancelled';

/** Sentinels the PowerShell one-liner prints, so success is read from stdout. */
const OK = 'PM_PRINT_OK';
const FAIL = 'PM_PRINT_FAIL ';

/** Windows-only module in practice; other shells are dev machines for this app. */
const isWindows = (): boolean => process.platform === 'win32';

/**
 * `dialog.showMessageBox` is window-modal when given the window and app-modal
 * otherwise. The IPC handler passes the sender's window when it can resolve one.
 */
async function ask(
  parent: BrowserWindow | undefined,
  options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

/** A single-quoted PowerShell literal — quote doubling, no re-splitting on spaces. */
const psLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * Run `powershell.exe -Command <script>` and resolve with its stdout.
 *
 * No `-ExecutionPolicy` flag on purpose: policy governs script *files*, and a
 * domain machine can have it pinned by group policy — asking for `Bypass` there
 * fails the call outright, which would take printing down with it.
 */
function runPowerShell(script: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 64 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/**
 * Ask the shell to print `filePath` — silently, straight into the spooler.
 * @param printer when set the `PrintTo` verb is used and the name is passed as
 *   the verb's parameter (%2 in the handler's command template).
 * @throws with the Windows error text when the verb could not be carried out.
 */
export async function runShellVerb(filePath: string, printer?: string): Promise<void> {
  const verb = printer ? 'PrintTo' : 'Print';
  const args = printer ? ` -ArgumentList ${psLiteral(printer)}` : '';
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `  Start-Process -FilePath ${psLiteral(filePath)} -Verb ${verb}${args} -WindowStyle Hidden | Out-Null`,
    `  Write-Output '${OK}'`,
    '} catch {',
    `  Write-Output ('${FAIL}' + $_.Exception.Message)`,
    '}',
  ].join('\n');

  // Spawning a handler is not slow, but a busy spooler can hold the call; give
  // up rather than hanging the print action forever.
  const stdout = await runPowerShell(script, 30_000);
  const failure = stdout.split(/\r?\n/).find(line => line.startsWith(FAIL));
  if (failure) throw new Error(failure.slice(FAIL.length).trim() || 'the print verb failed');
  if (!stdout.includes(OK)) {
    throw new Error('Windows did not report the print job back to the app.');
  }
}

export interface PrintQueue {
  /** Every printer Windows reports, in enumeration order. */
  printers: string[];
  /** The default one, or null when Windows names none. */
  defaultPrinter: string | null;
}

/**
 * Read the printer list through WMI — the same source Explorer's print UI uses.
 * JSON rather than a delimited line format: printer names are free text an
 * operator can rename, so nothing about them can be used as a separator.
 */
export async function readPrintQueue(): Promise<PrintQueue> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Get-CimInstance Win32_Printer | Select-Object -Property Name,Default | ConvertTo-Json -Compress',
  ].join('\n');
  try {
    const stdout = (await runPowerShell(script, 15_000)).trim();
    const parsed: unknown = stdout ? JSON.parse(stdout) : [];
    const rows = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{
      Name?: unknown;
      Default?: unknown;
    }>;
    const printers: string[] = [];
    let defaultPrinter: string | null = null;
    for (const row of rows) {
      const name = typeof row.Name === 'string' ? row.Name.trim() : '';
      if (!name) continue;
      if (row.Default === true) defaultPrinter = name;
      printers.push(name);
    }
    return { printers, defaultPrinter };
  } catch {
    // A machine we cannot query still gets a working prompt; it just cannot name
    // or choose a printer, so the chooser is left out.
    return { printers: [], defaultPrinter: null };
  }
}

/**
 * Printers that write a file instead of paper. Named explicitly — the point is
 * to tell the operator where the job goes, not to guess about unknown devices.
 */
const isVirtualPrinter = (name: string): boolean =>
  /adobe pdf|microsoft print to pdf|onenote|xps|fax/i.test(name);

/** Native task-modal error + a route out. Never opens the viewer by itself. */
async function reportFailure(
  parent: BrowserWindow | undefined,
  filePath: string,
  reason: string,
): Promise<PrintChoice> {
  const { response } = await ask(parent, {
    type: 'error',
    buttons: ['Open in PDF viewer', 'Close'],
    defaultId: 0,
    cancelId: 1,
    title: 'Windows could not print the report',
    message: `Could not print ${path.basename(filePath)}`,
    detail: `${reason}\n\n“Open in PDF viewer” shows the file, where its own print command (Ctrl+P) can be used instead.`,
    noLink: true,
  });
  if (response !== 0) return 'cancelled';
  return openInViewer(filePath);
}

async function openInViewer(filePath: string): Promise<PrintChoice> {
  const openError = await shell.openPath(filePath);
  if (openError) throw new Error(openError);
  return 'opened';
}

/** The printer chooser — a second native task dialog, one button per printer. */
async function choosePrinter(
  parent: BrowserWindow | undefined,
  printers: string[],
): Promise<string | null> {
  // Windows stacks extra buttons, so keep the list readable; the cap only bites
  // on machines with many queued printers.
  const shown = printers.slice(0, 8);
  const { response } = await ask(parent, {
    type: 'question',
    buttons: [...shown, 'Back'],
    defaultId: 0,
    cancelId: shown.length,
    title: 'Choose a printer',
    message: 'Print this report to which printer?',
    detail: `Printers Windows reports on this machine (${shown.length}${
      printers.length > shown.length ? ' of ' + printers.length : ''
    }).`,
    noLink: true,
  });
  return response >= shown.length ? null : (shown[response] ?? null);
}

/**
 * The print entry point for a file that already exists on disk (the saved
 * report). Shows the app's native Windows print prompt and acts on the choice.
 *
 * @param parent the calling window, so the prompt is window-modal.
 * @throws only when the OS itself refused (`openPath` failed) — a failed print
 *   verb is reported in the error dialog and resolved as the operator's choice.
 */
export async function printPdfFile(filePath: string, parent?: BrowserWindow): Promise<PrintChoice> {
  if (!isWindows()) {
    // No shell print verb outside Windows. Reached only on a dev machine; the
    // shipped target is Windows, and this is the honest "the OS must do it".
    return openInViewer(filePath);
  }

  const queue = await readPrintQueue();
  const canChoose = queue.printers.length > 1;
  const buttons = [
    'Print now',
    ...(canChoose ? ['Choose printer…'] : []),
    'Open in PDF viewer',
    'Cancel',
  ];
  const openIndex = buttons.indexOf('Open in PDF viewer');

  const where = queue.defaultPrinter
    ? `“Print now” sends the report to the default printer: ${queue.defaultPrinter}.`
    : '“Print now” sends the report to whatever printer Windows marks as default.';
  // The one thing that turns a silent spool into "it opened the PDF app instead
  // of printing": a virtual default printer. Say so, and only point at the
  // chooser when the chooser is actually on the dialog.
  const virtual =
    queue.defaultPrinter && isVirtualPrinter(queue.defaultPrinter)
      ? `\nHeads up: “${queue.defaultPrinter}” writes a file, it does not print on paper${
          canChoose ? ' — pick a real printer with “Choose printer…”' : ''
        }.`
      : '';
  const chooser =
    queue.printers.length === 0
      ? '\nWindows reported no printer to choose from.'
      : canChoose
        ? '\n“Choose printer…” lists the printers Windows reports.'
        : '\nWindows reported only one printer on this machine.';
  const viewer = '\n“Open in PDF viewer” only shows the file — it does not print it.';

  const options = {
    type: 'question' as const,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    title: 'Print report',
    message: `Print ${path.basename(filePath)}?`,
    detail: `${where}${virtual}${chooser}${viewer}`,
    noLink: true,
  };
  const { response } = await ask(parent, options);

  if (response === buttons.length - 1) return 'cancelled';
  if (response === openIndex) return openInViewer(filePath);

  const picked =
    response === 0 ? undefined : ((await choosePrinter(parent, queue.printers)) ?? undefined);
  // “Back” from the chooser, or a chooser that returned nothing: leave the file
  // alone rather than printing to a printer nobody selected.
  if (response !== 0 && !picked) return 'cancelled';

  try {
    await runShellVerb(filePath, picked);
    return 'printed';
  } catch (err) {
    return reportFailure(parent, filePath, err instanceof Error ? err.message : String(err));
  }
}
