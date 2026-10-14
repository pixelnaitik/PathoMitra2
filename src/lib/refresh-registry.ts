/**
 * Refresh registry — one honest pull-to-refresh.
 *
 * The gesture used to fire an `app:refresh` CustomEvent, wait 900 ms, and then
 * toast "You're up to date" regardless of whether any consumer picked up the
 * event or whether the reloads succeeded. Two failures:
 *
 *  1. The toast asserted a completed operation the timer could not know
 *     anything about. Nothing on the screen had actually reloaded.
 *  2. If one reload threw (a locked file, a storage-availability hiccup), the
 *     UI still reported success.
 *
 * The registry lets a view say "I own some work that a refresh should trigger"
 * and hand back a promise. Pull-to-refresh awaits every registered promise
 * through `Promise.allSettled` and reports exactly one of three honest
 * outcomes: all reloaded / some failed / nothing to reload. Zero registered
 * consumers is a legitimate state — the dashboard data is live via
 * onSnapshot, and the pull-to-refresh gesture then has nothing to do, so we
 * say so instead of pretending.
 *
 * Consumers use `useRefreshHandler` (below) rather than calling this directly.
 */

export type RefreshFn = () => Promise<unknown> | unknown;

const handlers = new Set<RefreshFn>();

/**
 * Register a refresh handler. Returns the unsubscribe — call it in the effect
 * cleanup. Handlers run in registration order but their awaits overlap; a
 * slow loader does not block a fast one.
 */
export function registerRefreshHandler(fn: RefreshFn): () => void {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

/** Number of registered handlers — exposed for tests + diagnostics. */
export function refreshHandlerCount(): number {
  return handlers.size;
}

/**
 * Drop every registered handler. Test-only — production code paths never
 * bulk-unsubscribe (each consumer owns its own cleanup via the returned
 * unsubscribe). Exported so a test can guarantee an isolated starting state
 * without needing to know which handlers other files registered.
 */
export function _resetRefreshRegistryForTests(): void {
  handlers.clear();
}

export interface RefreshOutcome {
  /** Total handlers that ran (0 → nothing to refresh). */
  total: number;
  fulfilled: number;
  rejected: number;
  /** True when the run reached every registered handler without throwing. */
  ok: boolean;
}

/**
 * Run all handlers concurrently and settle the outcome. Never throws — a
 * rejected handler is reported through `rejected` so the caller can pick the
 * right toast tone.
 */
export async function runRegisteredRefreshes(): Promise<RefreshOutcome> {
  const fns = Array.from(handlers);
  if (fns.length === 0) return { total: 0, fulfilled: 0, rejected: 0, ok: false };
  // Promise.allSettled swallows individual rejections; a handler that throws
  // synchronously is still captured by wrapping in an async fn.
  const results = await Promise.allSettled(fns.map(async fn => await (async () => fn())()));
  const fulfilled = results.filter(r => r.status === 'fulfilled').length;
  const rejected = results.length - fulfilled;
  return { total: results.length, fulfilled, rejected, ok: rejected === 0 };
}
