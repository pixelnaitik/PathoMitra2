/**
 * Small secure key/value store for auth bootstrap data (the account record,
 * password hash, biometric flag).
 *
 * On device this is `@aparajita/capacitor-secure-storage`, which is backed by
 * the Android Keystore / iOS Keychain — the right home for a password hash.
 * On the Electron shell the same role is played by the Windows Credential
 * Manager over the IPC bridge (DPAPI-sealed to the user account) — the
 * desktop counterpart, chosen per-key exactly like Keystore is on Android.
 * In the browser (dev/tests) it falls back to `localStorage`, clearly good
 * enough for development and never used by the shipped APK.
 *
 * The v8 plugin requires a non-blank key prefix before any read/write, so we
 * set it once, lazily.
 */
import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { DataType } from '@aparajita/capacitor-secure-storage';
import { desktopBridge } from './desktop-bridge';
import { RENDERER_CREDENTIAL_PREFIX } from './renderer-credentials';

// The same namespace the main process allow-lists (see renderer-credentials.ts):
// every key this store writes is `pathlab_*`, and the IPC keyring handlers refuse
// any account outside it — so the SQLCipher key (`db-key`) is never reachable.
const PREFIX = RENDERER_CREDENTIAL_PREFIX;
let prefixSet = false;

async function ensurePrefix(): Promise<void> {
  if (prefixSet) return;
  await SecureStorage.setKeyPrefix(PREFIX);
  prefixSet = true;
}

export async function secureGet<T>(key: string): Promise<T | null> {
  const bridge = desktopBridge();
  if (bridge) {
    const raw = await bridge.keyring.get(PREFIX + key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  if (Capacitor.isNativePlatform()) {
    await ensurePrefix();
    const value = await SecureStorage.get(key);
    return (value as unknown as T) ?? null;
  }
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function secureSet<T>(key: string, value: T): Promise<void> {
  const bridge = desktopBridge();
  if (bridge) {
    await bridge.keyring.set(PREFIX + key, JSON.stringify(value));
    return;
  }
  if (Capacitor.isNativePlatform()) {
    await ensurePrefix();
    await SecureStorage.set(key, value as unknown as DataType);
    return;
  }
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota / private mode — nothing else we can do in dev.
  }
}

export async function secureRemove(key: string): Promise<void> {
  const bridge = desktopBridge();
  if (bridge) {
    await bridge.keyring.remove(PREFIX + key);
    return;
  }
  if (Capacitor.isNativePlatform()) {
    await ensurePrefix();
    await SecureStorage.remove(key);
    return;
  }
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
