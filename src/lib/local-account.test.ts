import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The secure store is Keystore-backed on device and localStorage-backed in the
 * browser; both are irrelevant here, so it is replaced with a plain map and the
 * tests exercise the real hashing + lockout logic.
 */
const store = new Map<string, unknown>();
vi.mock('./secure-store', () => ({
  secureGet: async <T>(key: string): Promise<T | null> =>
    store.has(key) ? (store.get(key) as T) : null,
  secureSet: async <T>(key: string, value: T): Promise<void> => {
    store.set(key, value);
  },
  secureRemove: async (key: string): Promise<void> => {
    store.delete(key);
  },
}));

const { createAccount, verifyAccountPassword, getAccount, changePassword, MAX_FREE_ATTEMPTS } =
  await import('./local-account');

type UnlockResult = Awaited<ReturnType<typeof verifyAccountPassword>>;

/**
 * Asserts a refusal that is specifically a lockout of `waitSeconds`. Narrowing
 * has to go through `ok` first and then `reason`, because both failure variants
 * lack the success shape — doing it inline makes every assertion unreadable.
 */
function expectLocked(result: UnlockResult, waitSeconds: number): void {
  if (result.ok) throw new Error('expected a refusal, got a successful unlock');
  if (result.reason !== 'locked') throw new Error(`expected lockout, got '${result.reason}'`);
  expect(result.waitSeconds).toBe(waitSeconds);
}

/** Asserts a plain wrong-passcode refusal, with the countdown it reports. */
function expectWrong(result: UnlockResult, attemptsLeft: number): void {
  if (result.ok) throw new Error('expected a refusal, got a successful unlock');
  if (result.reason !== 'wrong')
    throw new Error(`expected a plain refusal, got '${result.reason}'`);
  expect(result.attemptsLeft).toBe(attemptsLeft);
}

/**
 * Lockout behaviour. The unlock secret is a short PIN, so without a delay an
 * attacker holding the device could walk the whole keyspace; the backoff has to
 * live in the store layer, not the screen, or any UI could bypass it.
 */
describe('local account lockout', () => {
  const PIN = '4417';

  beforeEach(() => {
    store.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts the correct passcode and stores no plaintext', async () => {
    await createAccount('Dr Test', PIN, false);
    const result = await verifyAccountPassword(PIN);
    expect(result).toEqual({ ok: true });

    const raw = JSON.stringify([...store.entries()]);
    expect(raw).not.toContain(PIN);
    expect((await getAccount())?.password.alg).toBe('pbkdf2-sha256');
  });

  it('counts down the remaining free attempts without locking', async () => {
    await createAccount('Dr Test', PIN, false);
    for (let i = 1; i <= MAX_FREE_ATTEMPTS - 1; i++) {
      expectWrong(await verifyAccountPassword('0000'), MAX_FREE_ATTEMPTS - i);
    }
    expect((await getAccount())?.lockUntil).toBe(0);
  });

  it('locks after the free attempts and reports the wait, not whether the PIN was right', async () => {
    await createAccount('Dr Test', PIN, false);
    // Attempts 1..4 are refused with a visible countdown...
    for (let i = 1; i <= MAX_FREE_ATTEMPTS - 1; i++) {
      expectWrong(await verifyAccountPassword('0000'), MAX_FREE_ATTEMPTS - i);
    }
    // ...attempt 5 is still free but says nothing about a countdown, and
    // attempt 6 is the one that starts the delay.
    expectWrong(await verifyAccountPassword('0000'), 0);
    expectLocked(await verifyAccountPassword('0000'), 30);

    // Even the *correct* PIN is refused while locked, with an identical reason.
    expectLocked(await verifyAccountPassword(PIN), 30);
  });

  it('escalates the delay and releases the lock once it expires', async () => {
    await createAccount('Dr Test', PIN, false);
    for (let i = 0; i < MAX_FREE_ATTEMPTS; i++) await verifyAccountPassword('0000');

    expectLocked(await verifyAccountPassword('0000'), 30);

    // Wait out the 30s, then fail again: the next step is longer.
    vi.advanceTimersByTime(31_000);
    expectLocked(await verifyAccountPassword('0000'), 120);

    vi.advanceTimersByTime(121_000);
    expect(await verifyAccountPassword(PIN)).toEqual({ ok: true });
    // Success clears the counter, so escalation restarts from the beginning.
    expect((await getAccount())?.failedAttempts).toBe(0);
  });

  it('carries an account created before the lockout fields existed', async () => {
    await createAccount('Legacy User', PIN, false);
    // Re-write the record the way an older build would have stored it.
    const stored = store.get('account') as Record<string, unknown>;
    store.set('account', { ...stored, failedAttempts: undefined, lockUntil: undefined });

    const account = await getAccount();
    expect(account?.failedAttempts).toBe(0);
    expect(account?.lockUntil).toBe(0);
    expect((await verifyAccountPassword(PIN)).ok).toBe(true);
  });
});

