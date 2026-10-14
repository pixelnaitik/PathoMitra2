/**
 * Windows Credential Manager access — the desktop counterpart of the
 * Android Keystore-backed `@aparajita/capacitor-secure-storage`.
 *
 * Holds the database encryption key. It is deliberately NOT stored in the
 * SQLite file, in localStorage, or derived from the operator passcode: DPAPI
 * seals it to the Windows user account, so a different user on the same PC
 * cannot read it. (Weaker than the phone's hardware KeyMint — this asymmetry
 * is documented in SECURITY.md rather than papered over.)
 *
 * `@napi-rs/keyring` is resolved from node_modules at runtime; createRequire
 * keeps it working through the esbuild bundle.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Entry } = require('@napi-rs/keyring');

/** One namespace so unrelated credentials in the manager are never touched. */
const SERVICE = 'PathoMitra';

// v2 of the package exposes a synchronous Entry API. PasswordManager was the
// v1 name — requiring it yielded undefined and every keyring call died with
// "Pm is not a constructor" in the main process (seen on the first real
// desktop launch, 2026-10-11).
type EntryCtor = new (
  service: string,
  username: string,
) => {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): boolean;
};

const E = Entry as EntryCtor;

export async function setSecret(account: string, secret: string): Promise<void> {
  new E(SERVICE, account).setPassword(secret);
}

export async function getSecret(account: string): Promise<string | null> {
  return new E(SERVICE, account).getPassword();
}

export async function deleteSecret(account: string): Promise<boolean> {
  return new E(SERVICE, account).deletePassword();
}
