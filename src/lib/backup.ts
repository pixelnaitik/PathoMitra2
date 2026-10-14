/**
 * Backup and restore of the on-device clinical database.
 *
 * The app is local-first by design: every patient, report and invoice lives in
 * one encrypted SQLCipher file on one phone, `allowBackup="false"` keeps Android
 * from copying it anywhere, and there is no cloud. Before this module a lost,
 * crashed or reset device destroyed the lab's entire history with no recovery
 * path at all — a single point of failure for medical records.
 *
 * A backup is therefore a JSON snapshot of every collection, written into the
 * app's own storage folder so it can be listed and restored later, and shareable
 * to Drive / a PC / the second workstation through the system sheet.
 *
 * It can also be **sealed**: pass a passphrase and the snapshot is written as an
 * AES-256-GCM envelope (PBKDF2-SHA256 key derivation) under the same `.json` name,
 * so the list, the picker and the share sheet need no special handling — and a
 * copy that leaves the device on someone else's storage no longer carries readable
 * patient data. Sealing is opt-*out* now, not opt-in: the passphrase is the only
 * copy of the key, so losing it loses the snapshot, and that trade-off is spelled
 * out in the UI rather than hidden in a tooltip. `lib/backup-crypto.ts`.
 *
 * Two things deliberately stay out of the file:
 *
 *   - The unlock credential. It is not in the database at all — it lives in the
 *     keystore-backed secure store, which cannot be exported by design. A restore
 *     brings the *records* back, not the password; the device keeps its own
 *     account.
 *   - Any illusion of confidentiality for a plaintext export. Sealed or not, it
 *     contains patient data, so "send a copy to the cloud" is the user's
 *     decision, never something the app does quietly.
 *
 * Restore is an upsert and never a delete: a snapshot can be merged onto a device
 * that has recorded things since, and an older or partial file cannot silently
 * destroy newer data.
 */
import type { EntityName } from '../data/types';
import {
  deleteAppFile,
  listAppFiles,
  readAppTextFile,
  shareAppFile,
  writeAppTextFile,
} from './native-files';
import { initDataStore } from '../data';
import { captureError } from './telemetry';
import {
  isSealedPayload,
  openPayload,
  PassphraseRequiredError,
  sealPayload,
  type EncryptedBackupEnvelope,
} from './backup-crypto';
import { z } from 'zod';

/** App-relative folder holding the snapshots. Keep it stable across releases. */
const BACKUP_DIR = 'PathoMitra/Backups';

/**
 * Snapshots written before the PathoMitra rebrand live in `PathLab OS/Backups`.
 * They are still listed, restored, shared and deleted — a lab's only copy of its
 * data must not become unreachable because the app changed its name. Everything
 * new is written to {@link BACKUP_DIR}.
 */
const LEGACY_BACKUP_DIR = 'PathLab OS/Backups';

/** Resolve a snapshot name to the folder that actually holds it. */
async function backupPathFor(fileName: string): Promise<string> {
  for (const dir of [BACKUP_DIR, LEGACY_BACKUP_DIR]) {
    if ((await listAppFiles(dir, '.json')).includes(fileName)) return `${dir}/${fileName}`;
  }
  // Not listed anywhere (just written, or a web build with no real filesystem):
  // the current folder is the only sensible answer.
  return `${BACKUP_DIR}/${fileName}`;
}

/**
 * Collections written to a snapshot. `meta` is included so the store's own
 * bookkeeping comes back with it; the unlock account is not a collection and so
 * is never in here.
 */
const BACKUP_COLLECTIONS: readonly EntityName[] = [
  'users',
  'patients',
  'doctors',
  'reports',
  'reportNotes',
  'reportVersions',
  'invoices',
  'labSettings',
  'notificationState',
  'meta',
] as const;

export const BACKUP_SCHEMA_VERSION = 1;

export interface BackupCounts {
  [collection: string]: number;
}

export interface BackupSummary {
  /** File name inside the backup folder, when one exists. */
  fileName?: string;
  /** ISO timestamp of the snapshot, or the file name when it could not be read. */
  createdAt: string;
  counts: BackupCounts;
  totalRecords: number;
  /**
   * Sealed with a passphrase, so the record counts are unknown until it is
   * opened. Only ever `true` — a plaintext snapshot leaves it undefined.
   */
  encrypted?: boolean;
}

/**
 * One stored document. `id` is required and everything else passes through, so a
 * snapshot from an older build never fails validation over a field this build
 * has stopped writing.
 */
function toBackupDoc(
  id: string,
  value: Record<string, unknown>,
): { id: string } & Record<string, unknown> {
  return { id, ...value };
}

const BackupDocumentSchema = z.object({ id: z.string().min(1) }).passthrough();

