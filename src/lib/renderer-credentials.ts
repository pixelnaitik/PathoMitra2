/**
 * Which Windows-Credential-Manager entries the renderer is allowed to name.
 *
 * The desktop shell keeps two different kinds of secret in the Credential
 * Manager under the `PathoMitra` service (see `electron/keyring.ts`):
 *   - the SQLCipher database key, under the fixed account `db-key`
 *     (`electron/db.ts`) — main-process only; it must NEVER cross the IPC
 *     bridge, because holding it is exactly what keeps the encrypted file
 *     unreadable to a copied `.db`.
 *   - the auth bootstrap records (the account, the password hash, the biometric
 *     flag, the lockout state), which the renderer writes through
 *     `secure-store.ts` — every one of them namespaced with
 *     {@link RENDERER_CREDENTIAL_PREFIX}.
 *
 * So the renderer's only legitimate keyring traffic is `pathlab_*`. The generic
 * `pm:keyring:{get,set,delete}` channels used to forward ANY account string
 * after a bare `typeof === 'string'` check, which meant a compromised page could
 * call `get('db-key')` and read the encryption key — the exact renderer↔DB
 * boundary `electron/db.ts` says the key "should remain out of the renderer".
 *
 * The rule lives here, dependency-free, so THREE consumers share one source of
 * truth: `electron/ipc.ts` (the enforcer — the trusted side of Electron's threat
 * model), `secure-store.ts` (the only sanctioned renderer client), and the
 * regression test, which can exercise the predicate without a running Electron.
 */

/** Namespace every renderer-held credential lives under. Load-bearing data identity. */
export const RENDERER_CREDENTIAL_PREFIX = 'pathlab_';

/**
 * Credential accounts that stay in the main process; the renderer may never
 * name them, even if they were to (improperly) carry the prefix. Checked first
 * so an explicit deny survives any future loosening of the prefix rule.
 */
export const MAIN_ONLY_CREDENTIAL_ACCOUNTS: readonly string[] = ['db-key'];

/**
 * True when `account` is one the renderer may read / write / delete. A single
 * predicate serves get, set and remove, so an overwritten or deleted `db-key`
 * is rejected for the same reason a read of it is.
 */
export function isRendererCredentialAccount(account: unknown): boolean {
  if (typeof account !== 'string') return false;
  if (MAIN_ONLY_CREDENTIAL_ACCOUNTS.includes(account)) return false;
  return account.startsWith(RENDERER_CREDENTIAL_PREFIX);
}
