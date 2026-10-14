/**
 * iOS-style segmented control with a sliding pill indicator.
 * Used for tab pairs (Print/Share), filter modes, page tabs, etc.
 */
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { hapticSelection } from '../../lib/haptics';

export interface SegmentItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  items: SegmentItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Must be unique per screen — keys the shared layout indicator. */
  id: string;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  id,
  size = 'md',
  className,
  ...aria
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={aria['aria-label'] ?? 'View options'}
      className={cn(
        'inline-flex w-full items-center gap-1 rounded-full bg-surface-container-high p-1',
        className,
      )}
    >
      {items.map(item => {
        const active = item.value === value;
        return (
          <motion.button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              // Only tick when the selection actually moves, not on re-taps.
              if (!active) hapticSelection();
              onChange(item.value);
            }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={cn(
              'relative z-10 flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full font-semibold transition-colors',
              size === 'sm' ? 'h-7 px-3 text-[12px]' : 'h-9 px-4 text-[13px]',
              active ? 'text-on-surface' : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            {active && (
              <motion.span
                layoutId={`segment-${id}`}
                transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                className="absolute inset-0 -z-10 rounded-full bg-surface-container-lowest shadow-card"
              />
            )}
            {item.icon}
            <span className="truncate">{item.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
