/**
 * Shared <Button> — the single source of truth for pressable actions.
 * Pill-shaped, spring-press feedback, six variants, three sizes.
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { hapticMedium, hapticTap } from '../../lib/haptics';

export type ButtonVariant = 'primary' | 'brand' | 'neutral' | 'ghost' | 'outline' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  /** Solid brand fill — the main CTA. */
  brand:
    'bg-primary text-on-primary shadow-card hover:shadow-raised hover:brightness-110 active:brightness-95',
  /** Elevated neutral fill (iOS "secondary" button). */
  primary:
    'bg-surface-container-high text-on-surface hover:bg-surface-container-highest hover:shadow-card',
  neutral:
    'bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
  ghost: 'text-accent hover:bg-accent/10',
  outline:
    'border border-outline-variant text-on-surface hover:border-outline hover:bg-surface-container-high',
  danger: 'bg-error text-on-error shadow-card hover:shadow-raised hover:brightness-110',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3.5 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
};

const SPINNERS: Record<ButtonSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-4 w-4',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Adds the light-sweep micro-interaction. */
  shine?: boolean;
  /** Swaps in a spinner, blocks further presses and keeps full opacity. */
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'brand',
    size = 'md',
    shine,
    loading,
    fullWidth,
    disabled,
    className,
    children,
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={e => {
        // Destructive actions get a firmer tick than everything else.
        if (variant === 'danger') hapticMedium();
        else hapticTap();
        onClick?.(e);
      }}
      className={cn(
        'group inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-semibold',
        'disabled:pointer-events-none disabled:opacity-50',
        loading && 'cursor-wait disabled:opacity-100',
        VARIANTS[variant],
        SIZES[size],
        shine && !loading && 'btn-shine',
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 aria-hidden="true" className={cn('animate-spin', SPINNERS[size])} />}
      {children}
    </button>
  );
});

/** Square icon-only button. `label` is required and drives aria-label. */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    variant = 'neutral',
    size = 'md',
    className,
    children,
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  const box = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      onClick={e => {
        if (variant === 'danger') hapticMedium();
        else hapticTap();
        onClick?.(e);
      }}
      className={cn(
        'group inline-flex shrink-0 select-none items-center justify-center rounded-full',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        box,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
