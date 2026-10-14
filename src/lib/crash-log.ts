/**
 * The on-device crash log.
 *
 * A release APK cannot be debugged and has no console to read, so before this
 * module a field failure left *no* trace at all: `telemetry.ts` deliberately
 * reports nothing over the network (the app has no INTERNET permission), and its
 * `console.error` only reaches logcat while the device is plugged into a cable.
 * That is the one moment a lab is not going to catch it.
 *
 * So the scrubbed payload telemetry already builds is kept locally, in a bounded
 * ring buffer, and surfaced in Settings → Diagnostics where staff can read it,
 * save it as a file, or clear it. Nothing is ever transmitted from here; the
 * user decides whether to attach the export to a support email.
 *
 * Privacy: entries hold error messages and the first few stack frames, and a
 * message thrown while handling a patient record can echo part of that record.
 * `telemetry.ts` truncates and keeps only the leading frames; on top of that
 * this log is stripped of anything shaped like a report token or an email before
 * it is written, the buffer is capped, and it lives in the app's own private
 * storage — never in a public directory.
 */
import type { CrashPayload } from './telemetry';

const STORAGE_KEY = 'pathlab_crash_log_v1';
/** Enough history to cover a shift without growing without bound. */
const MAX_ENTRIES = 50;

export interface CrashEntry extends CrashPayload {
  /** Monotonic id so the UI can key a list without exposing the message. */
  key: number;
}

/** Anything shaped like an identifier that must not leave in a log file. */
const REDACT = [
  // 32+ char hex capability tokens (the old verification ids).
  /\b[0-9a-f]{32,}\b/gi,
  // Emails and phone numbers typed into a form can end up in a validation message.
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  /\+?\d[\d\s-]{8,}\d/g,
] as const;

function redact(value: string | undefined): string | undefined {
  if (!value) return value;
  return value
    .replace(REDACT[0], '[redacted-id]')
    .replace(REDACT[1], '[redacted-email]')
    .replace(REDACT[2], '[redacted-phone]');
}

function sanitize(entry: CrashPayload): CrashPayload {
  return {
    ...entry,
    message: redact(entry.message) ?? '',
    stack: redact(entry.stack),
    name: redact(entry.name),
  };
}

/**
 * Preferences is the storage of record: it is app-private, synchronous enough
 * for an error path, and has a web implementation, so the same code covers the
 * browser build too. Imported lazily because a crash handler must never fail
 * because *its own* dependency could not load.
 */
async function store(): Promise<{
  get: (k: string) => Promise<string | null>;
  set: (k: string, v: string) => Promise<void>;
  remove: (k: string) => Promise<void>;
}> {
  const { Preferences } = await import('@capacitor/preferences');
  return {
    get: key => Preferences.get({ key }).then(result => result.value),
    set: (key, value) => Preferences.set({ key, value }),
    remove: key => Preferences.remove({ key }),
  };
}

/** In-process copy, so a burst of crashes cannot lose earlier ones to an async write. */
let buffer: CrashEntry[] = [];
let loaded = false;
let nextKey = 1;
/** Chain so concurrent appends cannot interleave a read-modify-write. */
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<CrashEntry[]> {
  if (loaded) return buffer;
  loaded = true;
  try {
    const raw = await (await store()).get(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        buffer = parsed.filter(
          (entry): entry is CrashEntry =>
            !!entry &&
            typeof entry === 'object' &&
            typeof (entry as CrashEntry).message === 'string',
        );
        nextKey = buffer.reduce((max, entry) => Math.max(max, entry.key + 1), 1);
      }
    }
  } catch {
    // A corrupt or unreadable log must not break the app, and must not be
    // reported through the very logger that just failed.
    buffer = [];
  }
  return buffer;
}

function persist(): Promise<void> {
  const snapshot = JSON.stringify(buffer);
  writeQueue = writeQueue
    .then(async () => {
      try {
        await (await store()).set(STORAGE_KEY, snapshot);
      } catch {
        /* nowhere left to fall back to; the in-memory copy still serves the UI */
      }
    })
    .catch(() => {});
  return writeQueue;
}

/**
 * Append one already-built payload. Called from `telemetry.ts` on every report,
 * so it never throws, never blocks the caller, and never re-enters the logger.
 */
export function recordCrash(payload: CrashPayload): void {
  void (async () => {
    try {
      await load();
      buffer = [...buffer, { ...sanitize(payload), key: nextKey++ }].slice(-MAX_ENTRIES);
      await persist();
    } catch {
      /* a failed log write must never become a second crash */
    }
  })();
}

/** Newest last. */
export async function readCrashLog(): Promise<CrashEntry[]> {
  return [...(await load())];
}

export async function clearCrashLog(): Promise<void> {
  await load();
  buffer = [];
  try {
    await (await store()).remove(STORAGE_KEY);
  } catch {
    /* nothing to remove */
  }
}

/** Plain-text form for the export file — readable without a parser. */
export function formatCrashLog(entries: CrashEntry[]): string {
  const header = [
    'PathoMitra — on-device diagnostics log',
    `Exported ${new Date().toISOString()}`,
    `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (newest last)`,
    '',
  ];
  return header
    .concat(
      entries.map(entry =>
        [
          `[${entry.at}] ${entry.name ?? 'Error'}: ${entry.message}`,
          entry.url ? `  at: ${entry.url}` : '',
          entry.stack
            ? `  stack:\n${entry.stack
                .split('\n')
                .map(line => `    ${line}`)
                .join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
    )
    .join('\n\n');
}

/** Reset for tests: forget the in-memory copy and the "already loaded" flag. */
export function __resetCrashLogForTests(): void {
  buffer = [];
  loaded = false;
  nextKey = 1;
  writeQueue = Promise.resolve();
}
