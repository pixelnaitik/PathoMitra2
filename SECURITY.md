# Security Policy

PathoMitra is a clinical system: it holds patient demographics, diagnosis
results, and billing records. Treat every vulnerability report as urgent,
including the ones that look theoretical.

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| < main  | :x:                |

There are no long-running release lines: fixes are merged to `main` and shipped
in the next tagged release.

## Reporting a vulnerability

**Do not open a public issue for anything with security impact** — not even one
that looks obviously severe. Use one of:

- [GitHub private vulnerability reporting](https://github.com/pixelnaitik/PathoMitra2/security/advisories/new)
  (requires the repository owner to enable it under
  Settings → Security → Advanced Security), or
- an email to the maintainer address shown on the
  [repository page](https://github.com/pixelnaitik/PathoMitra2), if private
  vulnerability reporting is unavailable.

You should get a response within **7 days**, and a fix or a written explanation
within **30 days** for anything that can expose patient data. Please include:

- the affected code path or surface,
- the state you started from (locked, unlocked, mid-backup, …),
- whether real patient data was reachable, and
- a proof of concept that does **not** contain real patient records — use fake
  names and synthetic records.

## Threat model

The app is offline by design: the shipped APK requests **no `INTERNET`
permission** and ships no analytics, no tracking and no remote crash reporting.
The threat model assumes the device can be lost, borrowed, or inspected by
someone with USB debugging, and that the JavaScript bundle is fully readable —
anything enforced only in React is **not** a control.

The real controls, and what a valid vulnerability against them looks like:

1. **Encrypted on-device database.** Clinical data lives in a SQLCipher
   (AES-256) SQLite database (`@capacitor-community/sqlite`); the key is held
   by the Android Keystore (hardware KeyMint on the supported API 28+ floor).
   Any path to plaintext — encryption silently disabled, the key derived from
   a constant, the database copied out unencrypted — is critical.
   `capacitor.config.ts` sets `androidIsEncryption: true` explicitly so a
   config change can never silently produce a plaintext database; removing it
   is a security regression.
2. **Local authentication.** One operator account, unlocked by a
   PBKDF2-hashed passcode (Web Crypto in the `https://localhost` WebView
   secure context) with an optional biometric / device-credential unlock. A
   bypass of the lock screen, plaintext storage of the hash, or a lockout
   that a client-side flag can reset is critical.
3. **Session re-locking.** The app re-locks on background and after the idle
   interval, and escalates a lockout after repeated failed attempts.
   Regressions that let a locked session keep serving data are high severity.
4. **Backup files.** Backups are JSON snapshots the operator explicitly
   creates; they contain the full clinical dataset and are only as safe as
   wherever the operator puts them. The app must never create a backup
   automatically or transmit patient data off the device — a path that does is
   a critical privacy violation.
5. **Stored XSS / markup injection.** Patient and result values are rendered
   into lists, PDFs, and the share/preview surfaces. A payload that executes,
   or that escapes the A4 report layout to exfiltrate another patient's data,
   is high severity.
6. **Release build hardening.** `debuggable false`, R8 minification with the
   reflection-heavy keep-rules, and the build guards in `scripts/` that fail
   the build if web-deployment artifacts (service worker, `_headers`,
   `robots.txt`) or placeholder release identity enter the APK. A change that
   makes the release WebView debuggable or skips a guard is reportable.
7. **The no-network invariant.** The manifest must not request `INTERNET` or
   any permission the documented feature list does not name. A dependency or
   PR that adds a network permission, a remote font, or a phone-home call is a
   security regression by definition — review it as one.

## Scope

Only test software and devices you own or are explicitly authorised to test.
Do not probe a laboratory's installed devices, their backups, or the Google
Play listing of a laboratory running this app.

## Notes for operators building from source

- **Never commit `android/keystore.properties`, `*.jks` / `*.keystore`, or
  `.env`** — all are git-ignored. The release keystore is the identity of your
  app on Google Play; losing it means losing the listing.
- **Set real `VITE_SUPPORT_EMAIL` / `VITE_PRIVACY_URL` values.** The build
  guard refuses a release build with placeholders, because a health app whose
  contact is unreachable does not survive Play review.
- **Keep the 16 KB page-alignment check green.** `release.yml` verifies every
  native library in the AAB; Play rejects updates targeting API 35+ whose
  `.so` files are under-aligned.

## Privacy and compliance

PathoMitra keeps all data on the device, which is the strongest privacy
posture available, but it is **not** a certified HIPAA/GDPR-compliance product.
Compliance for a laboratory depends on how the device, the backups, and the
premises are managed. Do not treat this repository as providing compliance on
its own.
