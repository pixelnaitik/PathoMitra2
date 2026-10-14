/**
 * Passphrase-based encryption for exported backups.
 *
 * A snapshot is the whole lab — every patient, report and invoice — written out
 * as one readable JSON file, because a copy you cannot open is not a backup. That
 * is also the largest PHI exposure in the app: a file handed to Drive, WhatsApp or
 * a USB stick leaves the SQLCipher boundary entirely, in plaintext, and the device
 * it lands on is not ours to protect.
 *
 * So an export can be sealed with a passphrase instead:
 *
 *   PBKDF2-SHA256 (210 000 iterations, random 16-byte salt) → AES-256-GCM
 *
 * matching the credential hashing in `lib/password.ts`, and the result is still a
 * JSON *envelope* with the same `.json` name — the existing backup list, restore
 * picker and share sheet keep working, because they never had to learn about
 * encryption; they just read a file whose `kind` says `backup-encrypted`.
 *
 * Two properties worth stating out loud:
 *   - There is no recovery. The key is derived from the passphrase and nothing
 *     else; no server holds it, the keystore does not hold it, and a forgotten
 *     passphrase means the snapshot is unrecoverable. The UI has to say so.
 *   - GCM authenticates. A wrong passphrase (or a edited file) fails the tag
 *     check rather than returning garbled records, so a restore either works or
 *     stops — it can never half-restore.
 *
 * Requires a secure context for Web Crypto, exactly like `lib/password.ts`: the
 * Capacitor WebView (https scheme) and browsers on https/localhost both qualify.
 */

/** Same floor OWASP sets for PBKDF2-HMAC-SHA256 as `lib/password.ts` uses. */
const ITERATIONS = 210_000;
const SALT_BYTES = 16;
/** AES-GCM standard nonce length. Reused never: a fresh IV per export. */
const IV_BYTES = 12;
const KEY_BITS = 256;

/**
 * Shortest passphrase worth sealing a clinical archive with. This is not a login
 * password someone can reset — it is the only copy of the key, so the floor is
 * higher than the 4-digit unlock PIN.
 */
export const MIN_BACKUP_PASSPHRASE = 12;

/**
 * Bounds on the KDF cost an envelope may ask for. The iterations come from the
 * file, which is untrusted input: an envelope claiming a billion rounds would
 * otherwise freeze the restore screen for minutes on a wrong guess, and one
 * claiming 1 round would "succeed" with effectively no key derivation. Every
 * file this app writes uses ITERATIONS, so the window only ever has to fit
 * future deliberate bumps.
 */
const MIN_ACCEPTED_ITERATIONS = 100_000;
const MAX_ACCEPTED_ITERATIONS = 2_000_000;

/**
 * The one envelope shape this build writes and reads, asserted rather than
 * assumed.
 *
 * `kdf.alg` and `cipher.alg` used to be parsed and then ignored: a file claiming
 * `scrypt` or `AES-CBC` was decrypted with PBKDF2 and AES-GCM anyway, so the
 * header described nothing about the bytes under it and a future algorithm change
 * had nowhere to be detected. Same for `schemaVersion` — written, never read.
 * Anything that does not match exactly what this app produces is refused by name.
 */
const KDF_ALG = 'pbkdf2-sha256';
const CIPHER_ALG = 'AES-GCM';
const ENVELOPE_SCHEMA_VERSION = 1;

export interface EncryptedBackupEnvelope {
  app: 'PathoMitra';
  /** Distinguishes a sealed snapshot from a plaintext one. */
  kind: 'backup-encrypted';
  schemaVersion: number;
  /** Time the *seal* was made; the inner snapshot keeps its own createdAt. */
  createdAt: string;
  kdf: { alg: 'pbkdf2-sha256'; iterations: number; salt: string };
  cipher: { alg: 'AES-GCM'; iv: string };
  /** Base64 of the ciphertext (GCM tag included by Web Crypto). */
  ciphertext: string;
}

/**
 * Thrown when a sealed file needs a passphrase the caller has not supplied yet.
 * A distinct error type so the UI can ask for the passphrase instead of showing
 * "this is not a PathoMitra backup file" for a file that plainly is one.
 */
