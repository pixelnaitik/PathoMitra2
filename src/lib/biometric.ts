/**
 * Biometric / device-credential unlock — wraps `@aparajita/capacitor-biometric-auth`.
 *
 * `allowDeviceCredential: true` is what turns this into the user's requested
 * "screen lock" option: the system biometric prompt also offers the device
 * PIN/pattern/password as a fallback, and works even when no biometric is
 * enrolled but the device is secured.
 *
 * Every method degrades gracefully off-device (browser dev) so the UI can
 * simply hide the biometric button when `checkBiometric().available` is false.
 */
import { Capacitor } from '@capacitor/core';
import { BiometricAuth, BiometryErrorType } from '@aparajita/capacitor-biometric-auth';

export interface BiometricStatus {
  /** True when the device can authenticate (biometry enrolled, or a secure device credential). */
  available: boolean;
  /** Human-readable reason when unavailable (empty when available). */
  reason: string;
}

export interface BiometricResult {
  ok: boolean;
  /** True when the user dismissed the prompt rather than failing it. */
  cancelled?: boolean;
  error?: string;
}

const CANCEL_CODES: string[] = [
  BiometryErrorType.userCancel,
  BiometryErrorType.systemCancel,
  BiometryErrorType.appCancel,
  BiometryErrorType.userFallback,
];

export async function checkBiometric(): Promise<BiometricStatus> {
  if (!Capacitor.isNativePlatform()) {
    return { available: false, reason: 'Biometric unlock is only available in the mobile app.' };
  }
  try {
    const res = await BiometricAuth.checkBiometry();
    // Either enrolled biometry, or a secured device we can fall back to.
    const available = res.isAvailable || res.deviceIsSecure;
    return { available, reason: available ? '' : res.reason || 'No device lock is set up.' };
  } catch (error) {
    return { available: false, reason: (error as Error).message };
  }
}

export async function authenticate(reason = 'Unlock PathoMitra'): Promise<BiometricResult> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, error: 'Biometric unlock is only available in the mobile app.' };
  }
  try {
    // Only the title is set on purpose. Passing the same string as title,
    // subtitle *and* description made the system sheet print "Unlock PathoMitra
    // OS" three times over; the app name is already shown by the OS above it.
    await BiometricAuth.authenticate({
      androidTitle: reason,
      allowDeviceCredential: true,
    });
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code && CANCEL_CODES.includes(code)) return { ok: false, cancelled: true };
    return { ok: false, error: (error as Error).message || 'Authentication failed.' };
  }
}
