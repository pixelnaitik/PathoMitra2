/**
 * <Card> — the elevated surface every panel, tile and modal body is built on.
 * Light: white on the warm-gray canvas. Dark: subtle raised panel + hairline.
 * `interactive` adds a hover lift plus a cursor-tracking accent spotlight.
 */
import type { HTMLAttributes, ReactNode, PointerEvent } from 'react';
import { cn } from '../../lib/utils';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: ReactNode;
  /** Adds hover-lift + press micro-interactions (implies clickable). */
  interactive?: boolean;
  /** Tight (p-4) / regular (p-5) / roomy (p-6) padding. */
  pad?: 'sm' | 'md' | 'lg' | 'none';
}

const PADS = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6' } as const;

export function Card({
  interactive,
  pad = 'md',
  className,
  children,
  onPointerMove,
  ...rest
}: CardProps) {
  // Track the pointer in CSS vars so the spotlight glow follows the cursor
  // without triggering a React re-render.
  const trackSpotlight = (e: PointerEvent<HTMLDivElement>) => {
    if (interactive) {
      const rect = e.currentTarget.getBoundingClientRect();
      e.currentTarget.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
      e.currentTarget.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
    }
    onPointerMove?.(e);
  };

  return (
    <div
      onPointerMove={trackSpotlight}
      className={cn(
        'rounded-3xl border border-[var(--elevated-border)] bg-surface-container-lowest shadow-card',
        PADS[pad],
        interactive && 'card-hover spotlight cursor-pointer',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Section heading used above cards / rails inside pages. */
export function SectionTitle({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-end justify-between gap-3', className)}>
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-on-surface sm:text-lg">
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-on-surface-variant">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