export class PassphraseRequiredError extends Error {
  constructor(fileName?: string) {
    super(
      `That backup is encrypted.${fileName ? ` (${fileName}) ` : ''}Enter the passphrase it was sealed with to restore it.`,
    );
    this.name = 'PassphraseRequiredError';
  }
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      'Web Crypto is unavailable in this context, so a backup cannot be sealed or opened.',
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

const HEX_RE = /^[0-9a-fA-F]+$/;

/**
 * Read a hex field that must be exactly `bytes` long.
 *
 * `fromHex` on its own is forgiving in the worst way: an odd-length string
 * silently loses its last nibble and a non-hex character becomes `NaN`, which a
 * `Uint8Array` stores as `0`. A mistyped envelope then produces a quietly wrong
 * key, and the operator is told their passphrase is wrong when the file is what
 * is broken. Exactly the length, all hex characters, or refuse it by name.
 */
function parseFixedHex(value: string | undefined, bytes: number, label: string): Uint8Array {
  const hex = (value ?? '').trim();
  if (hex.length !== bytes * 2 || !HEX_RE.test(hex)) {
    throw new Error(`That encrypted backup has a malformed ${label}.`);
  }
  return fromHex(hex);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a
  // multi-megabyte clinical snapshot.
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_BITS,
  );
  // Import the derived bits as an AES key rather than passing raw bytes, so the
  // key object carries the algorithm and never has to leave crypto as a string.
  return subtle().importKey('raw', bits, { name: 'AES-GCM', length: KEY_BITS }, false, usages);
}

/** Reject a passphrase too weak to protect an archive nobody can reset. */
export function validateBackupPassphrase(passphrase: string): string | null {
  if (!passphrase) return 'Enter a passphrase.';
  if (passphrase.length < MIN_BACKUP_PASSPHRASE)
    return `Use at least ${MIN_BACKUP_PASSPHRASE} characters — this passphrase is the only key, and it cannot be reset.`;
  return null;
}

/**
 * Seal a serialised snapshot. Returns the envelope text to write to disk.
 * Salt and IV are random per call, so sealing the same data twice never produces
 * the same file.
 */
export async function sealPayload(plain: string, passphrase: string): Promise<string> {
  const problem = validateBackupPassphrase(passphrase);
  if (problem) throw new Error(problem);

  const salt = new Uint8Array(SALT_BYTES);
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);

  const key = await deriveKey(passphrase, salt, ITERATIONS, ['encrypt']);
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );

  const envelope: EncryptedBackupEnvelope = {
    app: 'PathoMitra',
    kind: 'backup-encrypted',
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    kdf: { alg: KDF_ALG, iterations: ITERATIONS, salt: toHex(salt) },
    cipher: { alg: CIPHER_ALG, iv: toHex(iv) },
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(envelope, null, 2);
}

/** Open a sealed envelope. Throws on a wrong passphrase (GCM tag) or bad shape. */
export async function openPayload(envelopeText: string, passphrase: string): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelopeText);
  } catch {
    throw new Error('That encrypted backup is not valid JSON.');
  }
  const envelope = parsed as Partial<EncryptedBackupEnvelope>;
  if (!envelope || envelope.kind !== 'backup-encrypted' || !envelope.ciphertext) {
    throw new Error('That file is not an encrypted PathoMitra backup.');
  }
  if (envelope.kdf?.alg !== KDF_ALG) {
    throw new Error('That encrypted backup asks for a key derivation this build cannot perform.');
  }
  if (envelope.cipher?.alg !== CIPHER_ALG) {
    throw new Error('That encrypted backup asks for a cipher this build cannot perform.');
  }
  if (envelope.schemaVersion !== ENVELOPE_SCHEMA_VERSION) {
    throw new Error(
      `That encrypted backup uses schema version ${String(envelope.schemaVersion)}; this build reads version ${ENVELOPE_SCHEMA_VERSION}.`,
    );
  }
  // Exact lengths, asserted before any key material is derived.
  const salt = parseFixedHex(envelope.kdf?.salt, SALT_BYTES, 'salt');
  const iv = parseFixedHex(envelope.cipher?.iv, IV_BYTES, 'initialisation vector');
  const iterations = envelope.kdf?.iterations ?? ITERATIONS;
  if (
    !Number.isInteger(iterations) ||
    iterations < MIN_ACCEPTED_ITERATIONS ||
    iterations > MAX_ACCEPTED_ITERATIONS
  ) {
    throw new Error('That encrypted backup asks for an unsupported key-derivation cost.');
  }
  if (!passphrase) throw new PassphraseRequiredError();

  let key: CryptoKey;
  try {
    key = await deriveKey(passphrase, salt, iterations, ['decrypt']);
  } catch {
    throw new Error('That encrypted backup uses an unsupported key derivation.');
  }

  let decrypted: ArrayBuffer;
  try {
    decrypted = await subtle().decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      fromBase64(envelope.ciphertext) as BufferSource,
    );
  } catch {
    // A failed tag is indistinguishable from a corrupted file, and both mean the
    // same thing operationally: do not restore it.
    throw new Error('Wrong passphrase, or the file was altered — the contents do not verify.');
  }
  return new TextDecoder().decode(decrypted);
}

/** Cheap shape test on raw text: used before anything tries to parse it as a snapshot. */
export function isSealedPayload(raw: string): boolean {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('{') || !trimmed.includes('backup-encrypted')) return false;
  try {
    const parsed = JSON.parse(trimmed) as Partial<EncryptedBackupEnvelope>;
    return parsed.kind === 'backup-encrypted' && typeof parsed.ciphertext === 'string';
  } catch {
    return false;
  }
}