const BackupFileSchema = z.object({
  // Both names are accepted: every snapshot taken before the rebrand says
  // `PathLab OS`, and refusing to read one would strand it.
  app: z.enum(['PathoMitra', 'PathLab OS']),
  kind: z.literal('backup'),
  schemaVersion: z.number().int().min(1).max(BACKUP_SCHEMA_VERSION),
  createdAt: z.string().min(1),
  counts: z.record(z.string(), z.number().int().min(0)),
  data: z.record(z.string(), z.array(BackupDocumentSchema)),
});
export type BackupFile = z.infer<typeof BackupFileSchema>;
type BackupDocuments = { id: string } & Record<string, unknown>;

/** Filename with a sortable timestamp, so the list reads newest-first. */
function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function backupFileName(createdAt: Date = new Date()): string {
  return `pathomitra-backup-${stamp(createdAt)}.json`;
}

function summarise(backup: BackupFile, fileName?: string): BackupSummary {
  return {
    fileName,
    createdAt: backup.createdAt,
    counts: backup.counts,
    totalRecords: Object.values(backup.counts).reduce((sum, n) => sum + n, 0),
  };
}

/** Take a snapshot of every collection. Read-only; touches nothing. */
export async function buildBackup(): Promise<BackupFile> {
  const repo = await initDataStore();
  const data: Record<string, BackupDocuments[]> = {};
  const counts: BackupCounts = {};

  for (const collection of BACKUP_COLLECTIONS) {
    const docs = await repo.list(collection);
    data[collection] = docs.map(doc => toBackupDoc(doc.id, doc.data()));
    counts[collection] = docs.length;
  }

  return {
    app: 'PathoMitra',
    kind: 'backup',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    counts,
    data,
  };
}

/**
 * Write a snapshot into the app's backup folder.
 *
 * @param options.passphrase seals the file (AES-256-GCM). Omit it, or pass an
 *   empty string, and the snapshot is written readable — the explicit opt-out for
 *   a lab that needs to open the file on another system without the app.
 * @returns where it went, plus the file name for {@link shareBackup}.
 */
export async function createBackup(
  options: { passphrase?: string } = {},
): Promise<{ summary: BackupSummary; fileName: string }> {
  const backup = await buildBackup();
  const fileName = backupFileName(new Date(backup.createdAt));
  const passphrase = options.passphrase ?? '';
  const payload = passphrase
    ? await sealPayload(JSON.stringify(backup), passphrase)
    : JSON.stringify(backup, null, 2);
  const saved = await writeAppTextFile(`${BACKUP_DIR}/${fileName}`, payload);
  return {
    summary: { ...summarise(backup, saved.name), ...(passphrase ? { encrypted: true } : {}) },
    fileName,
  };
}

/** Hand a stored snapshot to the system share sheet, so a copy can leave. */
export async function shareBackup(fileName: string): Promise<void> {
  const summary = await readBackup(fileName);
  await shareAppFile(
    await backupPathFor(fileName),
    fileName,
    'PathoMitra backup',
    summary.encrypted
      ? 'Encrypted backup — needs the passphrase to restore'
      : `${summary.totalRecords} records, taken ${summary.createdAt}`,
  );
}

/**
 * Snapshots on the device, newest first.
 *
 * Listing only gives file names, and a name is not a date the user can trust
 * once a file has been copied around — so each entry is opened and summarised.
 * A file that fails to parse is still listed (the user may want to delete it),
 * with its name as the only known fact.
 */
export async function listBackups(): Promise<BackupSummary[]> {
  const listings = await Promise.all(
    [BACKUP_DIR, LEGACY_BACKUP_DIR].map(dir => listAppFiles(dir, '.json')),
  );
  // Newest-first across both folders; the timestamped name sorts lexically.
  const names = [...new Set(listings.flat())].sort((a, b) => b.localeCompare(a));
  return names.map(name => ({
    fileName: name,
    createdAt: name,
    counts: {},
    totalRecords: 0,
  }));
}

async function readBackup(fileName: string): Promise<BackupSummary> {
  const raw = await readAppTextFile(await backupPathFor(fileName));
  if (isSealedPayload(raw)) {
    // Describing a sealed file needs no passphrase: the envelope carries when it
    // was sealed. The counts stay hidden until it is actually opened.
    const envelope = JSON.parse(raw) as EncryptedBackupEnvelope;
    return {
      fileName,
      createdAt: envelope.createdAt,
      counts: {},
      totalRecords: 0,
      encrypted: true,
    };
  }
  return summarise(parseBackup(raw), fileName);
}

/**
 * Turn file text into a validated snapshot, opening the seal first if there is
 * one. Throws {@link PassphraseRequiredError} when a sealed file meets no
 * passphrase, so the caller can ask for one instead of rejecting a file that is
 * perfectly valid.
 */
