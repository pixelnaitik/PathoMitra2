/**
 * The encrypted clinical database — desktop counterpart of the APK's
 * SQLCipher store (`@capacitor-community/sqlite` with androidIsEncryption).
 *
 * Engine: `better-sqlite3-multiple-ciphers`, compiled with SQLCipher — the key
 * is applied with `PRAGMA key` before any statement touches the file, so a
 * copied `.db` is unreadable without the Credential-Manager secret. Verified
 * at setup: a written file does NOT carry the plaintext `SQLite format 3`
 * header.
 *
 * Layout v1 mirrors the app's document model instead of a per-column schema:
 * one row per collection holding the JSON store the renderer already manages
 * (`webRepository.ts` semantics). Row-level queries are a later optimisation;
 * lab-scale collections never made the renderer do more than this in memory.
 *
 * The file is named `pathlab.db` on purpose — `DB_NAME = 'pathlab'` is a
 * preserved data-identity constant (see PROJECT_MEMORY "deliberately NOT
 * renamed"); a future importer reads Android snapshots by that name.
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getSecret, setSecret } from './keyring';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3-multiple-ciphers');

/** The slice of the better-sqlite3 API this module uses, typed locally so the
 *  native package stays a runtime require (esbuild keeps it external). */
interface EncDb {
  pragma: (source: string) => unknown;
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    get: (param?: string) => { json: string } | undefined;
    run: (...params: (string | number)[]) => unknown;
  };
  /**
   * better-sqlite3's transaction helper: wrapping `fn` yields a function that,
   * when called, runs the body inside BEGIN/COMMIT and rolls back on a throw.
   * This is what makes a multi-collection write (a report amendment, a restore)
   * land atomically instead of half-applying (see `saveEntitiesBulk`).
   */
  transaction: (fn: (rows: BulkRow[]) => void) => (rows: BulkRow[]) => void;
  close: () => void;
}

/** One collection's whole JSON, as handed to the atomic bulk write. */
type BulkRow = { entity: string; json: string };

const UPSERT_SQL =
  'INSERT INTO entities (name, json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json';

/** Credential-manager account holding the DB key — distinct from the unlock secret. */
const KEY_ACCOUNT = 'db-key';

/** SQLCipher KDF rounds for the passphrase→key derivation. */
const KDF_ITER = 256_000;

let db: EncDb | null = null;
let opening: Promise<void> | null = null;

function dbFile(): string {
  return path.join(app.getPath('userData'), 'pathlab.db');
}

/** Fetch the DB key from the credential manager, minting and storing one on first run. */
async function databaseKey(): Promise<string> {
  const existing = await getSecret(KEY_ACCOUNT);
  if (existing) return existing;
  const fresh = crypto.randomBytes(32).toString('hex');
  await setSecret(KEY_ACCOUNT, fresh);
  return fresh;
}

/** Idempotent, concurrency-safe open. */
export function openDatabase(): Promise<void> {
  if (db) return Promise.resolve();
  if (!opening) {
    opening = doOpen();
    // ANY failure clears the cached promise — the keyring call and the file
    // open fail *before* doOpen's inner try (a stopped Credential Manager or
    // a file lock from a previous instance are the common real ones), and a
    // permanently cached rejection would make the DB unopenable until a full
    // app restart.
    opening.catch(() => {
      if (opening) opening = null;
    });
  }
  return opening;
}

async function doOpen(): Promise<void> {
  const key = await databaseKey();
  fs.mkdirSync(path.dirname(dbFile()), { recursive: true });
  const handle = new Database(dbFile());
  try {
    // Order matters: cipher config must precede keying, and nothing may run
    // between the key pragma and the first real statement.
    handle.pragma("cipher='sqlcipher'");
    handle.pragma(`kdf_iter=${KDF_ITER}`);
    handle.pragma(`key='${key.replace(/'/g, "''")}'`);
    handle.pragma('journal_mode = WAL');
    handle.exec('CREATE TABLE IF NOT EXISTS entities (name TEXT PRIMARY KEY, json TEXT NOT NULL)');
    db = handle;
  } catch (err) {
    // A half-opened handle holds the file lock; dropping it here is what makes
    // a retry possible at all (see openDatabase for the cache reset).
    try {
      handle.close();
    } catch {
      /* the original failure is the one worth reporting */
    }
    throw err;
  }
}

/** The stored JSON for one collection, or null when it was never written. */
export function loadEntity(entity: string): string | null {
  if (!db) throw new Error('database opened late: loadEntity before init');
  const row = db.prepare('SELECT json FROM entities WHERE name = ?').get(entity);
  return row ? row.json : null;
}

/** Replace the whole JSON for one collection (single-writer app — no merge needed). */
export function saveEntity(entity: string, json: string): void {
  if (!db) throw new Error('database opened late: saveEntity before init');
  db.prepare(UPSERT_SQL).run(entity, json);
}

/**
 * Write several collections inside ONE SQLite transaction — the desktop answer
 * to the native store's `beginTransaction/commit/rollback`. Either every
 * collection in `rows` is persisted or none is, so a crash or a refusal
 * part-way through a multi-collection operation (a report amendment writing its
 * history row *and* the live report; a restore across many collections) can
 * never leave the database half-committed. The whole batch is one `db.transaction`
 * call; better-sqlite3 issues the ROLLBACK for us if any statement throws.
 */
export function saveEntitiesBulk(rows: BulkRow[]): void {
  if (!db) throw new Error('database opened late: saveEntitiesBulk before init');
  if (rows.length === 0) return;
  const write = db.prepare(UPSERT_SQL);
  const apply = db.transaction(entries => {
    for (const row of entries) write.run(row.entity, row.json);
  });
  apply(rows);
}

/** Drop every collection — "erase all data". */
export function clearEntities(): void {
  if (!db) throw new Error('database opened late: clearEntities before init');
  db.exec('DELETE FROM entities');
}
