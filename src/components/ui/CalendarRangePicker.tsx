/**
 * <CalendarRangePicker> — the date-range filter shared by every list page.
 *
 * Reports, Patients and Analytics each carried their own ~150-line copy of this
 * calendar (same `getDaysInMonth`, same four presets, same day grid). This is
 * the single version: trigger button + popover, arrow-key navigation across the
 * days, and an optional dot on every day that actually has data.
 *
 * Values are `YYYY-MM-DD` strings — the same shape `createdAt` is stored in, so
 * a page can hand them straight to a Firestore range filter.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Local-time `YYYY-MM-DD` for a Date (never `toISOString`, which shifts days by the UTC offset). */
export function toIsoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Inclusive day range used by the presets. */
export function presetRange(kind: 'today' | '7days' | '30days' | 'thisMonth'): {
  fromDate: string;
  toDate: string;
} {
  const today = new Date();
  const toDate = toIsoDay(today);
  if (kind === 'today') return { fromDate: toDate, toDate };
  const past = new Date(today);
  if (kind === '7days') past.setDate(today.getDate() - 7);
  if (kind === '30days') past.setDate(today.getDate() - 30);
  if (kind === 'thisMonth') past.setDate(1);
  return { fromDate: toIsoDay(past), toDate };
}

const PRESETS = [
  { kind: 'today', label: 'Today' },
  { kind: '7days', label: '7 Days' },
  { kind: '30days', label: '30 Days' },
  { kind: 'thisMonth', label: 'Month' },
] as const;

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export interface CalendarRangePickerProps {
  fromDate: string;
  toDate: string;
  /** Called for every pick, preset and clear — the filter applies live. */
  onChange: (range: { fromDate: string; toDate: string }) => void;
  /** Days that have data, rendered as a dot under the number. */
  activeDates?: Set<string>;
  /** Extra classes for the trigger wrapper (width/z-index of the popover follow it). */
  className?: string;
}

