/**
 * <Combobox> — a text field with a suggestion list, for results that have
 * standard values (Negative, 1:80, REACTIVE…) but must still accept a
 * write-in answer.
 *
 * It replaces `<input list>` + `<datalist>`, which the browser renders as its
 * own un-themeable popup: inside the report Sheet it detached to the corner of
 * the screen, ignored light/dark mode, and gave no keyboard affordance.
 *
 * The panel is portalled and positioned against the input so no scrolling or
 * `overflow-hidden` ancestor can clip it, and it flips above when there is more
 * room there.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

const PANEL_MAX_HEIGHT = 224;

export interface ComboboxProps {
  value: string;
  options: string[];
  /** Fires for typed text as well as picks — any value in `options` is optional. */
  onChange: (next: string) => void;
  /** Called for keys the list does not consume, so Enter can still move to the next field. */
  onNavigate?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  ariaLabel?: string;
  /** Classes for the wrapper — carry the flex sizing here. */
  className?: string;
  inputClassName?: string;
  inputMode?: 'text' | 'decimal' | 'numeric' | 'search';
  /** Read-only role: shows the value without offering the list at all. */
  readOnly?: boolean;
}

export function Combobox({
  value,
  options,
  onChange,
  onNavigate,
  placeholder,
  ariaLabel,
  className,
  inputClassName,
  inputMode = 'text',
  readOnly = false,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelStyle, setPanelStyle] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  }>({
    left: 0,
    width: 0,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  /** Set when committing has to pull focus back, so that focus does not re-open the list. */
  const refocusingRef = useRef(false);
  const listboxId = useId();

  // Typing narrows the list; an exact match re-expands it so the other values
  // stay reachable instead of vanishing behind the text already entered.
  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return options;
    if (options.some(option => option.toLowerCase() === query)) return options;
    return options.filter(option => option.toLowerCase().includes(query));
  }, [options, value]);

  const isCustomValue =
    value.trim().length > 0 &&
    !options.some(option => option.toLowerCase() === value.trim().toLowerCase());

  // Narrowing the list can leave the highlight past the end, so the index is
  // clamped where it is read rather than reset from an effect.
  const active = filtered.length > 0 ? Math.min(activeIndex, filtered.length - 1) : -1;

  // Keyboard navigation must keep the highlighted option visible — without
  // this, arrowing past the 224px viewport highlights an invisible row.
  useEffect(() => {
    if (!open || active < 0) return;
    const option = listRef.current?.querySelector<HTMLElement>(
      `#${CSS.escape(`${listboxId}-${active}`)}`,
    );
    // jsdom has no scrollIntoView — feature-check so tests don't crash.
    if (option && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }, [open, active, listboxId]);

  const openList = () => {
    if (readOnly) return;
    setActiveIndex(0);
    setOpen(true);
  };

  const place = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const height = Math.min(listRef.current?.scrollHeight ?? PANEL_MAX_HEIGHT, PANEL_MAX_HEIGHT);
    const spaceBelow = window.innerHeight - rect.bottom;
    const flip = spaceBelow < height + 12 && rect.top > spaceBelow;
    setPanelStyle({
      left: rect.left,
      width: rect.width,
      top: flip ? undefined : rect.bottom + 6,
      bottom: flip ? window.innerHeight - rect.top + 6 : undefined,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    // The panel is fixed to the viewport, so it must follow any scroll — including
    // the report Sheet's own scroll container.
    const onMove = () => place();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, place]);

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
    // A pick should leave the caret in the field without popping the list open
    // again, so the focus event it may cause is swallowed once.
    if (document.activeElement !== inputRef.current) {
      refocusingRef.current = true;
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      // Browsing keys open the list; everything else (Enter / arrows once the
      // list is shut) keeps the lab's existing "jump to next result" behaviour.
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        (event.key === ' ' && filtered.length > 0)
      ) {
        event.preventDefault();
        event.stopPropagation();
        openList();
        return;
      }
      onNavigate?.(event);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (filtered.length === 0) return;
      setActiveIndex(current => {
        const next = current + (event.key === 'ArrowDown' ? 1 : -1);
        return (next + filtered.length) % filtered.length;
      });
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      if (filtered.length > 0) setActiveIndex(event.key === 'Home' ? 0 : filtered.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      // Enter picks the highlighted suggestion; with nothing to pick it falls
      // through so the row still advances.
      if (active >= 0) {
        event.preventDefault();
        event.stopPropagation();
        commit(filtered[active]);
        return;
      }
      setOpen(false);
      onNavigate?.(event);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listboxId}-${active}` : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onFocus={() => {
          if (refocusingRef.current) {
            refocusingRef.current = false;
            return;
          }
          if (!readOnly && filtered.length > 0) openList();
        }}
        onChange={event => {
          onChange(event.target.value);
          openList();
        }}
        onKeyDown={onKeyDown}
        className={cn('pr-10', inputClassName)}
      />
      {!readOnly && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? 'Hide options' : 'Show options'}
          onClick={() => {
            if (open) {
              setOpen(false);
              return;
            }
            inputRef.current?.focus();
            setOpen(true);
          }}
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <ChevronDown
            className={cn('h-4 w-4 transition-transform duration-200', open && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      )}

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {/* Stays open with no matches so a write-in answer is confirmed
                rather than looking like a rejected input. */}
            {open && (filtered.length > 0 || isCustomValue) && (
              <motion.ul
                id={listboxId}
                ref={listRef}
                role="listbox"
                aria-label={`${ariaLabel ?? 'Options'} suggestions`}
                initial={{ opacity: 0, y: -4, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.99 }}
                transition={{ duration: 0.14 }}
                style={{ ...panelStyle, maxHeight: PANEL_MAX_HEIGHT }}
                className={cn(
                  'fixed z-[100] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--elevated-border)]',
                  'bg-surface-container-lowest py-1 shadow-float',
                )}
                onMouseDown={event => event.preventDefault()}
              >
                {filtered.map((option, index) => {
                  const selected = option === value;
                  return (
                    <li
                      key={option}
                      id={`${listboxId}-${index}`}
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => commit(option)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 px-3.5 py-2 text-sm font-semibold transition-colors',
                        index === active ? 'bg-accent/12 text-accent' : 'text-on-surface',
                      )}
                    >
                      <span className="flex-1 truncate">{option}</span>
                      {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    </li>
                  );
                })}
                {isCustomValue && (
                  <li className="mt-1 border-t border-outline-variant/40 px-3.5 py-2 text-[11px] font-medium text-on-surface-variant">
                    “{value.trim()}” is not a listed value — it will be saved as written.
                  </li>
                )}
              </motion.ul>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
