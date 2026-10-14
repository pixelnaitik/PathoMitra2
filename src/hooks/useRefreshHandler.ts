/**
 * useRefreshHandler — subscribe a view to the pull-to-refresh gesture.
 *
 * Replaces the raw `window.addEventListener('app:refresh', ...)` pattern with
 * one that hands back a promise, so the gesture can honestly say "reloaded"
 * or "failed" instead of firing a fixed-delay toast. See lib/refresh-registry.
 */
import { useEffect, useRef } from 'react';
import { registerRefreshHandler, type RefreshFn } from '../lib/refresh-registry';

export function useRefreshHandler(fn: RefreshFn, enabled = true): void {
  // Ref keeps the latest closure visible to the effect without re-subscribing
  // on every render — the registry stores a stable wrapper around `fnRef`.
  const fnRef = useRef<RefreshFn>(fn);
  // Update the ref in an effect, not during render: writing a ref in the render
  // body is impure and is flagged by the react-hooks rules.
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);
  useEffect(() => {
    if (!enabled) return;
    return registerRefreshHandler(() => fnRef.current());
  }, [enabled]);
}
