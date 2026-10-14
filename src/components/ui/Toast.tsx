/**
 * Toast notification system — lightweight, animated feedback for user actions.
 * Mobile: bottom-center stack. Desktop: top-right stack.
 * Uses the app's design tokens and spring animations.
 * The auto-dismiss timer pauses while a toast is hovered/focused (WCAG 2.2.1 —
 * feedback must be readable without racing a timeout) and a drag flick dismisses.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { SPRING } from '../../lib/motion';
import { hapticError, hapticSuccess, hapticTap, hapticWarning } from '../../lib/haptics';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  duration: number;
  /** True while the pointer/focus holds the timer — drives the progress bar's play-state. */
  paused?: boolean;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
});

export const useToast = () => useContext(ToastContext);

const TONE_CONFIG: Record<ToastTone, { icon: typeof CheckCircle2; bg: string; text: string }> = {
  success: { icon: CheckCircle2, bg: 'bg-success-container', text: 'text-on-success-container' },
  error: { icon: XCircle, bg: 'bg-error-container', text: 'text-on-error-container' },
  warning: { icon: AlertTriangle, bg: 'bg-warning-container', text: 'text-on-warning-container' },
  info: { icon: Info, bg: 'bg-info-container', text: 'text-on-info-container' },
};

let nextId = 0;

/** One running timer with the bookkeeping needed to pause and resume it. */
interface TimerEntry {
  handle: ReturnType<typeof setTimeout>;
  startedAt: number;
  remaining: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, TimerEntry>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const entry = timersRef.current.get(id);
    if (entry) {
      clearTimeout(entry.handle);
      timersRef.current.delete(id);
    }
  }, []);

  const schedule = useCallback(
    (id: number, remaining: number) => {
      const entry = timersRef.current.get(id);
      if (!entry) return;
      entry.startedAt = Date.now();
      entry.remaining = remaining;
      entry.handle = setTimeout(() => dismiss(id), remaining);
    },
    [dismiss],
  );

  const pause = useCallback((id: number) => {
    const entry = timersRef.current.get(id);
    if (!entry) return;
    clearTimeout(entry.handle);
    entry.remaining -= Date.now() - entry.startedAt;
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, paused: true } : t)));
  }, []);

  const resume = useCallback(
    (id: number) => {
      const toast = toasts.find(t => t.id === id);
      if (!toast || !timersRef.current.has(id) || !toast.paused) return;
      setToasts(prev => prev.map(t => (t.id === id ? { ...t, paused: false } : t)));
      const entry = timersRef.current.get(id);
      if (entry) schedule(id, Math.max(entry.remaining, 800));
    },
    [toasts, schedule],
  );

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info', duration = 3500) => {
      const id = ++nextId;
      // Feel follows the message: the platform's success / warning / error
      // patterns for outcomes, a light tick for plain info.
      if (tone === 'success') hapticSuccess();
      else if (tone === 'error') hapticError();
      else if (tone === 'warning') hapticWarning();
      else hapticTap();
      setToasts(prev => [...prev.slice(-4), { id, message, tone, duration }]);
      timersRef.current.set(id, {
        handle: setTimeout(() => dismiss(id), duration),
        startedAt: Date.now(),
        remaining: duration,
      });
    },
    [dismiss],
  );

  const value: ToastContextValue = {
    toast,
    success: (msg, dur) => toast(msg, 'success', dur),
    error: (msg, dur) => toast(msg, 'error', dur),
    warning: (msg, dur) => toast(msg, 'warning', dur),
    info: (msg, dur) => toast(msg, 'info', dur),
  };

  if (typeof document === 'undefined') return <>{children}</>;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          aria-atomic="false"
          className={cn(
            'pointer-events-none fixed z-[9999] flex flex-col gap-2 px-4',
            // Clears the floating tab bar (top edge at safe-area + 4.75rem) *and*
            // the register-patient FAB above it (top edge at + 9rem), so feedback
            // never lands on top of a control — on any device, inset or not.
            'bottom-[calc(var(--safe-bottom)_+_9.5rem)] left-1/2 -translate-x-1/2 w-full max-w-sm',
            'sm:bottom-auto sm:top-5 sm:left-auto sm:right-5 sm:translate-x-0 sm:max-w-xs',
          )}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {toasts.map(t => {
              const cfg = TONE_CONFIG[t.tone];
              const Icon = cfg.icon;
              return (
                <motion.div
                  key={t.id}
                  layout
                  drag="y"
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={0.5}
                  dragMomentum={false}
                  onDragEnd={(_, info) => {
                    if (Math.abs(info.offset.y) > 60 || Math.abs(info.velocity.y) > 500) {
                      dismiss(t.id);
                    }
                  }}
                  onPointerEnter={() => pause(t.id)}
                  onPointerLeave={() => resume(t.id)}
                  onFocusCapture={() => pause(t.id)}
                  onBlurCapture={() => resume(t.id)}
                  initial={{ opacity: 0, y: 24, scale: 0.92 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9, y: -8 }}
                  transition={SPRING.press}
                  className={cn(
                    'pointer-events-auto relative flex items-center gap-3 overflow-hidden',
                    'rounded-2xl px-4 py-3 shadow-raised touch-none',
                    'border border-[var(--elevated-border)] backdrop-blur-md',
                    cfg.bg,
                    cfg.text,
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <p className="flex-1 text-[13px] font-semibold leading-snug">{t.message}</p>
                  <button
                    type="button"
                    onClick={() => dismiss(t.id)}
                    aria-label="Dismiss notification"
                    className="shrink-0 rounded-full p-1 opacity-60 transition hover:opacity-100 active:scale-90"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {/* Countdown bar — transform-based so it composites, and it
                      freezes with the timer via animation-play-state. */}
                  <span
                    aria-hidden="true"
                    className="toast-progress pointer-events-none absolute inset-x-3 bottom-1 h-[3px] rounded-full bg-current opacity-35"
                    style={{
                      animationDuration: `${t.duration}ms`,
                      animationPlayState: t.paused ? 'paused' : 'running',
                    }}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
