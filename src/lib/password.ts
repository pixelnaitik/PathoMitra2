/**
 * Local password hashing — replaces Firebase Auth's credential handling.
 *
 * PBKDF2-SHA256 via the Web Crypto API (available in the Capacitor WebView
 * under `androidScheme: https`, and in browsers on localhost). The password is
 * never stored: only a random per-account salt and the derived key are kept,
 * in `secure-store` (Keystore/Keychain-backed on device).
 *
 * 210k iterations is the current OWASP floor for PBKDF2-HMAC-SHA256.
 */

const ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

export interface PasswordHash {
  alg: 'pbkdf2-sha256';
  iterations: number;
  /** hex-encoded random salt */
  salt: string;
  /** hex-encoded derived key */
  hash: string;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      'Web Crypto is unavailable in this context. Password hashing needs a secure ' +
        'context (https or the native WebView).',
    );
  }
  return c.subtle;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return toHex(arr);
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_BITS,
  );
  return toHex(new Uint8Array(bits));
}

/** Constant-time string comparison to avoid a timing side channel on verify. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Hash a new password with a fresh random salt. */
export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomHex(SALT_BYTES);
  const hash = await derive(password, fromHex(salt), ITERATIONS);
  return { alg: 'pbkdf2-sha256', iterations: ITERATIONS, salt, hash };
}

/**
 * Accepted window for a stored iteration count. `hashPassword` always writes
 * ITERATIONS; the bounds only guard against a hand-edited stored hash asking
 * for a billion rounds (freezing the unlock screen) or one round (making the
 * derivation a joke). A value outside the window fails verification rather
 * than locking the operator out silently — re-creating the account is the
 * documented recovery for a corrupt secure store either way.
 */
const MIN_ACCEPTED_ITERATIONS = 100_000;
const MAX_ACCEPTED_ITERATIONS = 2_000_000;

/** Verify a password against a stored hash. Never throws on mismatch. */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  if (!stored || stored.alg !== 'pbkdf2-sha256') return false;
  if (
    !Number.isInteger(stored.iterations) ||
    stored.iterations < MIN_ACCEPTED_ITERATIONS ||
    stored.iterations > MAX_ACCEPTED_ITERATIONS
  ) {
    return false;
  }
  const candidate = await derive(password, fromHex(stored.salt), stored.iterations);
  return safeEqual(candidate, stored.hash);
}

/**
 * Re-hash an existing account's password without ever exposing the plaintext
 * to callers that only hold the old hash (used by "change password": the UI
 * collects the new password and calls `hashPassword` directly).
 */
export function isPasswordHash(value: unknown): value is PasswordHash {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as PasswordHash).alg === 'pbkdf2-sha256' &&
    typeof (value as PasswordHash).salt === 'string' &&
    typeof (value as PasswordHash).hash === 'string'
  );
}
