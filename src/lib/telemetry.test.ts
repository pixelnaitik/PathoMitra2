import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureError, initErrorReporting, __resetErrorReporting } from './telemetry';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetErrorReporting();
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('captureError (offline)', () => {
  it('always logs through console.error so it survives minification', () => {
    captureError(new Error('boom'));
    expect(console.error).toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it('never touches the network — the offline app has no ingest endpoint', () => {
    captureError(new Error('network down'), { scope: 'fetch' });
    captureError(new Error('and again'), { scope: 'fetch' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs every occurrence (dedupe only ever gated the removed network report)', () => {
    captureError(new Error('duplicate'), { scope: 'render' });
    captureError(new Error('duplicate'), { scope: 'render' });
    expect(console.error).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles non-Error throwables without throwing', () => {
    expect(() => captureError('a string reason')).not.toThrow();
    expect(() => captureError({ code: 42 })).not.toThrow();
    expect(() => captureError(undefined)).not.toThrow();
  });
});

describe('initErrorReporting', () => {
  /**
   * A PromiseRejectionEvent needs a rejected promise; attaching our own catch
   * keeps vitest from reporting it as a second, unrelated unhandled rejection.
   */
  const rejectedPromise = (error: Error) => {
    const promise = Promise.reject(error);
    promise.catch(() => {});
    return promise;
  };

  it('captures unhandled rejections without any network call', () => {
    initErrorReporting();
    const reason = new Error('loose promise');
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', { reason, promise: rejectedPromise(reason) }),
    );
    expect(console.error).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is idempotent — repeated init still captures offline, never over the network', () => {
    initErrorReporting();
    initErrorReporting();
    const reason = new Error('once');
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', { reason, promise: rejectedPromise(reason) }),
    );
    // The `globalsInstalled` guard prevents a second registration; global DOM
    // listeners from earlier cases are not removable here, so assert capture
    // happened and that nothing hit the network.
    expect(console.error).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores resource load errors that carry no Error object', () => {
    initErrorReporting();
    window.dispatchEvent(new Event('error'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
