/**
 * Privacy-policy React components for PathoMitra.
 *
 * Two surfaces share this content:
 *   1. the public web page (`/privacy`) that the Google Play listing links to,
 *   2. the in-app sheet reached from Settings → Security.
 *
 * The section data lives in `src/lib/privacy-policy.ts` (kept out of this file
 * so it exports only components and Fast Refresh stays happy).
 */
import { Sheet } from './ui';
import { PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from '../lib/privacy-policy';

/** The policy body as a plain vertical stack — reusable on web and in a sheet. */
export function PrivacyPolicyContent({ className = '' }: { className?: string }) {
  return (
    <div className={`space-y-6 text-sm leading-relaxed text-on-surface-variant ${className}`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Last updated: {PRIVACY_LAST_UPDATED}
        </p>
        <p className="mt-1 text-xs text-on-surface-variant">
          PathoMitra stores and processes data entirely on your device. This build does not request
          network access, so your records and your patients&rsquo; health information are never
          transmitted to us or anyone else.
        </p>
      </div>
      {PRIVACY_SECTIONS.map(section => (
        <section key={section.heading}>
          <h3 className="mb-2 text-base font-bold text-primary">{section.heading}</h3>
          {section.body.map((paragraph, index) => (
            <p key={index} className="mb-2 last:mb-0">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

/** In-app modal version, opened from Settings → Security. */
export function PrivacyPolicySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Privacy Policy" width="md">
      <PrivacyPolicyContent />
    </Sheet>
  );
}

export default PrivacyPolicyContent;
