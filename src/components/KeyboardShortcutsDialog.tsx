/**
 * KeyboardShortcutsDialog — a compact reference of available shortcuts.
 * Opens with Ctrl+/ (or Cmd+/) from anywhere in the dashboard.
 */
import { createPortal } from 'react-dom';
import { useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Command } from 'lucide-react';
import { BACK_PRIORITY, useBackHandler } from '../lib/back-button';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [MOD, 'K'], label: 'Open global search' },
  { keys: [MOD, '/'], label: 'Show this shortcuts help' },
  { keys: ['Esc'], label: 'Close dialogs & search' },
  { keys: ['↑', '↓'], label: 'Navigate search results' },
  { keys: ['↵'], label: 'Open the selected result' },
];

export function KeyboardShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Declared before the SSR guard: hooks must run on every path through the
  // component, and returning early above this would change the hook order.
  useBackHandler(
    useCallback(() => {
      if (!open) return false;
      onClose();
      return true;
    }, [open, onClose]),
    open,
    BACK_PRIORITY.OVERLAY,
  );

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-[4px]"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="relative max-h-[88dvh] w-full max-w-sm overflow-y-auto rounded-3xl border border-[var(--elevated-border)] bg-surface p-6 shadow-float"
          >
            <div className="mb-4 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/12 text-accent">
                <Command className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="text-[15px] font-bold tracking-[-0.02em] text-on-surface">
                Keyboard shortcuts
              </h2>
            </div>
            <ul className="space-y-2.5">
              {SHORTCUTS.map(s => (
                <li key={s.label} className="flex items-center justify-between gap-4">
                  <span className="text-[13px] text-on-surface-variant">{s.label}</span>
                  <span className="flex shrink-0 gap-1">
                    {s.keys.map(k => (
                      <kbd
                        key={k}
                        className="min-w-[24px] rounded-md border border-outline-variant bg-surface-container px-1.5 py-0.5 text-center text-[11px] font-bold text-on-surface"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 h-11 w-full rounded-full bg-primary text-[14px] font-semibold text-on-primary shadow-card transition hover:brightness-110 active:scale-[0.97]"
            >
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
