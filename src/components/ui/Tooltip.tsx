/**
 * <Tooltip> — lightweight hover/focus tooltip for collapsed sidebar icons.
 * Uses a portal to avoid overflow clipping. Appears after a short delay.
 */
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/utils';

export interface TooltipProps {
  label: string;
  children: ReactNode;
  /** Placement relative to the trigger. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

export function Tooltip({ label, children, side = 'right', className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    timerRef.current = setTimeout(() => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      let x = 0,
        y = 0;
      switch (side) {
        case 'right':
          x = rect.right + 8;
          y = rect.top + rect.height / 2;
          break;
        case 'left':
          x = rect.left - 8;
          y = rect.top + rect.height / 2;
          break;
        case 'top':
          x = rect.left + rect.width / 2;
          y = rect.top - 8;
          break;
        case 'bottom':
          x = rect.left + rect.width / 2;
          y = rect.bottom + 8;
          break;
      }
      setCoords({ x, y });
      setOpen(true);
    }, 400);
  };

  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  };

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const positionClasses: Record<string, string> = {
    right: '-translate-y-1/2',
    left: '-translate-y-1/2 -translate-x-full',
    top: '-translate-x-1/2 -translate-y-full',
    bottom: '-translate-x-1/2',
  };

  if (typeof document === 'undefined') return <>{children}</>;

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={cn('contents', className)}
      >
        {children}
      </div>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              role="tooltip"
              className={cn(
                'pointer-events-none fixed z-[9999] rounded-lg px-2.5 py-1.5',
                'bg-on-surface text-surface text-xs font-semibold whitespace-nowrap shadow-raised',
                positionClasses[side],
              )}
              style={{ left: coords.x, top: coords.y }}
            >
              {label}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
