/**
 * Tests for the custom-logo upload path. The security-relevant surface is
 * `processLogoFile`'s screening — the logo is later rendered into `<img>` and
 * CSS `background`, so a stored SVG must not carry script or reach the network,
 * and only an inline image data URL within the ceiling may ever be persisted.
 *
 * The raster branch (PNG/JPG/WebP/GIF) is deliberately not asserted end-to-end:
 * jsdom's `<canvas>` has no 2D context, so `processLogoFile` would bail at the
 * "could not process the image" guard rather than exercise real downscaling.
 * What *is* covered here are the guards that run before any canvas work, the
 * full SVG path, and the favicon swap/restore contract.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  processLogoFile,
  applyBrandFavicon,
  BrandLogoError,
  BRAND_LOGO_MAX_INPUT_BYTES,
  isBrandLogoDataUrl,
  BRAND_LOGO_MAX_CHARS,
} from './brand-logo';

/** A clean, script-free SVG that must survive the screen unchanged. */
const CLEAN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>';

function svgFile(body: string): File {
  return new File([body], 'logo.svg', { type: 'image/svg+xml' });
}

beforeEach(() => {
  document.head.querySelector('link[rel="icon"]')?.remove();
});

describe('processLogoFile — input guards', () => {
  it('rejects a non-image before reading anything', async () => {
    const notAnImage = { type: 'application/pdf', size: 12 } as File;
    await expect(processLogoFile(notAnImage)).rejects.toThrow(BrandLogoError);
  });

  it('rejects a file over the input byte ceiling', async () => {
    const huge = { type: 'image/png', size: BRAND_LOGO_MAX_INPUT_BYTES + 1 } as File;
    await expect(processLogoFile(huge)).rejects.toThrow(/too large/i);
  });
});

describe('processLogoFile — SVG screening', () => {
  it('accepts a clean SVG and returns a storable image data URL', async () => {
    const url = await processLogoFile(svgFile(CLEAN_SVG));
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(isBrandLogoDataUrl(url)).toBe(true);
  });

  it('rejects an SVG carrying a script element', async () => {
    await expect(processLogoFile(svgFile('<svg><script>alert(1)</script></svg>'))).rejects.toThrow(
      /not accepted/i,
    );
  });

  it('rejects an SVG with an event-handler attribute', async () => {
    await expect(processLogoFile(svgFile('<svg onload="steal()"><rect/></svg>'))).rejects.toThrow(
      /not accepted/i,
    );
  });

  it('rejects an SVG that references an external resource', async () => {
    await expect(
      processLogoFile(svgFile('<svg><image href="https://track.me/p.png"/></svg>')),
    ).rejects.toThrow(/not accepted/i);
    await expect(processLogoFile(svgFile('<svg><use xlink:href="#x"/></svg>'))).rejects.toThrow(
      /not accepted/i,
    );
  });

  it('rejects an SVG whose encoded form busts the storage ceiling', async () => {
    // A comment payload keeps it "clean" to the screen but far too large to store.
    const fat = `<svg><!--${'a'.repeat(BRAND_LOGO_MAX_CHARS)}--></svg>`;
    await expect(processLogoFile(svgFile(fat))).rejects.toThrow(/too large to store/i);
  });
});

describe('applyBrandFavicon', () => {
  it('paints the custom logo over the shipped icon and restores it on removal', () => {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.setAttribute('href', '/favicon-32x32.png');
    document.head.appendChild(link);

    const custom = 'data:image/png;base64,iVBORw0KGgo=';
    applyBrandFavicon(custom);
    expect(link.getAttribute('href')).toBe(custom);

    applyBrandFavicon(null);
    expect(link.getAttribute('href')).toBe('/favicon-32x32.png');
  });
});
