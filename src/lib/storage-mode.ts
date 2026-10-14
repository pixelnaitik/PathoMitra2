/**
 * Which storage is actually backing this running app, and what it guarantees.
 *
 * The audit's P0.1 finding was that the browser build keeps records in plain
 * `localStorage` — unencrypted, exfiltrated by any XSS, synced by browser profile
 * backup — yet nothing on screen told the operator that this is NOT the protected
 * on-device store the APK/desktop use. The danger was the *silence*, not the
 * browser itself: a lab could point staff at a hosted URL and believe patient
 * data was as safe as it is on an installed device.
 *
 * This module names the boundary as data, so both the UI disclosure and the tests
 * read the same truth instead of re-deriving it. It never claims localStorage is
 * encrypted — the whole point is that it is not.
 */
import { isShell } from '../data';

export type StorageMode = 'protected' | 'browser-local';

/**
 * `protected` in an installed shell (APK SQLCipher, Electron encrypted store);
 * `browser-local` in a plain browser tab (WebRepository over localStorage).
 */
export function storageMode(): StorageMode {
  return isShell ? 'protected' : 'browser-local';
}

export function isProtectedStorage(): boolean {
  return storageMode() === 'protected';
}

/**
 * True when a production build is writing clinical records to unprotected
 * browser storage — the case that must never be presented as secure. Dev and the
 * test runner are excluded so the disclosure does not interrupt those flows; the
 * guarantee being enforced is "not silent in production", not "never usable".
 */
export function isUnprotectedProductionStore(
  mode: StorageMode = storageMode(),
  env: { PROD?: boolean } = import.meta.env,
): boolean {
  return mode === 'browser-local' && env.PROD === true;
}

/** Exact wording shown to the operator — kept here so a test can assert it. */
export const UNPROTECTED_STORAGE_WARNING =
  "Browser storage — not encrypted. This page keeps records in your browser's local " +
  'storage, which is NOT protected like the installed app. Do not store real patient ' +
  'data here; install the PathoMitra desktop or Android app for on-device encrypted storage.';
