import fs from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// On Windows, node 22+ with esbuild can encounter EPERM/Access Denied when
// attempting to unlink files from the system AppData\Local\Temp directory.
// Pointing to a local directory within the project eliminates this file lock.
if (process.platform === 'win32') {
  const localTmp = path.resolve(process.cwd(), '.tmp-build');
  if (!fs.existsSync(localTmp)) {
    fs.mkdirSync(localTmp, { recursive: true });
  }
  process.env.TEMP = localTmp;
  process.env.TMP = localTmp;
}

/**
 * Everything in `public/` that exists to serve the *public web deployment*.
 *
 * `cap sync android` copies `dist/` verbatim into the APK's assets, so without
 * this list the shipped app carries a robots.txt, a sitemap, an llms.txt, the
 * Cloudflare Pages `_headers`/`_redirects` rules and the PWA service worker —
 * none of which can do anything inside a WebView that has no network at all.
 * Dead weight and a misleading audit surface for a clinical app; the web build
 * is untouched because the flag is only set by `npm run build:android`.
 */
const WEB_ONLY_ASSETS = [
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  'sw.js',
  'manifest.json',
  'apple-touch-icon.png',
  '_headers',
  '_redirects',
];

/**
 * Drop the web-deploy-only assets from a native build.
 *
 * The `<link rel="manifest">` is removed from the emitted HTML too, so the
 * WebView is not left requesting a file the build deliberately deleted.
 */
function omitWebOnlyAssets(enabled: boolean): Plugin {
  return {
    name: 'pathomitra:omit-web-only-assets',
    apply: 'build',
    transformIndexHtml(html) {
      if (!enabled) return html;
      return html.replace(/\s*<link rel="manifest"[^>]*\/>/, '');
    },
    closeBundle() {
      if (!enabled) return;
      const outDir = path.resolve(process.cwd(), 'dist');
      const removed: string[] = [];
      for (const asset of WEB_ONLY_ASSETS) {
        const target = path.join(outDir, asset);
        if (fs.existsSync(target)) {
          fs.rmSync(target, { recursive: true, force: true });
          removed.push(asset);
        }
      }
      if (removed.length > 0) {
        console.info(`Vite: native build — dropped web-only asset(s): ${removed.join(', ')}.`);
      }
    },
  };
}

export default defineConfig(() => {
  // Set by `npm run build:android` / `desktop:build-renderer`. Deliberately a
  // build flag rather than a runtime check: the files it removes must not
  // exist in the artifact at all.
  const target = process.env.VITE_TARGET;
  const isNativeTarget = target === 'native';
  const isDesktopTarget = target === 'desktop';
  // Both shell targets ship no public web surface — same asset strip.
  const stripWebAssets = isNativeTarget || isDesktopTarget;

  return {
    plugins: [react(), tailwindcss(), omitWebOnlyAssets(stripWebAssets)],
    // Electron loads dist/index.html over file://, where absolute /assets URLs
    // resolve to the drive root and 404. Relative paths work under file://,
    // and https:// for the web build either way.
    base: isDesktopTarget ? './' : '/',
    build: {
      minify: 'terser',
      terserOptions: {
        compress: {
          // Do NOT strip console.error/console.warn: they are the only surviving
          // trace of a failure in a live lab (see src/lib/telemetry.ts, which
          // routes every captured error through console.error). Only the noisy
          // levels are dropped, via pure_funcs (drop_console is all-or-nothing).
          drop_console: false,
          drop_debugger: true,
          passes: 2,
          pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.trace'],
        },
        format: {
          comments: false,
        },
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) {
              return 'motion-vendor';
            }
            if (id.includes('node_modules/recharts') || id.includes('node_modules/d3')) {
              return 'recharts-vendor';
            }
          },
        },
      },
      /**
       * Minified stack traces are otherwise unreadable, and `/api/client-errors`
       * (server.ts) is the only place web production failures land — on the APK
       * the on-device crash log in src/lib/crash-log.ts is. `hidden` emits .map
       * files without a `//# sourceMappingURL` comment in the shipped bundle, so
       * they can be kept for symbolication without being served publicly. Off by
       * default so a normal build cannot leak sources.
       */
      sourcemap: process.env.SOURCEMAP === 'true' ? 'hidden' : false,
    },
    server: {
      // Allow tunnels (like ngrok, localtunnel) to access the Vite dev server
      allowedHosts: true,
      // Set DISABLE_HMR=true to turn off hot module replacement
      // (useful when file watching is unavailable or too noisy).
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
