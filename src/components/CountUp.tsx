import { useLayoutEffect, useRef } from 'react';

interface CountUpProps {
  value: number;
  duration?: number;
}

/**
 * Animates a number from its previous value to the new one with an
 * ease-out cubic curve — used for dashboard KPI cards so figures feel alive.
 * Writes straight to the DOM via a ref: setState per animation frame would
 * re-render React during exactly the busiest moment (dashboard hydration).
 */
export default function CountUp({ value, duration = 900 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const prevRef = useRef(0);

  // Layout effect: the first textContent write must land before paint,
  // otherwise the final value flashes for a frame before the count starts.
  useLayoutEffect(() => {
    const from = prevRef.current;
    const to = Number.isFinite(value) ? value : 0;
    prevRef.current = to;

    const render = (n: number) => {
      if (ref.current) ref.current.textContent = n.toLocaleString('en-IN');
    };

    if (from === to) {
      render(to);
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      render(to);
      return;
    }

    let raf = 0;
    render(from);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      render(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span ref={ref}>{value.toLocaleString('en-IN')}</span>;
}
