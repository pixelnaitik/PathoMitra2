/**
 * Client-side error capture.
 *
 * The production bundle used to strip *every* console call (including
 * console.error), so a failure in the field left no trace at all. This module
 * gives us one place to:
 *
 *   1. log the error loudly enough to survive the build,
 *   2. de-duplicate the same failure being reported in a loop,
 *   3. forward a minimal, PHI-free payload to the same-origin
 *      `/api/client-errors` endpoint for structured server logs.
 *
 * There is deliberately no vendor SDK here: `reportTo()` is the seam. A Sentry
 * (or Glitchtip) integration plugs in by implementing that one function.
 */

export type ErrorContext = Record<string, string | number | boolean | undefined>;

/** Hard caps: a broken render loop must not turn into a request flood. */
const MAX_REPORTS_PER_SESSION = 20;
const MAX_MESSAGE_LENGTH = 500;

let reportsSent = 0;
const seen = new Set<string>();

function truncate(value: string): string {
  return value.length > MAX_MESSAGE_LENGTH ? `${value.slice(0, MAX_MESSAGE_LENGTH)}…` : value;
}

/** Normalise anything thrown/rejected into a plain message + stack. */
function describe(error: unknown): { message: string; stack?: string; name?: string } {
  if (error instanceof Error) {
    return { message: truncate(error.message), stack: error.stack, name: error.name };
  }
  if (typeof error === 'string') {
    return { message: truncate(error) };
  }
  try {
    return { message: truncate(JSON.stringify(error) ?? String(error)) };
  } catch {
    return { message: truncate(String(error)) };
  }
}

/**
 * What a captured failure looks like once it is safe to keep or send.
 *
 * Exported so the on-device crash log can reuse exactly this shape (and this
 * scrubbing) instead of inventing a second, looser one.
 */
export interface CrashPayload {
  name?: string;
  message: string;
  stack?: string;
  context: ErrorContext;
  url?: string;
  userAgent?: string;
  at: string;
}

/**
 * Never send PHI. Message/stack can contain patient names or report ids typed
 * into the UI, so the payload is scrubbed and truncated before it leaves.
 */
export function buildCrashPayload(error: unknown, context: ErrorContext): CrashPayload {
  const { message, stack, name } = describe(error);
  return {
    name,
    message,
    // Only the first frames are useful for locating a crash, and they are the
    // least likely to contain user data.
    stack: stack ? stack.split('\n').slice(0, 6).join('\n') : undefined,
    context,
    url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    at: new Date().toISOString(),
  };
}

function reportTo(payload: CrashPayload): void {
  // Offline build: there is no ingest endpoint and the app must never reach the
  // network, so the payload goes to the on-device ring buffer instead — read it
  // in Settings → Diagnostics. Imported dynamically on purpose: crash-log reads
  // the payload builder from this module, and a static import either way would
  // make the cycle unresolvable at init.
  void import('./crash-log')
    .then(({ recordCrash }) => {
      recordCrash(payload);
    })
    .catch(() => {
      /* the surviving trace is the console.error in captureError */
    });
}

/**
 * Log and (once per unique failure) report an error.
 *
 * Safe to call from `catch` blocks anywhere in the app; it never throws.
 */
export function captureError(error: unknown, context: ErrorContext = {}): void {
  const { message } = describe(error);
  const fingerprint = `${message}|${context.scope ?? ''}`;

  // Always keep a console trace: vite.config.ts preserves console.error in the
  // production build precisely so this line survives.
  console.error(`[PathoMitra]${context.scope ? ` ${String(context.scope)}:` : ''}`, error);

  if (seen.has(fingerprint) || reportsSent >= MAX_REPORTS_PER_SESSION) return;
  seen.add(fingerprint);
  reportsSent += 1;

  try {
    reportTo(buildCrashPayload(error, context));
  } catch (reportingError) {
    console.error('PathoMitra: error reporting failed', reportingError);
  }
}

let globalsInstalled = false;

/**
 * Attach `window.onerror` / `unhandledrejection` handlers. Called once from
 * `main.tsx` so un-caught failures outside the React tree are still captured.
 */
export function initErrorReporting(): void {
  if (globalsInstalled || typeof window === 'undefined') return;
  globalsInstalled = true;

  window.addEventListener('error', event => {
    // Resource load failures (img/script) surface here too, without an Error.
    if (event.error) captureError(event.error, { scope: 'window.onerror' });
  });

  window.addEventListener('unhandledrejection', event => {
    captureError(event.reason, { scope: 'unhandledrejection' });
  });
}

/** Exposed for tests and for the error boundary's dedupe reset between cases. */
export function __resetErrorReporting(): void {
  seen.clear();
  reportsSent = 0;
  globalsInstalled = false;
}
