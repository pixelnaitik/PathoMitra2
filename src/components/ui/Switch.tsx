/**
 * <Switch> — iOS-style toggle (51×31 track, spring knob).
 * Pressing squashes the knob wider (transform-origin follows the knob side)
 * so the control answers the touch before the value changes.
 */
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { hapticTap } from '../../lib/haptics';

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name for the switch. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        hapticTap();
        onChange(!checked);
      }}
      className={cn(
        'relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-300',
        checked ? 'bg-success' : 'bg-surface-container-highest',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {/* Pure transform travel (no `left`, no layout projection) — the spring
         and the press-squash both ride the compositor. */}
      <motion.span
        animate={{ x: checked ? 20 : 0 }}
        whileTap={{ scaleX: 1.16 }}
        transition={{ type: 'spring', stiffness: 600, damping: 32 }}
        style={{ transformOrigin: checked ? 'right center' : 'left center' }}
        className={cn(
          'absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white',
          'shadow-[0_2px_6px_rgba(0,0,0,0.25)]',
        )}
      />
    </motion.button>
  );
}
