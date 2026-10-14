/**
 * Terms-of-use React components for PathoMitra.
 *
 * Mirrors `components/PrivacyPolicy.tsx`: the section data lives in
 * `lib/terms.ts` so this file exports only components and Fast Refresh stays
 * happy, and the same content feeds the in-app sheet and the public page.
 */
import { Sheet } from './ui';
import { TERMS_LAST_UPDATED, TERMS_SECTIONS, TERMS_VERSION } from '../lib/terms';

/** The terms body as a plain vertical stack — reusable on web and in a sheet. */
export function TermsContent({ className = '' }: { className?: string }) {
  return (
    <div className={`space-y-6 text-sm leading-relaxed text-on-surface-variant ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">
        Version {TERMS_VERSION} · Last updated {TERMS_LAST_UPDATED}
      </p>
      {TERMS_SECTIONS.map(section => (
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

/** Modal version, opened from the account setup screen and Settings → Security. */
export function TermsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Terms & Conditions of Use" width="md">
      <TermsContent />
    </Sheet>
  );
}

export default TermsContent;
