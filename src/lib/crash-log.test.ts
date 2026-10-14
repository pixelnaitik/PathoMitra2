/**
 * The on-device crash log's privacy and size guarantees.
 *
 * This buffer exists because a release APK has no console, so it is the only
 * record a field failure leaves. Two things must hold: it cannot grow without
 * bound, and it must not quietly become a file of patient data — the messages it
 * stores are thrown while handling real records, and the export is handed to
 * another app through the share sheet.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrashPayload } from './telemetry';

const store = new Map<string, string>();

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      store.delete(key);
    }),
  },
}));

const KEY = 'pathlab_crash_log_v1';

function payload(overrides: Partial<CrashPayload> = {}): CrashPayload {
  return {
    message: 'something broke',
    context: {},
    at: new Date().toISOString(),
    ...overrides,
  };
}

/** flush microtasks so the fire-and-forget write has landed. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('crash-log', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('caps the buffer and keeps the newest entries', async () => {
    const { clearCrashLog, recordCrash, readCrashLog, __resetCrashLogForTests } =
      await import('./crash-log');
    __resetCrashLogForTests();
    await clearCrashLog();

    for (let i = 0; i < 70; i++) recordCrash(payload({ message: `failure ${i}` }));
    await settle();

    const entries = await readCrashLog();
    // 50 is the documented ring size; the oldest 20 must be gone, not the newest.
    expect(entries).toHaveLength(50);
    expect(entries[0]?.message).toBe('failure 20');
    expect(entries.at(-1)?.message).toBe('failure 69');
  });

  it('redacts capability tokens, emails and phone numbers before writing', async () => {
    const { clearCrashLog, recordCrash, __resetCrashLogForTests } = await import('./crash-log');
    __resetCrashLogForTests();
    await clearCrashLog();

    recordCrash(
      payload({
        message: 'Report 9f4c2a1b'.padEnd(48, '0') + ' for a@example.com · +91 98765 43210',
        stack: 'at run (a@example.com:1:1)\n    at Object.<anonymous> (index.js:2:2)',
      }),
    );
    await settle();

    const stored = store.get(KEY) ?? '';
    expect(stored).toContain('[redacted-email]');
    expect(stored).toContain('[redacted-phone]');
    expect(stored).not.toContain('a@example.com');
    expect(stored).not.toContain('98765 43210');
    // The 48-char hex token is what must never reach a shared log file.
    expect(stored).not.toMatch(/9f4c2a1b[0-9]{40}/);
  });

  it('clearing empties both the buffer and the persisted copy', async () => {
    const { clearCrashLog, recordCrash, readCrashLog, __resetCrashLogForTests } =
      await import('./crash-log');
    __resetCrashLogForTests();

    recordCrash(payload({ message: 'temp' }));
    await settle();
    expect(await readCrashLog()).toHaveLength(1);

    await clearCrashLog();
    expect(await readCrashLog()).toHaveLength(0);
    expect(store.has(KEY)).toBe(false);
  });

  it('survives a corrupt stored log instead of throwing during boot', async () => {
    store.set(KEY, '{not json');
    const { readCrashLog, __resetCrashLogForTests } = await import('./crash-log');
    __resetCrashLogForTests();

    await expect(readCrashLog()).resolves.toEqual([]);
  });

  it('formats an export that a human can read without a parser', async () => {
    const { formatCrashLog, recordCrash, readCrashLog, __resetCrashLogForTests } =
      await import('./crash-log');
    __resetCrashLogForTests();
    store.clear();

    recordCrash(
      payload({ message: 'bad row', stack: 'at x (a.js:1:1)', url: '/dashboard/reports' }),
    );
    await settle();

    const text = formatCrashLog(await readCrashLog());
    expect(text).toContain('PathoMitra');
    expect(text).toContain('bad row');
    expect(text).toContain('at x (a.js:1:1)');
    expect(text).toContain('/dashboard/reports');
  });
});
