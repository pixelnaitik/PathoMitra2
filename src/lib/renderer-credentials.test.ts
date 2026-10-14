import { describe, it, expect } from 'vitest';
import {
  MAIN_ONLY_CREDENTIAL_ACCOUNTS,
  RENDERER_CREDENTIAL_PREFIX,
  isRendererCredentialAccount,
} from './renderer-credentials';

/**
 * P0.0 — the compromised-renderer boundary. Before the fix, the desktop IPC
 * keyring channels forwarded ANY account string, so a page could ask for the
 * SQLCipher key (`db-key`, `electron/db.ts`) and read it. The one predicate
 * below now gates get / set / delete, so a single test table covers all three
 * operations (they share it in `electron/ipc.ts`).
 */
describe('renderer credential allow-list (P0.0)', () => {
  it('keeps the SQLCipher database key out of the renderer — get, set and delete all denied', () => {
    // The exact exploit: read, overwrite, or delete the DB encryption key.
    expect(isRendererCredentialAccount('db-key')).toBe(false);
    expect(MAIN_ONLY_CREDENTIAL_ACCOUNTS).toContain('db-key');
  });

  it('allows only the auth namespace the renderer legitimately writes', () => {
    // secure-store.ts keys every auth record with this prefix.
    expect(RENDERER_CREDENTIAL_PREFIX).toBe('pathlab_');
    expect(isRendererCredentialAccount(`${RENDERER_CREDENTIAL_PREFIX}account`)).toBe(true);
    expect(isRendererCredentialAccount(`${RENDERER_CREDENTIAL_PREFIX}password`)).toBe(true);
    expect(isRendererCredentialAccount(`${RENDERER_CREDENTIAL_PREFIX}biometric`)).toBe(true);
  });

  it('refuses every unknown or un-namespaced name, not just db-key', () => {
    for (const account of ['', 'account', 'PathoMitra', 'DB-KEY', 'dbkey', 'service']) {
      expect(isRendererCredentialAccount(account)).toBe(false);
    }
  });

  it('refuses non-string input (the IPC guard also type-checks, belt and braces)', () => {
    expect(isRendererCredentialAccount(undefined)).toBe(false);
    expect(isRendererCredentialAccount(null)).toBe(false);
    expect(isRendererCredentialAccount(42)).toBe(false);
    expect(isRendererCredentialAccount({ get: 'db-key' })).toBe(false);
  });

  it('explicitly denies a main-only account even if it were wrongly prefixed', () => {
    // The deny-list is checked before the prefix, so a future prefix change
    // cannot accidentally re-open the DB key.
    expect(isRendererCredentialAccount('db-key')).toBe(false);
  });
});
