/**
 * <Disclosure> — a collapsible settings group for progressive disclosure.
 * Frequently-used groups start open; advanced ones stay closed until asked.
 * Button + region pattern: fully keyboard operable, state announced.
 */
import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface DisclosureProps {
  title: string;
  /** Small summary line shown when closed (e.g. "Margins · paper size"). */
  summary?: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export function Disclosure({
  title,
  summary,
  icon,
  defaultOpen = true,
  children,
  className,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section
      className={cn(
        'overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container-lowest',
        className,
      )}
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen(v => !v)}
          className={cn(
            'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors',
            'hover:bg-surface-container-low focus-visible:bg-surface-container-low',
          )}
        >
          {icon && (
            <span className="shrink-0 text-primary" aria-hidden="true">
              {icon}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-on-surface">{title}</span>
            {!open && summary && (
              <span className="mt-0.5 block truncate text-xs text-on-surface-variant">
                {summary}
              </span>
            )}
          </span>
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.18 }}
            className="shrink-0 text-on-surface-variant"
            aria-hidden="true"
          >
            <ChevronDown className="h-4 w-4" />
          </motion.span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key={contentId}
            id={contentId}
            role="region"
            aria-label={title}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-5 border-t border-outline-variant/30 px-4 py-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
