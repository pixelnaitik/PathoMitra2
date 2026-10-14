/**
 * useEditHistory — small undo/redo stack for continuously-edited objects
 * (the report-layout settings being edited live against the A4 preview).
 *
 * Coalescing rule: an entry made within `mergeWindowMs` of the previous one
 * replaces it, so dragging a slider for three seconds is a single undo step.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface EditHistory<T> {
  /** Record `next` as the current edit (pass true to force a new undo step). */
  push: (next: T, force?: boolean) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Drop the stack (e.g. after a save) and re-anchor at `value`. */
  reset: (value: T) => void;
  /**
   * The entry under the cursor. Changes only when undo/redo moves it, so a
   * component can `useEffect` on it to restore values into its own state.
   */
  current: T;
}

interface HistoryState<T> {
  entries: T[];
  index: number;
  lastAt: number;
}

export function useEditHistory<T>(initial: T, mergeWindowMs = 500): EditHistory<T> {
  const [state, setState] = useState<HistoryState<T>>(() => ({
    entries: [initial],
    index: 0,
    lastAt: 0,
  }));

  const push = useCallback(
    (next: T, force = false) => {
      const now = Date.now();
      setState(prev => {
        const fresh = force || now - prev.lastAt > mergeWindowMs;
        if (fresh) {
          const entries = [...prev.entries.slice(0, prev.index + 1), next];
          return { entries, index: entries.length - 1, lastAt: now };
        }
        if (prev.index === prev.entries.length - 1) {
          const entries = [...prev.entries];
          entries[prev.index] = next;
          return { entries, index: prev.index, lastAt: now };
        }
        return {
          entries: [...prev.entries.slice(0, prev.index + 1), next],
          index: prev.index + 1,
          lastAt: now,
        };
      });
    },
    [mergeWindowMs],
  );

  const undo = useCallback(() => {
    setState(prev => (prev.index > 0 ? { ...prev, index: prev.index - 1, lastAt: 0 } : prev));
  }, []);

  const redo = useCallback(() => {
    setState(prev =>
      prev.index < prev.entries.length - 1 ? { ...prev, index: prev.index + 1, lastAt: 0 } : prev,
    );
  }, []);

  const reset = useCallback((base: T) => {
    setState(prev => {
      const entries = [...prev.entries];
      entries[prev.index] = base;
      return { entries, index: prev.index, lastAt: 0 };
    });
  }, []);

  return {
    push,
    undo,
    redo,
    canUndo: state.index > 0,
    canRedo: state.index < state.entries.length - 1,
    reset,
    current: state.entries[state.index] as T,
  };
}

/**
 * Wire an undo/redo pair to the standard keyboard shortcuts.
 * Ignored while typing in an input/textarea/select so native text undo wins.
 */
export function useHistoryShortcuts(history: { undo: () => void; redo: () => void }) {
  const ref = useRef(history);
  useEffect(() => {
    ref.current = history;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        ref.current.undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        ref.current.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
