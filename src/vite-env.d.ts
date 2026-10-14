/// <reference types="vite/client" />

/**
 * Typed environment variables available to the client bundle.
 *
 * Add a key here when a new `VITE_*` variable is introduced: `import.meta.env`
 * is otherwise an untyped bag of strings, and a typo in a variable name silently
 * resolves to `undefined` at runtime.
 *
 * There used to be eight `VITE_FIREBASE_*` keys plus the `__FIREBASE_CONFIG__`
 * build constants here. The app is local-first now — no Firebase SDK is imported
 * anywhere in `src/` — so a project id and API key were being baked into the
 * shipped APK for a backend it can never reach. They are gone with it.
 */
interface ImportMetaEnv {
  /** Build-time only (`npm run build:android`); never read from the client. */
  readonly VITE_TARGET?: 'native' | string;
  /**
   * Public privacy/support contact printed in the privacy policy and required by
   * Google Play for an app handling health data. Optional so development builds
   * still run, but `scripts/check-release-config.mjs` fails a native build when
   * it is missing or left on the placeholder — Play rejects an unreachable or
   * unowned contact, and that is only discovered after submission.
   */
  readonly VITE_SUPPORT_EMAIL?: string;
  /**
   * Canonical URL of the published privacy policy — the link the Play listing
   * points at. Same enforcement as the support email.
   */
  readonly VITE_PRIVACY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