/**
 * P0.7 — the account-existence invariant is enforced by the service, not the UI.
 *
 * A stale create form, a double-tapped button, or two boot attempts racing all
 * call `createAccount`. Before this the second one silently replaced the first
 * credential and locked the real operator out. The service now reads first and
 * refuses, so creation can never overwrite an existing account.
 */
describe('createAccount existence invariant', () => {
  beforeEach(() => {
    store.clear();
  });

  it('refuses to overwrite an existing account and leaves it intact', async () => {
    await createAccount('First Operator', '4417', false);
    await expect(createAccount('Second Operator', '9012', false)).rejects.toThrow(/already exists/);
    const account = await getAccount();
    expect(account?.name).toBe('First Operator');
    expect((await verifyAccountPassword('4417')).ok).toBe(true);
  });
});

/**
 * Changing the unlock secret requires knowing it.
 *
 * The console is unlocked on a bench while a colleague is shown a report. Before
 * this, any hand on an unlocked device could set a new passcode and lock the lab
 * owner out of their own records — the UI checked the old passcode, but nothing
 * forced a caller to.
 */
describe('changePassword', () => {
  const PIN = '4417';
  const NEXT = '9012';

  beforeEach(() => {
    store.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a wrong current passcode and leaves the secret untouched', async () => {
    await createAccount('Dr Test', PIN, false);
    await expect(changePassword(NEXT, '0000')).rejects.toThrow(/Current passcode is incorrect/);

    expect((await verifyAccountPassword(PIN)).ok).toBe(true);
    expect((await verifyAccountPassword(NEXT)).ok).toBe(false);
  });

  it('swaps the secret when the current one is supplied', async () => {
    await createAccount('Dr Test', PIN, false);
    await changePassword(NEXT, PIN);

    expect((await verifyAccountPassword(NEXT)).ok).toBe(true);
  });

  it('clears the failure counters on success, so a rotation is not punished', async () => {
    await createAccount('Dr Test', PIN, false);
    await verifyAccountPassword('1111');
    expect((await getAccount())?.failedAttempts).toBe(1);

    await changePassword(NEXT, PIN);
    const after = await getAccount();
    expect(after?.failedAttempts).toBe(0);
    expect(after?.lastAttemptAt).toBe(0);
  });

  it('counts a guess at the change screen against the same backoff', async () => {
    await createAccount('Dr Test', PIN, false);
    for (let i = 0; i < MAX_FREE_ATTEMPTS; i++) {
      await expect(changePassword(NEXT, '0000')).rejects.toThrow();
    }
    // The free tries are spent; the next one is a lockout, not a refusal.
    await expect(changePassword(NEXT, '0000')).rejects.toThrow(/Too many attempts/);
  });
});

/**
 * A lockout that a clock change cannot end.
 *
 * The device owns its own wall clock and this build has no network time, so
 * "wait one hour" is only real if moving the clock forward stops working.
 */
describe('lockout survives a moved clock', () => {
  const PIN = '4417';

  beforeEach(() => {
    store.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses the correct passcode while the device clock reads earlier than the last attempt', async () => {
    await createAccount('Dr Test', PIN, false);
    for (let i = 0; i < MAX_FREE_ATTEMPTS; i++) await verifyAccountPassword('0000');
    expectLocked(await verifyAccountPassword('0000'), 30);

    // Set the clock back by a day. Time cannot have gone backwards, so the wait
    // is served from now rather than cancelled.
    vi.setSystemTime(new Date('2026-10-09T12:00:00.000Z'));
    expectLocked(await verifyAccountPassword(PIN), 86_430);

    // The penalty was re-anchored, not shortened: winding forward again still
    // has to reach the unlock time the store now holds.
    const after = await getAccount();
    expect(after?.lockUntil).toBeGreaterThan(Date.now() + 86_400_000);
  });

  it('releases normally once the clock genuinely passes the unlock time', async () => {
    await createAccount('Dr Test', PIN, false);
    for (let i = 0; i < MAX_FREE_ATTEMPTS; i++) await verifyAccountPassword('0000');
    expectLocked(await verifyAccountPassword('0000'), 30);

    vi.advanceTimersByTime(31_000);
    expect((await verifyAccountPassword(PIN)).ok).toBe(true);
  });
});
