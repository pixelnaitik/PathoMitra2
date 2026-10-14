/**
 * Blocking terms-re-acceptance gate.
 *
 * Accounts created before the terms screen existed have no acceptance on record,
 * and any bump to `TERMS_VERSION` invalidates the old one. Both cases land here:
 * the dashboard is mounted but not usable until the operator has read the current
 * text and ticked the undertaking again.
 *
 * Deliberately not built on <Sheet> — that component owns escape/back handling
 * and would let the screen be dismissed without accepting. This is a modal that
 * has exactly one exit.
 */
import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { Button } from './ui';
import { TermsContent } from './Terms';
import { ONBOARDING_ATTESTATION, TERMS_VERSION } from '../lib/terms';
import { useAuth } from '../contexts/AuthContext';

export function TermsGate() {
  const { termsPending, acceptCurrentTerms } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!termsPending) return null;

  const onAccept = async () => {
    if (!accepted) {
      setError('Tick the statement above to continue.');
      return;
    }
    setBusy(true);
    try {
      await acceptCurrentTerms();
    } catch (e) {
      setError((e as Error).message || 'Could not record your acceptance.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-gate-title"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4"
    >
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[var(--elevated-border)] bg-surface shadow-float">
        <header className="flex items-center gap-3 border-b border-outline-variant/40 px-5 py-4">
          <ScrollText className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="terms-gate-title" className="text-base font-bold leading-tight text-on-surface">
              Terms have changed — please review
            </h2>
            <p className="text-xs text-on-surface-variant">
              Version {TERMS_VERSION}. You must accept before opening the lab console.
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <TermsContent />
        </div>

        <footer className="space-y-3 border-t border-outline-variant/40 bg-surface-container-low px-5 py-4">
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-error-container px-3 py-2 text-xs font-semibold text-on-error-container"
            >
              {error}
            </p>
          )}
          <label className="flex min-h-12 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={accepted}
              onChange={e => {
                setAccepted(e.target.checked);
                setError(null);
              }}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--md-sys-color-primary,#0a5ea6)]"
            />
            <span className="text-xs leading-relaxed text-on-surface">
              {ONBOARDING_ATTESTATION}
            </span>
          </label>
          <Button
            variant="primary"
            size="md"
            onClick={() => void onAccept()}
            disabled={busy || !accepted}
            className="w-full"
          >
            {busy ? 'Saving…' : 'Accept and continue'}
          </Button>
        </footer>
      </div>
    </div>
  );
}

export default TermsGate;
