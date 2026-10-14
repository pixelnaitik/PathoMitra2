/**
 * Two-store sync for lab settings and custom tests — local only.
 *
 * Despite the name, nothing here touches a network. Both stores live on the
 * device: `localStorage` (what the UI and the pre-paint theme bootstrap read)
 * and the `labSettings` table of the encrypted SQLCipher database, via the
 * `data/fs` façade.
 *
 * Settings and custom tests used to live in localStorage alone, which meant a
 * cleared app data, a new phone or a second workstation silently lost the lab's
 * name, address, print layout and every custom test definition — and, worse, a
 * JSON backup of the encrypted database contained no settings at all. Mirroring
 * one document into the database puts the lab's identity inside the backup and
 * the encryption boundary, while localStorage keeps first paint instant.
 *
 * Shape of `labSettings/current`:
 *   { settings: LabSettings, customTests: PathologyTest[], updatedAt, updatedBy }
 *
 * Conflict resolution is last-write-wins on `updatedAt`, which is an ISO string
 * and therefore sorts correctly. Writes are debounced so a slider drag does not
 * fire a document write per animation frame.
 */
import { db, doc, onSnapshot, setDoc } from '../data/fs';
import { z } from 'zod';
import { captureError } from './telemetry';
import {
  CUSTOM_TESTS_UPDATED_EVENT,
  SETTINGS_UPDATED_EVENT,
  readCustomTests,
  readSettings,
  writeCustomTests,
  writeSettings,
  type LabSettings,
} from './settings';
import type { PathologyTest } from './pathology-tests';

export const LAB_SETTINGS_DOC_PATH = 'labSettings';
export const LAB_SETTINGS_DOC_ID = 'current';

/** Debounce window for pushing local edits into the encrypted store. */
const PUSH_DELAY_MS = 900;

/**
 * The share-artwork data URL can be hundreds of kilobytes; Firestore caps a
 * document at 1 MiB. It stays device-local when it is too large rather than
 * failing the whole settings write.
 */
const MAX_SYNCED_IMAGE_CHARS = 400_000;

const CloudSettingsSchema = z.looseObject({
  settings: z.record(z.string(), z.unknown()).default({}),
  customTests: z.array(z.record(z.string(), z.unknown())).max(400).default([]),
  updatedAt: z.string().max(64).optional(),
  updatedBy: z.string().max(128).optional(),
});

let pushTimer = 0;
/** True while a remote snapshot is being applied, to avoid echoing it back. */
let applyingRemote = false;

function buildPayload(settings: LabSettings, customTests: PathologyTest[], uid?: string) {
  const { sharingTemplateImage, ...rest } = settings;
  const payload: Record<string, unknown> = {
    settings: rest,
    customTests,
    updatedAt: new Date().toISOString(),
  };
  if (uid) payload.updatedBy = uid;
  if (sharingTemplateImage && sharingTemplateImage.length <= MAX_SYNCED_IMAGE_CHARS) {
    payload.settings = { ...rest, sharingTemplateImage };
  } else if (sharingTemplateImage) {
    console.warn(
      'PathoMitra: the share template image is too large to sync between devices; ' +
        'it remains available on this device only.',
    );
  }
  return payload;
}

/** Queue a debounced push of the current local state to Firestore. */
function queuePush(uid?: string): void {
  if (applyingRemote) return;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(async () => {
    try {
      await setDoc(
        doc(db, LAB_SETTINGS_DOC_PATH, LAB_SETTINGS_DOC_ID),
        buildPayload(readSettings(), readCustomTests(), uid),
      );
    } catch (err) {
      // A blocked write here means the local store rejected the document shape;
      // the UI keeps working from localStorage, so this is a warning, not a fault.
      console.warn('PathoMitra: settings could not be mirrored into the encrypted store.', err);
    }
  }, PUSH_DELAY_MS);
}

/**
 * Start the two-way local mirror for the signed-in operator.
 *
 * Returns a cleanup function. Remote-side updates are applied through
 * `writeSettings`, which keeps the theme and every already-mounted component in
 * sync via the usual `settings-updated` event.
 */
export function startSettingsSync(uid?: string): () => void {
  const pushLocal = () => queuePush(uid);
  window.addEventListener(SETTINGS_UPDATED_EVENT, pushLocal);
  window.addEventListener(CUSTOM_TESTS_UPDATED_EVENT, pushLocal);

  const stopWatching = onSnapshot(
    doc(db, LAB_SETTINGS_DOC_PATH, LAB_SETTINGS_DOC_ID),
    snapshot => {
      // Our own write landing optimistically — do not re-apply it.
      if (!snapshot.exists() || snapshot.metadata.hasPendingWrites) return;

      const parsed = CloudSettingsSchema.safeParse(snapshot.data());
      if (!parsed.success) {
        captureError(new Error('Malformed labSettings document'), {
          scope: 'settings-sync',
          issues: parsed.error.issues
            .slice(0, 3)
            .map(i => i.message)
            .join('; '),
        });
        return;
      }

      const remote = parsed.data;
      const local = readSettings();
      // Last-write-wins: ISO timestamps compare correctly as strings.
      if (local.updatedAt && remote.updatedAt && remote.updatedAt <= local.updatedAt) return;

      applyingRemote = true;
      try {
        const { sharingTemplateImage: _localImage, ...localRest } = local;
        const remoteSettings = remote.settings as Partial<LabSettings>;
        writeSettings({
          ...localRest,
          ...remoteSettings,
          // Artwork that only exists locally must not be wiped by a remote
          // document that never carried it.
          sharingTemplateImage:
            (remoteSettings.sharingTemplateImage as string | undefined) ??
            local.sharingTemplateImage,
          updatedAt: remote.updatedAt ?? local.updatedAt,
          updatedBy: remote.updatedBy ?? local.updatedBy,
        } as LabSettings);

        const remoteTests = remote.customTests as unknown as PathologyTest[];
        if (remoteTests.length > 0 || readCustomTests().length === 0) {
          writeCustomTests(remoteTests);
        }
      } catch (err) {
        captureError(err, { scope: 'settings-sync/apply' });
      } finally {
        applyingRemote = false;
      }
    },
    err => {
      // Guests and demo accounts cannot read this collection; that is expected
      // and must not be reported as an application failure.
      const code = (err as { code?: string }).code;
      if (code !== 'permission-denied' && code !== 'unauthenticated') {
        captureError(err, { scope: 'settings-sync/watch' });
      }
    },
  );

  return () => {
    window.clearTimeout(pushTimer);
    window.removeEventListener(SETTINGS_UPDATED_EVENT, pushLocal);
    window.removeEventListener(CUSTOM_TESTS_UPDATED_EVENT, pushLocal);
    stopWatching();
  };
}
