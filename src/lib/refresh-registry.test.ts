import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetRefreshRegistryForTests,
  registerRefreshHandler,
  runRegisteredRefreshes,
} from './refresh-registry';

/**
 * UI-P1-04 — the pull-to-refresh gesture used to fire an event, wait 900 ms,
 * and toast "You're up to date" whether or not anything reloaded. The registry
 * replaces that pattern: the gesture awaits every handler, and reports the
 * real outcome (all reloaded / partial / none). The tests below lock that
 * contract. If a future change makes runRegisteredRefreshes() claim success
 * for a rejected handler, or silently swallow one, these fail.
 */

afterEach(() => {
  // Handlers are module-scoped; drop every registration so the next test
  // starts from a known-empty registry.
  _resetRefreshRegistryForTests();
});

describe('refresh registry (UI-P1-04)', () => {
  it('reports total=0 when nothing registered — the caller must NOT toast success', () => {
    expect.assertions(1);
    return runRegisteredRefreshes().then(outcome => {
      expect(outcome).toEqual({ total: 0, fulfilled: 0, rejected: 0, ok: false });
    });
  });

  it('awaits every registered handler before resolving, so the UI cannot toast on a timer', async () => {
    let a = 0;
    let b = 0;
    const slow = new Promise<void>(resolve => setTimeout(() => (a += 1) && resolve(), 20));
    const fast = Promise.resolve().then(() => (b += 1));
    const unsubA = registerRefreshHandler(() => slow);
    const unsubB = registerRefreshHandler(() => fast);
    const outcome = await runRegisteredRefreshes();
    unsubA();
    unsubB();
    expect(outcome).toEqual({ total: 2, fulfilled: 2, rejected: 0, ok: true });
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('marks the outcome as partial when one handler rejects — never a blanket success', async () => {
    const unsub1 = registerRefreshHandler(() => Promise.resolve());
    const unsub2 = registerRefreshHandler(() => Promise.reject(new Error('locked db')));
    const unsub3 = registerRefreshHandler(() => {
      throw new Error('synchronous throw');
    });
    const outcome = await runRegisteredRefreshes();
    unsub1();
    unsub2();
    unsub3();
    expect(outcome.total).toBe(3);
    expect(outcome.fulfilled).toBe(1);
    expect(outcome.rejected).toBe(2);
    expect(outcome.ok).toBe(false);
  });

  it('unregistering a handler prevents it from running on the next refresh', async () => {
    const spy = vi.fn();
    const unsub = registerRefreshHandler(spy);
    unsub();
    const outcome = await runRegisteredRefreshes();
    expect(spy).not.toHaveBeenCalled();
    expect(outcome.total).toBe(0);
  });
});
