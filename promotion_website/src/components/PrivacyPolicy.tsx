/**
 * Public privacy-policy content for the static brochure.
 *
 * The app owns a second copy of this component plus an in-app Sheet version
 * reached from Settings → Security; the Sheet is intentionally absent here —
 * a static marketing site needs the page, not the modal. Section text lives in
 * `lib/privacy-policy.ts` so this file exports only components.
 */
import { PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from '../lib/privacy-policy';

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

export default PrivacyPolicyContent;
