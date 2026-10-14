/**
 * <Sheet> — the app's only modal.
 * Mobile: draggable-looking bottom sheet with grab handle over a blurred scrim;
 * pulling the header/handle down past a threshold dismisses it.
 * Desktop: centered dialog. Escape + scrim click close it; scroll is locked.
 * Focus moves in on open, is trapped while open, and returns to the trigger on
 * close — without it, Tab walks straight out of the dialog into the page behind.
 *
 * Replaces the hand-rolled `fixed inset-0 flex items-end sm:items-center`
 * markup that every dashboard page used to duplicate.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { BACK_PRIORITY, useBackHandler } from '../../lib/back-button';
import { IconButton } from './Button';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Sticky footer area (actions). */
  footer?: ReactNode;
  /** Max width of the desktop dialog. */
  width?: 'sm' | 'md' | 'lg' | 'xl';
  /** Set for destructive/confirm sheets that shouldn't close on scrim click. */
  dismissible?: boolean;
  className?: string;
}

const WIDTHS = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
} as const;

/** Focusable, non-disabled descendants that are actually rendered. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tabbableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    element =>
      element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement,
  );
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
  dismissible = true,
  className,
}: SheetProps) {
  // The pull-down gesture is mobile-only — on desktop the dialog is centered.
  const [canDrag, setCanDrag] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  /** What had focus before the dialog opened — where Tab must land afterwards. */
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setCanDrag(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, dismissible]);

  // Android Back dismisses the front-most sheet. A sheet that declared itself
  // non-dismissible keeps the press without closing — letting the route pop
  // underneath an open modal would strand it, and the whole point of that flag
  // is that there is no safe way out of this sheet yet.
  useBackHandler(
    useCallback(() => {
      if (!open) return false;
      if (dismissible) onClose();
      return true;
    }, [open, dismissible, onClose]),
    open,
    BACK_PRIORITY.OVERLAY,
  );

  // Move focus in on open and hand it back on close. The dialog paints on the
  // next frame (AnimatePresence), so the initial focus is deferred one frame.
  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = (document.activeElement as HTMLElement | null) ?? null;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      (tabbableWithin(panel)[0] ?? panel).focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      returnFocusTo.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  /** Keep Tab/Shift+Tab inside the dialog while it is open. */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = tabbableWithin(panel);
    if (items.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (typeof document === 'undefined') return null;

  const draggable = canDrag && dismissible;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Scrim — frosted, Apple-style */}
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[6px]"
            onClick={() => dismissible && onClose()}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? `${titleId}-desc` : undefined}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            initial={{ y: 48, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 48, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className={cn(
              'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-4xl',
              'border border-[var(--elevated-border)] bg-surface sm:rounded-4xl sm:shadow-float',
              WIDTHS[width],
              className,
            )}
          >
            {/* Drag surface — grab handle + header; pull down to dismiss (mobile) */}
            <motion.div
              drag={draggable ? 'y' : false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.05, bottom: 0.5 }}
              dragMomentum={false}
              onDragEnd={(_, info) => {
                if (info.offset.y > 110 || info.velocity.y > 800) onClose();
              }}
              style={draggable ? { touchAction: 'none' } : undefined}
              className={draggable ? 'cursor-grab active:cursor-grabbing' : undefined}
            >
              <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
                <span className="h-1.5 w-10 rounded-full bg-outline-variant" />
              </div>
              {(title || description) && (
                <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4 sm:pt-5">
                  <div className="min-w-0">
                    {title && (
                      <h2
                        id={titleId}
                        className="truncate text-lg font-bold tracking-[-0.02em] text-on-surface"
                      >
                        {title}
                      </h2>
                    )}
                    {description && (
                      <p
                        className="mt-0.5 text-[13px] text-on-surface-variant"
                        id={`${titleId}-desc`}
                      >
                        {description}
                      </p>
                    )}
                  </div>
                  {dismissible && (
                    <IconButton label="Close" size="sm" variant="primary" onClick={onClose}>
                      <X className="h-4 w-4" />
                    </IconButton>
                  )}
                </div>
              )}
            </motion.div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
              {children}
            </div>
            {footer && (
              <div className="border-t border-outline-variant/60 bg-surface-container-low/60 px-5 py-4 pb-[calc(1rem+var(--safe-bottom))]">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Small confirm sheet used for deletes across pages. */
export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Delete',
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  loading?: boolean;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-12 flex-1 rounded-full bg-surface-container-high text-[15px] font-semibold text-on-surface transition active:scale-[0.97]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className="h-12 flex-1 rounded-full bg-error text-[15px] font-semibold text-on-error shadow-card transition hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </div>
      }
    >
      <p className="pb-2 text-sm leading-relaxed text-on-surface-variant">{message}</p>
    </Sheet>
  );
}
