/**
 * In-page scroll helper for the hash-routed brochure.
 *
 * The router owns the URL fragment (links look like `#/technology`), so a plain
 * `<a href="#how">` would be read as a route change and bounce to the home page
 * instead of scrolling. Section jumps call this instead.
 */
export function scrollToId(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  // Keep keyboard focus on the destination after a programmatic jump.
  el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}
