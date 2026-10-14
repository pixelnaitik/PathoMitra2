/**
 * Data-store entrypoint. Chooses the repository once, based on the runtime:
 *
 *   - native (the APK)      → `SqliteRepository`   (encrypted SQLCipher)
 *   - desktop (Electron)    → `DesktopRepository`  (SQLCipher via the IPC bridge)
 *   - browser / tests       → `WebRepository`      (localStorage, dev only)
 *
 * Pages import `getRepository()` (or `initDataStore()` during app bootstrap)
 * instead of the old Firestore `db`, and program against the
 * {@link DataRepository} interface so neither adapter leaks into UI code.
 */
import { Capacitor } from '@capacitor/core';
import { isDesktopShell } from '../lib/desktop-bridge';
import type { DataRepository } from './types';
import { SqliteRepository } from './sqliteRepository';
import { DesktopRepository } from './desktopRepository';
import { WebRepository } from './webRepository';

let instance: DataRepository | null = null;

/** Lazily create (once) the repository appropriate for this platform. */
export function getRepository(): DataRepository {
  if (!instance) {
    if (isDesktopShell()) instance = new DesktopRepository();
    else instance = Capacitor.isNativePlatform() ? new SqliteRepository() : new WebRepository();
  }
  return instance;
}

/** Open/encrypt the store and return it. Call once during app bootstrap. */
export async function initDataStore(): Promise<DataRepository> {
  const repo = getRepository();
  await repo.init();
  return repo;
}

/** True when running inside the native shell (the APK). */
export const isNative = Capacitor.isNativePlatform();

/**
 * True in any installed shell — APK or Electron window. Use it where the
 * question is "does this runtime have real file/output APIs?" (routing to
 * the auth console instead of the marketing site, backup actions, storage
 * policy). Keep `isNative` for genuinely Android-only concerns (system bars,
 * hardware back button, haptics).
 */
export const isShell = isNative || isDesktopShell();

export type {
  DataRepository,
  EntityName,
  ListOptions,
  LocalDoc,
  WhereFilter,
  WhereOp,
} from './types';
