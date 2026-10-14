/**
 * Shared contact seam for the static brochure.
 *
 * This site ships no `/auth` route and no server endpoint, so every call to
 * action that used to open the console resolves to a mailto: instead — a link
 * that works with no backend and stores nothing about the visitor.
 */
export const SUPPORT_EMAIL = 'support@pathomitra.app';

/** Build a mailto: with a prefilled subject (and optional body). */
export function mailto(subject: string, body?: string): string {
  const params = new URLSearchParams({ subject });
  if (body) params.set('body', body);
  return `mailto:${SUPPORT_EMAIL}?${params.toString()}`;
}
