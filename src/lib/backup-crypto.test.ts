import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  isSealedPayload,
  MIN_BACKUP_PASSPHRASE,
  openPayload,
  PassphraseRequiredError,
  sealPayload,
  validateBackupPassphrase,
} from './backup-crypto';

/**
 * jsdom's `window.crypto` has no `subtle`, and this module is built on Web Crypto
 * exactly like `lib/password.ts`. Supply the real thing when the environment has
 * none, so the round-trip is genuinely exercised rather than skipped.
 */
beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

const PLAIN = JSON.stringify({
  app: 'PathoMitra',
  kind: 'backup',
  schemaVersion: 1,
  createdAt: '2026-10-11T10:00:00.000Z',
  counts: { patients: 1 },
  data: { patients: [{ id: 'p1', name: 'Test Patient' }] },
});
const PASSPHRASE = 'long-enough-passphrase-for-a-clinical-archive';

describe('sealPayload / openPayload round trip', () => {
  it('recovers the exact plaintext it sealed', async () => {
    const sealed = await sealPayload(PLAIN, PASSPHRASE);
    expect(isSealedPayload(sealed)).toBe(true);
    expect(await openPayload(sealed, PASSPHRASE)).toBe(PLAIN);
  });

  it('never writes the patient text into the envelope', async () => {
    const sealed = await sealPayload(PLAIN, PASSPHRASE);
    expect(sealed).not.toContain('Test Patient');
    expect(sealed).not.toContain('"kind": "backup"');
  });

  it('rejects a wrong passphrase instead of returning garbage', async () => {
    const sealed = await sealPayload(PLAIN, PASSPHRASE);
    await expect(openPayload(sealed, 'some-other-passphrase-value')).rejects.toThrow(/passphrase/i);
  });

  it('uses a fresh salt and IV, so sealing twice never gives the same file', async () => {
    const a = await sealPayload(PLAIN, PASSPHRASE);
    const b = await sealPayload(PLAIN, PASSPHRASE);
    expect(a).not.toBe(b);
    expect(JSON.parse(a).kdf.salt).not.toBe(JSON.parse(b).kdf.salt);
    // …and both still open.
    expect(await openPayload(b, PASSPHRASE)).toBe(PLAIN);
  });
});

describe('isSealedPayload', () => {
  it('does not mistake a normal snapshot for a sealed one', () => {
    expect(isSealedPayload(PLAIN)).toBe(false);
  });

  it('recognises a sealed envelope and survives junk', async () => {
    expect(isSealedPayload(await sealPayload(PLAIN, PASSPHRASE))).toBe(true);
    expect(isSealedPayload('not json at all')).toBe(false);
    expect(isSealedPayload('{"kind":"backup-encrypted"}')).toBe(false);
  });
});

describe('validateBackupPassphrase', () => {
  it('enforces the floor and reports the reason', () => {
    expect(validateBackupPassphrase('')).toMatch(/Enter a passphrase/);
    expect(validateBackupPassphrase('short')).toMatch(/at least/i);
    expect(validateBackupPassphrase('x'.repeat(MIN_BACKUP_PASSPHRASE))).toBeNull();
  });

  it('refuses to seal with a passphrase it would reject', async () => {
    await expect(sealPayload(PLAIN, 'short')).rejects.toThrow(/characters/);
  });

  it('openPayload without a passphrase asks for one, which is not a failure', async () => {
    const sealed = await sealPayload(PLAIN, PASSPHRASE);
    await expect(openPayload(sealed, '')).rejects.toBeInstanceOf(PassphraseRequiredError);
  });
});
