/**
 * useShakeOnNewError — true for ~400 ms the moment an error newly appears or
 * changes text, never on mount with a persisted error.
 *
 * Shaking is an *event* (validation just failed), not a state: attribute-driven
 * CSS (`input[aria-invalid] { animation: … }`) replays the shake every time a
 * form is reopened with an old error still visible, which reads as the control
 * rejecting the saved value rather than informing about it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function useShakeOnNewError(error: ReactNode): boolean {
  const [shaking, setShaking] = useState(false);
  const key = error ? (typeof error === 'string' ? error : `\u0000${String(Boolean(error))}`) : '';
  const prevKey = useRef('');

  useEffect(() => {
    if (key && key !== prevKey.current) {
      setShaking(true);
      const timer = setTimeout(() => setShaking(false), 400);
      prevKey.current = key;
      return () => clearTimeout(timer);
    }
    prevKey.current = key;
  }, [key]);

  return shaking;
}