export function CalendarRangePicker({
  fromDate,
  toDate,
  onChange,
  activeDates,
  className,
}: CalendarRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => new Date());
  const gridRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const format = (dIso: string) => {
    const parsed = new Date(dIso);
    return Number.isNaN(parsed.getTime())
      ? dIso
      : parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const summary = (() => {
    if (!fromDate && !toDate) return 'All Dates';
    if (fromDate && !toDate) return `From ${format(fromDate)}`;
    if (!fromDate && toDate) return `To ${format(toDate)}`;
    return `${format(fromDate)} - ${format(toDate)}`;
  })();

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  const pick = (dIso: string) => {
    // First click starts a range; the second closes it, unless it would be
    // before the start — then it becomes the new start.
    if (!fromDate || (fromDate && toDate)) {
      onChange({ fromDate: dIso, toDate: '' });
      return;
    }
    if (dIso < fromDate) onChange({ fromDate: dIso, toDate: '' });
    else onChange({ fromDate, toDate: dIso });
  };

  /** Roving focus: arrows walk the grid instead of forcing Tab through 31 buttons. */
  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const days = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-day]') ?? [],
    );
    const current = days.findIndex(day => day === document.activeElement);
    if (current === -1) return;
    days[Math.min(Math.max(current + step, 0), days.length - 1)]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Dismiss on any click outside the control. A full-screen overlay would do
    // the same job, but it stays mounted while its exit animation plays and
    // silently swallows clicks on the page underneath.
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={`Filter by date range. Currently ${summary}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(current => !current)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-2xl border border-outline-variant/30 px-4 py-3',
          'bg-surface-container-lowest text-left font-semibold text-on-surface shadow-card',
          'transition hover:bg-surface-container-low focus:border-accent focus:outline-none',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Calendar className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate text-sm font-bold text-on-surface-variant">{summary}</span>
        </span>
        {fromDate || toDate ? (
          <X
            role="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={event => {
              event.stopPropagation();
              onChange({ fromDate: '', toDate: '' });
            }}
            className="h-4 w-4 shrink-0 cursor-pointer text-on-surface-variant hover:text-error"
          />
        ) : (
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'h-4 w-4 shrink-0 text-on-surface-variant transition-transform duration-200',
              open && 'rotate-90',
            )}
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              role="dialog"
              aria-label="Choose date range"
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              // The audit (UI-P1-02) flags the fixed `w-80` (320 px) panel
              // anchored `right-0`: a 320 px viewport with page gutters
              // cannot host a 320 px panel, so the day grid was clipped.
              // On phones the panel now stretches the full width of the
              // trigger (which every page already sizes to `w-full`),
              // and at >= sm it reverts to the old right-anchored 20 rem
              // popover. `max-w-[calc(100vw-1rem)]` clamps the wider
              // case too, so a foldable / narrow-window desktop resize
              // still fits.
              className="absolute left-0 right-0 z-50 mt-2 max-h-[min(26rem,70vh)] origin-top-right overflow-y-auto overscroll-contain rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-4 shadow-float max-w-[calc(100vw-1rem)] sm:left-auto sm:w-80"
            >
              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setViewDate(new Date(year, month - 1, 1))}
                  className="rounded-full p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-bold text-primary">
                  {viewDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                </span>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setViewDate(new Date(year, month + 1, 1))}
                  className="rounded-full p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="mb-3 grid grid-cols-4 gap-1">
                {PRESETS.map(preset => (
                  <button
                    key={preset.kind}
                    type="button"
                    onClick={() => {
                      onChange(presetRange(preset.kind));
                      setOpen(false);
                    }}
                    className="rounded-md border border-outline-variant/20 bg-surface-container-low px-1 py-1 text-center text-xs font-bold text-primary transition hover:border-primary/30 hover:bg-primary/5"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="mb-1 grid grid-cols-7 gap-1 text-center" aria-hidden="true">
                {WEEKDAYS.map(day => (
                  <span
                    key={day}
                    className="flex h-8 w-8 select-none items-center justify-center text-xs font-bold uppercase text-on-surface-variant"
                  >
                    {day}
                  </span>
                ))}
              </div>

              <div
                ref={gridRef}
                onKeyDown={onGridKeyDown}
                className="grid grid-cols-7 gap-1 text-center"
                role="group"
                aria-label="Days"
              >
                {Array.from({ length: firstDayIndex }).map((_, idx) => (
                  <span key={`pad-${idx}`} aria-hidden="true" className="h-8 w-8" />
                ))}
                {Array.from({ length: totalDays }).map((_, idx) => {
                  const dayNumber = idx + 1;
                  const dIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
                  const isEdge = dIso === fromDate || dIso === toDate;
                  const inRange = Boolean(fromDate && toDate && dIso >= fromDate && dIso <= toDate);
                  const hasData = activeDates?.has(dIso);

                  return (
                    <button
                      key={dIso}
                      data-day
                      type="button"
                      aria-label={new Date(year, month, dayNumber).toLocaleDateString('en-IN', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                      aria-pressed={isEdge}
                      onClick={() => pick(dIso)}
                      className={cn(
                        'relative flex h-8 w-8 flex-col items-center justify-center rounded-full text-xs font-bold transition hover:bg-primary/20',
                        isEdge &&
                          'bg-primary text-on-primary hover:bg-primary hover:text-on-primary',
                        !isEdge && inRange && 'bg-primary/10 text-primary hover:bg-primary/20',
                        !isEdge && !inRange && 'text-on-surface',
                      )}
                    >
                      <span>{dayNumber}</span>
                      {hasData && (
                        <span
                          className={cn(
                            'absolute bottom-1 h-1 w-1 rounded-full',
                            isEdge ? 'bg-surface-container-lowest' : 'bg-primary',
                          )}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-outline-variant/10 pt-3 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    onChange(presetRange('today'));
                    setViewDate(new Date());
                    setOpen(false);
                  }}
                  className="font-bold text-primary hover:underline"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ fromDate: '', toDate: '' });
                    setOpen(false);
                  }}
                  className="font-bold text-on-surface-variant hover:underline"
                >
                  Clear Filter
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
