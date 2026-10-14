import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the Android APK build.
 *
 * The web layer is the Vite production bundle in `dist/` — run `npm run build`
 * before `npx cap sync android` so the native project receives fresh assets.
 */
const config: CapacitorConfig = {
  appId: 'com.pathomitra.app',
  // Launcher label + the app-name line the OS shows in the biometric / print
  // sheets. Kept identical to the in-app brand ("PathoMitra"); the `appId` is
  // left as-is because changing it would orphan existing installs on upgrade.
  appName: 'PathoMitra',
  webDir: 'dist',
  backgroundColor: '#f5f5f7',
  server: {
    // Serve the bundled app over https://localhost so the WebView is a secure
    // context — required for Web Crypto (PBKDF2 password hashing). No network.
    androidScheme: 'https',
  },
  plugins: {
    SystemBars: {
      // index.html ships `viewport-fit=cover`, so the WebView goes edge-to-edge
      // and the header has to pad itself clear of the status bar. Declaring the
      // expected value up-front stops the bar from jumping into place once the
      // native side reads the meta tag after page commit.
      initialViewportFitValueHint: 'cover',
      // `css` (the default) additionally mirrors the insets into the
      // --safe-area-inset-* custom properties that src/index.css falls back to.
      insetsHandling: 'css',
    },
    Keyboard: {
      // Edge-to-edge is why this is needed: on Android 15+ a fullscreen WebView
      // no longer resizes for `windowSoftInputMode="adjustResize"`, so forms in
      // the patient / report sheets get covered by the keyboard. The plugin's
      // workaround re-measures the content child when the IME appears.
      resizeOnFullScreen: true,
    },
    CapacitorSQLite: {
      // Enables SQLCipher encryption of the on-device clinical database. The
      // plugin defaults this to true, but it is set explicitly so a config
      // change elsewhere can never silently produce a plaintext database.
      androidIsEncryption: true,
      iosIsEncryption: true,
    },
  },
};

export default config;
