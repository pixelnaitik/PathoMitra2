/**
 * Shared motion vocabulary — one source of truth for the JS (motion/react)
 * layer so durations, easings and springs can't drift per-component. The CSS
 * layer in index.css mirrors these values (240ms + cubic-bezier(0.22,1,0.36,1)
 * for entrances, overshoot spring for presses).
 */
import type { Transition, Variants } from 'motion/react';

export const EASE = {
  /** Deceleration curve for entrances/rises — mirrors the CSS `card-hover`/`rise-in` curve. */
  out: [0.22, 1, 0.36, 1] as const,
  /** Hint of overshoot for press/pop feedback — mirrors the global :active curve. */
  overshoot: [0.34, 1.56, 0.64, 1] as const,
};

export const DURATION = {
  micro: 0.14, // tooltips, combobox panels
  fast: 0.2, // exits, icon swaps, disclosure
  base: 0.25, // entrances, route/tab transitions
  soft: 0.35, // deliberate reveals
};

export const SPRING = {
  /** Toasts / sheets — lively but settled. */
  press: { type: 'spring', stiffness: 420, damping: 32 } as Transition,
  /** Segmented pills & bottom-nav indicator — shared-layout slides. */
  snappy: { type: 'spring', stiffness: 480, damping: 38 } as Transition,
  /** Sidebar / structural springs. */
  shell: { type: 'spring', stiffness: 320, damping: 34 } as Transition,
  /** KPI & dashboard card entrances. */
  card: { type: 'spring', stiffness: 260, damping: 24 } as Transition,
};

/** Beyond this, staggered rows feel late rather than sequenced. */
export const MAX_STAGGER_DELAY = 0.45;

/**
 * Staggered entrance for list items (rows, cards, chips).
 * The delay is CAPPED — uncapped `idx * step` leaves row #40 fading in two
 * seconds after the rest of the list has already settled.
 */
export function listStagger(index: number, y = 8): Variants {
  return {
    hidden: { opacity: 0, y },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        delay: Math.min(index * 0.045, MAX_STAGGER_DELAY),
        duration: DURATION.base,
        ease: EASE.out,
      },
    },
  };
}

/** Inline-prop flavour of listStagger for components that set initial/animate directly. */
export function listStaggerProps(index: number, y = 8) {
  return {
    initial: { opacity: 0, y },
    animate: { opacity: 1, y: 0 },
    transition: {
      delay: Math.min(index * 0.045, MAX_STAGGER_DELAY),
      duration: DURATION.base,
      ease: EASE.out,
    },
  };
}
