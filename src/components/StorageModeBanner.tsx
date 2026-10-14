import { ShieldAlert } from 'lucide-react';
import { UNPROTECTED_STORAGE_WARNING, isUnprotectedProductionStore } from '../lib/storage-mode';

/**
 * A persistent, non-dismissible disclosure shown only when a production build is
 * storing clinical records in unprotected browser storage (P0.1).
 *
 * Renders nothing in an installed shell or in dev/test — the point is not to nag
 * during development, it is to make sure a hosted browser build can never quietly
 * pass its plain localStorage off as the protected on-device store. The operator
 * sees the boundary before they can create or import a record.
 */
export function StorageModeBanner() {
  if (!isUnprotectedProductionStore()) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-error/30 bg-error-container/70 px-4 py-2.5 text-xs font-medium text-on-error-container"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{UNPROTECTED_STORAGE_WARNING}</span>
    </div>
  );
}

export default StorageModeBanner;
