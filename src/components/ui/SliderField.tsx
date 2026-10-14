/**
 * <SliderField> — the app's control for every report-layout number.
 * Slider for quick visual adjustments (touch friendly), an optional exact
 * number entry for precision, and the unit (mm / pt) always visible.
 * Values outside the range are clamped and explained instead of rejected.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useShakeOnNewError } from '../../hooks/useShakeOnNewError';
import type { ReportFieldSpec } from '../../lib/report-layout-spec';
import { formatFieldValue, sanitizeFieldValue } from '../../lib/report-layout-spec';

export interface SliderFieldProps {
  spec: ReportFieldSpec;
  value: number;
  /** Fired on every change (slider drag included) — drives the live preview. */
  onChange: (next: number) => void;
  /**
   * When set, intermediate changes flow through `onChange` but the final
   * value is emitted after 350 ms of quiet — use for history/undo commits.
   */
  onCommit?: (next: number) => void;
  labelOverride?: string;
  hintOverride?: string;
  /** Cross-field problem affecting this control. Explains cause + fix. */
  error?: string;
  disabled?: boolean;
  className?: string;
}

export function SliderField({
  spec,
  value,
  onChange,
  onCommit,
  labelOverride,
  hintOverride,
  error,
  disabled,
  className,
}: SliderFieldProps) {
  const id = useId();
  const [text, setText] = useState<string | null>(null); // non-null only while typing
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (commitTimer.current) clearTimeout(commitTimer.current);
    };
  }, []);

  const emit = (next: number) => {
    onChange(next);
    if (onCommit) {
      if (commitTimer.current) clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => onCommit(next), 350);
    }
  };

  // Explain silent clamping when an exact-value entry is out of range.
  const clampNote =
    text !== null && Number.isFinite(Number(text)) && text.trim() !== ''
      ? Number(text) < spec.min
        ? `Not usable below ${spec.min} ${spec.kind} — set to the minimum.`
        : Number(text) > spec.max
          ? `Maximum is ${spec.max} ${spec.kind} — clamped.`
          : null
      : null;

  const atMin = value <= spec.min;
  const atMax = value >= spec.max;
  // Shake the slider row the moment a cross-field error appears — event,
  // not persisted state (see useShakeOnNewError).
  const shaking = useShakeOnNewError(error);

  const handleNumberEntry = (raw: string) => {
    setText(raw);
    if (raw.trim() === '') return;
    const n = Number(raw);
    if (Number.isFinite(n)) emit(sanitizeFieldValue(spec, n));
  };

  return (
    <div className={cn('space-y-1.5', disabled && 'opacity-60', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="block text-[13px] font-semibold text-on-surface-variant">
          {labelOverride ?? spec.label}
        </label>
        <span
          className={cn(
            'font-mono text-xs font-bold tabular-nums',
            error ? 'text-error' : 'text-on-surface',
          )}
          aria-hidden="true"
        >
          {formatFieldValue(spec, value)}
        </span>
      </div>

      <div className={cn('flex items-center gap-3', shaking && 'animate-shake-x')}>
        <input
          id={id}
          type="range"
          className="slider-field range-input min-w-0 flex-1"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          disabled={disabled}
          aria-valuetext={formatFieldValue(spec, value)}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          onChange={e => emit(sanitizeFieldValue(spec, Number(e.target.value)))}
        />
        <input
          type="number"
          className={cn(
            'slider-field h-9 w-[74px] shrink-0 rounded-xl border bg-surface-container-low px-2 text-center font-mono text-[13px] tabular-nums text-on-surface',
            'transition-[border-color,box-shadow] hover:border-outline focus:border-accent focus:outline-none',
            error ? 'border-error' : 'border-outline-variant',
          )}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={text !== null ? text : String(value)}
          disabled={disabled}
          aria-label={`${labelOverride ?? spec.label}, exact value in ${spec.kind}`}
          onFocus={() => setText(String(value))}
          onChange={e => handleNumberEntry(e.target.value)}
          onBlur={e => {
            setText(null);
            const n = Number(e.target.value);
            if (e.target.value.trim() === '' || !Number.isFinite(n)) return;
            const fixed = sanitizeFieldValue(spec, n);
            if (fixed !== value) emit(fixed);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>

      {/* Non-color feedback channel: icon + sentence, never red alone. */}
      {error || clampNote ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="flex items-start gap-1.5 text-xs font-medium text-error"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error ?? clampNote}
        </p>
      ) : (
        (hintOverride ?? spec.hint) && (
          <p className="text-xs leading-snug text-on-surface-variant">
            {hintOverride ?? spec.hint}
            {(atMin || atMax) && (
              <span className="text-on-surface-variant/80">
                {' '}
                · {atMin ? `minimum ${spec.min}` : `maximum ${spec.max}`} {spec.kind}
              </span>
            )}
          </p>
        )
      )}
    </div>
  );
}
