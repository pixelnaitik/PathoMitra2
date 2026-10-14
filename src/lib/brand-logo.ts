/**
 * Custom app logo (branding) — processing, reading and applying.
 *
 * The lab can upload its own logo (Settings → Lab Organization). From then on
 * it replaces the built-in microscope mark on the sign-in tile, the browser tab
 * icon and every brand surface — with one deliberate exception: the start-up
 * splash and the logged-in Overview page follow the splash branding (the
 * PathoMitra ribbon, `SPLASH_BRAND_LOGO_SRC`) by owner decision (2026-10-11).
 *
 * The logo is stored inside the settings object (`brandLogoUrl`) as an inline
 * `data:image/...` URL, never as a remote address — the app is offline by
 * posture, and a URL would be both a broken promise and a tracking vector.
 * Keeping it in settings also means backups carry it for free (the snapshot
 * stores settings documents as passthrough JSON).
 *
 * `index.html`'s pre-JS splash bootstrap re-implements the *read* side of the
 * contract (isBrandLogoDataUrl in settings.ts) in a few lines of vanilla JS —
 * if that acceptance rule ever changes, both sides must move together.
 */
import { useEffect, useState } from 'react';
import {
  BRAND_LOGO_MAX_CHARS,
  isBrandLogoDataUrl,
  readSettings,
  SETTINGS_UPDATED_EVENT,
} from './settings';

export { BRAND_LOGO_MAX_CHARS, isBrandLogoDataUrl };

/**
 * The built-in brand mark shipped in `public/` — the P-ribbon logo (same art
 * `favicon_io/` and `public/brand-p.png` were generated from) — shown on the
 * login tile and in-app headers while no custom lab logo is uploaded. The
 * favicon.ico / android-chrome PNGs in `public/` are the per-size siblings of
 * this same mark, used by the tab icon, the splash and the window/taskbar icon.
 */
export const DEFAULT_BRAND_LOGO_SRC = '/brand-p.png';

/**
 * The PathoMitra ribbon splash brand (`public/brand-p.png`) — the temporary
 * startup brand (owner decision 2026-10-11): index.html's splash shows it
 * before any JS runs, and the logged-in home page's sidebar tile keeps
 * following the splash logic instead of the uploaded lab logo.
 */
export const SPLASH_BRAND_LOGO_SRC = '/brand-p.png';

/** Files above this are rejected before anything is read into memory. */
export const BRAND_LOGO_MAX_INPUT_BYTES = 5 * 1024 * 1024;

/** Longest edge after downscale. The logo renders at 14–88 px everywhere,
 *  so 512 px leaves generous headroom for retina tiles and the splash. */
const BRAND_LOGO_TARGET_PX = 512;

/** Error with a message safe to show in a toast verbatim. */
export class BrandLogoError extends Error {}

/** Read a stored settings object's logo, applying the data-URL contract. */
export function readBrandLogo(): string | null {
  const { brandLogoUrl } = readSettings();
  return isBrandLogoDataUrl(brandLogoUrl) ? brandLogoUrl : null;
}

/**
 * Subscribe to the brand logo. Returns the custom logo data URL, or null when
 * the app should show the default microscope. Re-reads whenever settings are
 * saved (writeSettings dispatches) or another tab changes storage.
 */
export function useBrandLogo(): string | null {
  const [logo, setLogo] = useState<string | null>(readBrandLogo);
  useEffect(() => {
    const sync = () => setLogo(readBrandLogo());
    window.addEventListener(SETTINGS_UPDATED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SETTINGS_UPDATED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return logo;
}

/** btoa only accepts latin1; UTF-8-encode first so non-ASCII SVGs survive. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000; // keep String.fromCharCode's arg list bounded
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new BrandLogoError('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new BrandLogoError('That file could not be opened as an image.'));
    img.src = src;
  });
}

/**
 * Validate an uploaded file and turn it into a storable data URL.
 *
 * Raster images are downscaled to 512 px on the longest edge and re-encoded as
 * PNG (transparency preserved — logos sit on coloured tiles); an animated GIF
 * becomes its first frame, which is the right call for a brand mark. If the
 * PNG is still over the storage ceiling, WebP gets one retry. SVGs are stored
 * as-is (they scale by definition) after a script/external-reference screen,
 * since the logo is later rendered into `<img>` and `background` positions.
 *
 * Throws `BrandLogoError` with a user-facing message; callers show it as-is.
 */
export async function processLogoFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new BrandLogoError('Choose an image file (PNG, JPG, WebP, GIF or SVG).');
  }
  if (file.size > BRAND_LOGO_MAX_INPUT_BYTES) {
    throw new BrandLogoError(
      `Logo file is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB) — use one under 5 MB.`,
    );
  }

  if (file.type === 'image/svg+xml') {
    const text = (await file.text()).trim();
    if (!/^<svg[\s>]/i.test(text) && !/^<\?xml[\s\S]*?<svg[\s>]/i.test(text)) {
      throw new BrandLogoError('That SVG could not be read — export it again and retry.');
    }
    // An SVG loaded into an <img> cannot run script, but `href`/`xlink:href`
    // still reach the network and event handlers survive some embedding
    // paths — reject both rather than audit every future use of the blob.
    if (/<script|on\w+\s*=|xlink:href\s*=|\shref\s*=/i.test(text)) {
      throw new BrandLogoError(
        'SVGs with scripts or external references are not accepted. Flatten the logo to a PNG instead.',
      );
    }
    const url = `data:image/svg+xml;base64,${toBase64(text)}`;
    if (url.length > BRAND_LOGO_MAX_CHARS) {
      throw new BrandLogoError('That SVG is too large to store — simplify it or use a PNG.');
    }
    return url;
  }

  const raw = await readAsDataUrl(file);
  const img = await loadImage(raw);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new BrandLogoError('That image has no readable pixels.');

  const scale = Math.min(1, BRAND_LOGO_TARGET_PX / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new BrandLogoError('This browser could not process the image.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let out = canvas.toDataURL('image/png');
  if (out.length > BRAND_LOGO_MAX_CHARS) out = canvas.toDataURL('image/webp', 0.9);
  if (out.length > BRAND_LOGO_MAX_CHARS) {
    throw new BrandLogoError('That image is too detailed to store — try a simpler or smaller one.');
  }
  return out;
}

// Remember what each <link rel="icon"> shipped with, so removing the custom
// logo restores the built-in favicon instead of leaving the tab painted.
const originalFaviconHrefs = new Map<HTMLLinkElement, string>();

/**
 * Paint the browser tab icon with the custom logo (null restores the built-in
 * ones). The manifest icons are static files and cannot follow a data URL —
 * an installed PWA keeps the shipped icon until its manifest is regenerated.
 */
export function applyBrandFavicon(logo: string | null): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach(link => {
    if (!originalFaviconHrefs.has(link)) {
      originalFaviconHrefs.set(link, link.getAttribute('href') ?? '');
    }
    link.href = logo || originalFaviconHrefs.get(link) || '';
  });
}