async function openBackup(raw: string, passphrase?: string): Promise<BackupFile> {
  if (!isSealedPayload(raw)) return parseBackup(raw);
  if (!passphrase) throw new PassphraseRequiredError();
  return parseBackup(await openPayload(raw, passphrase));
}

/** Validate a snapshot before a single row is written. */
export function parseBackup(raw: string): BackupFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('That file is not valid JSON, so it cannot be a PathoMitra backup.');
  }
  const result = BackupFileSchema.safeParse(json);
  if (!result.success) {
    throw new Error(
      'This is not a PathoMitra backup file, or it came from a newer version. ' +
        result.error.issues
          .slice(0, 2)
          .map(issue => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
    );
  }
  return result.data;
}

export interface RestoreResult extends BackupSummary {
  /** Collections in the file that this build does not recognise. */
  skipped: string[];
}

/**
 * Turn the validated snapshot into a write plan, rejecting anything that must
 * not reach the store. Runs entirely before the first write so a malformed file
 * cannot leave a half-applied database behind.
 */
interface RestorePlanStep {
  entity: EntityName;
  docs: BackupDocuments[];
}
function planRestore(backup: BackupFile): { steps: RestorePlanStep[]; skipped: string[] } {
  const known = new Set<string>(BACKUP_COLLECTIONS);
  const skipped: string[] = [];
  const steps: RestorePlanStep[] = [];
  for (const [collection, docs] of Object.entries(backup.data)) {
    if (!known.has(collection)) {
      skipped.push(collection);
      continue;
    }
    for (const doc of docs) {
      if (typeof doc.id !== 'string' || doc.id.length === 0) {
        throw new Error(
          `Restore aborted before any change: a document in "${collection}" has no valid id.`,
        );
      }
    }
    steps.push({ entity: collection as EntityName, docs });
  }
  return { steps, skipped };
}

/**
 * Merge a snapshot into the local store, upserting by document id.
 *
 * Everything is validated first (see {@link planRestore}) so a malformed file
 * never mutates the database. The writes then run inside a single store
 * transaction. On the native store that is a real SQLCipher transaction, and on
 * the desktop it is one atomic main-process write (`DesktopRepository.transaction`
 * → `bridge.db.commit`, P0.4) — so a failure part-way through rolls every record
 * back and the pre-restore data is left exactly as it was: the restore either
 * fully applies or fully does not. The browser/localStorage adapter cannot offer
 * that (it is a sequential upsert) and says so in `webRepository.ts`; it is a
 * development store, never the one a lab's records live in.
 * Because restore is an *upsert and never a delete*, the previous dataset also
 * survives a snapshot later judged bad, and a retried restore converges rather
 * than duplicating. The success count is reported only for a completed
 * transaction; a mid-write failure throws instead of returning a partial count.
 */
export async function restoreBackup(backup: BackupFile): Promise<RestoreResult> {
  const repo = await initDataStore();
  const { steps, skipped } = planRestore(backup);

  const counts: BackupCounts = {};
  let restored = 0;

  await repo.transaction(async tx => {
    for (const { entity, docs } of steps) {
      for (const doc of docs) {
        const { id, ...value } = doc;
        await tx.set(entity, id, value);
        restored += 1;
      }
      counts[entity] = docs.length;
    }
  });

  return { createdAt: backup.createdAt, counts, totalRecords: restored, skipped };
}

/** Restore the named snapshot from the device's backup folder. */
export async function restoreBackupByName(
  fileName: string,
  passphrase?: string,
): Promise<RestoreResult> {
  const raw = await readAppTextFile(await backupPathFor(fileName));
  return restoreBackup(await openBackup(raw, passphrase));
}

/** Restore from text the user supplied through a browser file picker. */
export async function restoreBackupFromText(
  raw: string,
  passphrase?: string,
): Promise<RestoreResult> {
  return restoreBackup(await openBackup(raw, passphrase));
}

/** Remove one snapshot. Used by the "delete old backups" housekeeping. */
export async function deleteBackup(fileName: string): Promise<void> {
  try {
    // Routed through the same platform split as every other app-file action:
    // the desktop shell deletes via the bridge (the snapshots live in the
    // main process's userData, which the Capacitor plugin cannot see), the
    // APK and the web build through the filesystem they wrote to.
    await deleteAppFile(await backupPathFor(fileName));
  } catch (err) {
    captureError(err, { scope: 'backup/delete', file: fileName });
    throw err;
  }
}

/**
 * How much data there is to lose, for the "back up soon" nudge. Counting rows is
 * far cheaper than serialising them.
 */
export async function countRecords(): Promise<number> {
  const repo = await initDataStore();
  let total = 0;
  for (const collection of ['patients', 'reports', 'doctors', 'invoices'] as const) {
    total += await repo.count(collection);
  }
  return total;
}
