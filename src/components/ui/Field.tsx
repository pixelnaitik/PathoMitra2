/**
 * Form field primitives — one label/feedback contract for every input:
 * <Field label> wraps TextInput / TextArea / Select / native controls.
 */
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useShakeOnNewError } from '../../hooks/useShakeOnNewError';

export const CONTROL_BASE =
  'h-11 w-full rounded-xl border border-outline-variant bg-surface-container-low px-3.5 text-sm text-on-surface ' +
  'placeholder:text-on-surface-variant transition-[border-color,background-color,color,box-shadow] ' +
  'hover:border-outline focus:border-accent focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-error';

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const autoId = useId();
  const inputId = htmlFor ?? autoId;
  const shaking = useShakeOnNewError(error);

  // Attach the generated id to the wrapped control so <label> points at it.
  const control =
    isValidElement(children) && !(children.props as { id?: string }).id
      ? cloneElement(children as ReactElement<{ id: string }>, { id: inputId })
      : children;

  return (
    <div className={cn('group space-y-1.5', className)}>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-[13px] font-semibold text-on-surface-variant transition-colors duration-200 group-focus-within:text-accent"
        >
          {label}
          {required && (
            <span className="ml-0.5 text-error" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {control && <div className={cn(shaking && 'animate-shake-x')}>{control}</div>}
      {error ? (
        <p role="alert" className="animate-rise-in text-xs font-medium text-error">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-on-surface-variant">{hint}</p>
      ) : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(CONTROL_BASE, className)} {...rest} />;
  },
);

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(CONTROL_BASE, 'h-auto min-h-[88px] py-2.5 leading-relaxed', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(CONTROL_BASE, 'cursor-pointer appearance-none pr-10', className)}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
        />
      </div>
    );
  },
);
