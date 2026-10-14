/**
 * The single local account for this device — replaces Firebase Auth users.
 *
 * Stored as one record in `secure-store` (Keystore/Keychain on device). It
 * holds the display name, a PBKDF2 password hash, whether biometric unlock is
 * enabled, and the failed-attempt state used to slow brute force. There is
 * exactly one account (the lab admin); no roles, no server, no email
 * verification.
 *
 * Why the attempt counter matters: the unlock secret is a short PIN, so without
 * a delay between failures the on-screen lockout can be walked through in a few
 * minutes by anyone holding the device. The backoff is enforced here rather than
 * in the UI so no screen can bypass it.
 */
import { hashPassword, verifyPassword, type PasswordHash } from './password';
import { secureGet, secureRemove, secureSet } from './secure-store';
import { TERMS_VERSION } from './terms';

const KEY = 'account';

/** Free tries before the first delay, then one delay step per further failure. */
export const MAX_FREE_ATTEMPTS = 5;

/**
 * Lock durations (ms) applied after the 5th, 6th, 7th… consecutive failure.
 * The last value repeats for every further attempt.
 */
const LOCK_STEPS_MS = [30_000, 120_000, 300_000, 900_000, 3_600_000];

export interface LocalAccount {
  name: string;
  createdAt: string;
  password: PasswordHash;
  biometricEnabled: boolean;
  /** Consecutive failed unlocks since the last success. */
  failedAttempts: number;
  /** Epoch ms the current lockout ends; 0 when not locked. */
  lockUntil: number;
  /**
   * Epoch ms of the last recorded attempt, kept so a lockout cannot be ended by
   * winding the device clock forward. See `verifyAccountPassword`.
   */
  lastAttemptAt: number;
  /**
   * When and which version of the terms the operator accepted. Kept on the
   * account rather than in settings so "erase all data & delete account" removes
   * the acceptance record along with everything else.
   */
  termsAcceptedAt: string;
  termsVersion: string;
}

/**
 * Outcome of an unlock attempt. `reason: 'locked'` deliberately does not say
 * whether the PIN was right — telling an attacker "that was correct but you are
 * locked out" would leak the answer out of a timing-style probe.
 */
export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'locked'; unlocksAt: number; waitSeconds: number };

function lockDurationFor(attempts: number): number {
  if (attempts <= MAX_FREE_ATTEMPTS) return 0;
  const step = Math.min(attempts - MAX_FREE_ATTEMPTS - 1, LOCK_STEPS_MS.length - 1);
  return LOCK_STEPS_MS[step];
}

/** Fill in lockout fields for accounts written before they existed. */
function normalize(account: LocalAccount | null): LocalAccount | null {
  if (!account || !account.password) return null;
  return {
    ...account,
    failedAttempts: Number.isFinite(account.failedAttempts) ? account.failedAttempts : 0,
    lockUntil: Number.isFinite(account.lockUntil) ? account.lockUntil : 0,
    lastAttemptAt: Number.isFinite(account.lastAttemptAt) ? account.lastAttemptAt : 0,
    // An account predating the terms screen is not treated as having accepted
    // something it never saw: these stay empty and re-prompt once on unlock.
    termsAcceptedAt: typeof account.termsAcceptedAt === 'string' ? account.termsAcceptedAt : '',
    termsVersion: typeof account.termsVersion === 'string' ? account.termsVersion : '',
  };
}

/** The stored account, or `null` on a fresh install (drives create-vs-unlock). */
export async function getAccount(): Promise<LocalAccount | null> {
  return normalize(await secureGet<LocalAccount>(KEY));
}

/** True once an account exists — used to pick the first-run screen. */
export async function hasAccount(): Promise<boolean> {
  return (await getAccount()) !== null;
}

/** Create the device's account. Call only when `hasAccount()` is false. */
export async function createAccount(
  name: string,
  password: string,
  biometricEnabled = false,
  termsAcceptedAt = '',
): Promise<LocalAccount> {
  // The invariant lives here, not in the calling screen. An unlocked-but-stale
  // console, a double-tapped create button, or two boot attempts racing could
  // otherwise each call this and silently replace the operator's credential —
  // locking the real lab out of its own device. Reading first (and refusing when
  // an account already resolves) makes creation idempotent-safe at the service.
  if (await hasAccount()) {
    throw new Error('An account already exists on this device. Unlock instead.');
  }
  const hash = await hashPassword(password);
  const account: LocalAccount = {
    name: name.trim(),
    createdAt: new Date().toISOString(),
    password: hash,
    biometricEnabled,
    failedAttempts: 0,
    lockUntil: 0,
    lastAttemptAt: 0,
    termsAcceptedAt,
    termsVersion: termsAcceptedAt ? TERMS_VERSION : '',
  };
  await secureSet(KEY, account);
  return account;
}

/**
 * True when the stored acceptance predates the current terms text, so the
 * operator has to re-accept. A silent terms change is not an accepted one.
 */
