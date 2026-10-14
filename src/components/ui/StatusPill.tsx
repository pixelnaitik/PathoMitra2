/**
 * <StatusPill> — semantic status chips (final / pending / high / low / normal).
 * Replaces the scattered bg-green-50/text-amber-700 literals with tokens that
 * work in both light and dark mode.
 */
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type PillTone = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'accent';

const TONES: Record<PillTone, string> = {
  success: 'bg-success-container text-on-success-container',
  warning: 'bg-warning-container text-on-warning-container',
  error: 'bg-error-container text-on-error-container',
  info: 'bg-info-container text-on-info-container',
  accent: 'bg-accent/12 text-accent',
  neutral: 'bg-surface-container-high text-on-surface-variant',
};

const DOTS: Record<PillTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  info: 'bg-info',
  accent: 'bg-accent',
  neutral: 'bg-outline',
};

export function StatusPill({
  tone = 'neutral',
  children,
  dot,
  pulse,
  className,
}: {
  tone?: PillTone;
  children: ReactNode;
  dot?: boolean;
  /** Breathing animation on the dot — for live / in-progress states. */
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'animate-pop-in inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.01em]',
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full', DOTS[tone], pulse && 'animate-soft-pulse')}
        />
      )}
      {children}
    </span>
  );
}