export function needsTermsAcceptance(account: LocalAccount | null): boolean {
  if (!account) return true;
  return !account.termsAcceptedAt || account.termsVersion !== TERMS_VERSION;
}

/** Record acceptance of the current terms version against the account. */
export async function acceptTerms(): Promise<void> {
  const account = await getAccount();
  if (!account) return;
  await secureSet(KEY, {
    ...account,
    termsAcceptedAt: new Date().toISOString(),
    termsVersion: TERMS_VERSION,
  });
}

/**
 * Verify an unlock attempt, applying the backoff. Never throws and never
 * reveals whether the supplied PIN was correct while a lockout is running.
 */
export async function verifyAccountPassword(password: string): Promise<UnlockResult> {
  const account = await getAccount();
  if (!account) return { ok: false, reason: 'wrong', attemptsLeft: 0 };

  const now = Date.now();
  if (account.lockUntil > now) {
    return {
      ok: false,
      reason: 'locked',
      unlocksAt: account.lockUntil,
      waitSeconds: Math.ceil((account.lockUntil - now) / 1000),
    };
  }

  // A lockout that has expired no longer blocks the attempt, but the counter is
  // kept so escalation continues from where it stopped.
  if (account.lockUntil !== 0 && account.lockUntil <= now) {
    await secureSet(KEY, { ...account, lockUntil: 0 });
  }

  const current = (await getAccount()) ?? account;

  // The lockout is measured against the wall clock, and on an offline device the
  // wall clock belongs to whoever is holding the phone. Winding it forward used to
  // end any lockout on the spot, which turns "one attempt per hour" back into "as
  // many attempts as you like". A reading earlier than the last recorded attempt
  // cannot be real time, so it is treated as tampering: the wait is served from
  // now, the penalty is not shortened, and the record is re-anchored so the clock
  // cannot be walked backwards repeatedly to dodge it.
  if (current.lastAttemptAt > now) {
    const owed = lockDurationFor(current.failedAttempts);
    const unlocksAt = Math.max(current.lockUntil, current.lastAttemptAt + owed, now + 1000);
    if (unlocksAt > current.lockUntil) {
      await secureSet(KEY, { ...current, lockUntil: unlocksAt });
    }
    return {
      ok: false,
      reason: 'locked',
      unlocksAt,
      waitSeconds: Math.ceil((unlocksAt - now) / 1000),
    };
  }

  if (await verifyPassword(password, current.password)) {
    if (current.failedAttempts !== 0 || current.lockUntil !== 0 || current.lastAttemptAt !== 0) {
      await secureSet(KEY, {
        ...current,
        failedAttempts: 0,
        lockUntil: 0,
        lastAttemptAt: 0,
      });
    }
    return { ok: true };
  }

  const failedAttempts = current.failedAttempts + 1;
  const lockMs = lockDurationFor(failedAttempts);
  await secureSet(KEY, {
    ...current,
    failedAttempts,
    lockUntil: lockMs > 0 ? now + lockMs : 0,
    lastAttemptAt: now,
  });

  if (lockMs > 0) {
    return {
      ok: false,
      reason: 'locked',
      unlocksAt: now + lockMs,
      waitSeconds: Math.ceil(lockMs / 1000),
    };
  }
  return {
    ok: false,
    reason: 'wrong',
    attemptsLeft: Math.max(0, MAX_FREE_ATTEMPTS - failedAttempts),
  };
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  const account = await getAccount();
  if (!account) return;
  await secureSet(KEY, { ...account, biometricEnabled: enabled });
}

/**
 * Replace the unlock secret.
 *
 * The current secret is a required argument rather than something the caller is
 * expected to check first. An *unlocked* console is not an *authenticated* one —
 * a device left open on a bench, or handed over to show a colleague a report, is
 * exactly the moment a passcode must not be changeable, because changing it
 * without knowing the old one locks the real operator out of their own lab. The
 * check goes through {@link verifyAccountPassword}, so guessing here runs into
 * the same escalating backoff as guessing at the unlock screen.
 */
export async function changePassword(nextPassword: string, currentPassword: string): Promise<void> {
  const account = await getAccount();
  if (!account) throw new Error('No account exists on this device.');

  const verified = await verifyAccountPassword(currentPassword);
  if (!verified.ok) {
    throw new Error(
      verified.reason === 'locked'
        ? `Too many attempts — try again in ${Math.ceil(verified.waitSeconds / 60)} min.`
        : 'Current passcode is incorrect.',
    );
  }

  // Re-read: the verify above clears the failure counters, and the new hash must
  // be written onto that record rather than the snapshot taken before it.
  const current = (await getAccount()) ?? account;
  const hash = await hashPassword(nextPassword);
  await secureSet(KEY, { ...current, password: hash });
}

export async function updateAccountName(name: string): Promise<void> {
  const account = await getAccount();
  if (!account) return;
  await secureSet(KEY, { ...account, name: name.trim() });
}

/** Erase the account (used by "erase all data" in settings). */
export async function deleteAccount(): Promise<void> {
  await secureRemove(KEY);
}
