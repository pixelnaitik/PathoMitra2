# Google Play Store Listing & Console Configuration

Authoritative submission text for **PathoMitra** (`com.pathomitra.app`). Every claim
here is traceable to the source in this repo; nothing here is aspirational. If a line
below is not true of the build being uploaded, delete the line rather than soften it —
the rejections this app is exposed to come from _claims_, not from architecture.

---

## 1. Store listing

### App name (30 char max)

```
PathoMitra
```

Package name is `com.pathomitra.app` while the brand is "PathoMitra". That mismatch is
deliberate (changing an `applicationId` orphans existing installs) but expect a query;
the answer is that it predates the rename. Confirm "PathoMitra" is not already a registered
pathology brand in your target markets before committing to it.

### Tagline / short description (80 char max)

```
Offline pathology lab records, reports and billing - stored encrypted on your device.
```

(79 chars. No superlatives, no "best/#1", no capability the app does not have.)

### Full description

```
PathoMitra is an offline laboratory console for pathology labs and their authorised
staff. It runs with no network access at all - the Android build does not request the
INTERNET permission - so patient records never leave the device you enter them on.

WHAT IT DOES

- Patient registration: identifiers, age, gender, contact details, referring doctor
  and the tests ordered, with fast keyboard-driven search and entry.
- Test catalogue: a curated pathology test list with units and reference ranges, plus
  your own custom tests and groups. Calculated indices such as CBC ratios fill in as
  you type results.
- Reports: build a report against a patient, save it as a draft, and issue it when it
  is complete. Amendments raise the version number and record your reason.
- A4 report output: live preview, adjustable margins and typography, several report
  templates, then print, save or share a PDF through the Android system sheets.
  Each report carries the issuing operator's name and the issue time.
- Doctors register, invoicing and payment tracking in rupees, and an analytics view
  of volume, revenue and turnaround.
- Notification centre: overdue reports, drafts awaiting issue, and unpaid bills.
- Data safety: an encrypted database, a PIN or biometric device unlock, automatic
  re-lock when you leave the app, screenshot and screen-recording protection that is
  on unless you switch it off in Settings, and a full local erase when you are done.

OFFLINE BY CONSTRUCTION

There is no account to create, no sign-in and no server. The app has no network
permission, so no data - yours or your patients' - can be transmitted. Nothing is
backed up to the cloud, and device-to-device transfer is explicitly excluded.

WHERE YOUR DATA LIVES

Records are stored on your device in a SQLCipher (AES-256) database whose key is held
in the Android hardware keystore. Your unlock passcode is stored only as a PBKDF2
hash. Because there is no server, you are the only copy: use Settings > Data to create
a backup - sealed with a passphrase you choose, so a copy that leaves the device does
not carry readable patient records - and keep it somewhere you control. That passphrase
is the only key and cannot be recovered, so store it apart from the file.

PRIVACY

No advertising SDK, no analytics SDK, no crash-reporting SDK and no tracking of any
kind is present in this app. It requests no dangerous permissions - no camera,
microphone, location, contacts, SMS, call log or storage permission. You can export or
permanently delete everything at any time from within the app.

NOTES

- PathoMitra is a professional tool for laboratory staff. It is not a patient-facing
  app and not a diagnostic device: it stores, formats and prints what a qualified
  operator enters, and does not interpret results.
- The app holds no accreditation or certification of its own, and asserts none on your
  behalf. Accreditation or licence text appears on reports only if you enter and
  confirm it in Settings.
- No advertisements. No in-app purchases. No subscriptions.
```

### What must **never** appear in listing text or screenshots

| Banned                                                                                            | Why                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| "HIPAA compliant", "GDPR compliant", "NABL accredited", "ISO certified", "CE mark", "SOC 2"       | The app holds none of these. Using a certification mark you do not have is an Impersonation violation and a trademark problem. |
| "tamper-proof", "tamper-evident", "SHA-256 sealed", "digitally signed", "electronically verified" | There is no signing service and no verification endpoint; the signature column holds the operator's name.                      |
| "cloud sync", "access from anywhere", "secure cloud storage", "upload slides"                     | The build has no network permission.                                                                                           |
| "AI analysis", "AI-assisted"                                                                      | No AI is present; the AI-content policy would then apply.                                                                      |
| "trusted by 200+ labs", user counts, ratings                                                      | Unverifiable social proof.                                                                                                     |
| Screenshots of the web landing page                                                               | They show the retired marketing claims. Screenshot the APK.                                                                    |

### Screenshots (min 2, 1080px wide recommended)

Capture from the **installed release build**, in light theme, with obviously synthetic
demo data (`Test Patient`, not a real name). Suggested set: report list → new-report
result entry → A4 preview → analytics → Settings → Security.

### Feature graphic, icon

Reuse the existing adaptive icon. No text overlay making a capability claim.

---

## 2. Console: App content

### Privacy policy

Set to the value of `VITE_PRIVACY_URL`, i.e. a page on a domain you own, generated by:

```
npm run build:privacy      # writes privacy-site/index.html + terms.html
```

Plain HTML, no JavaScript, so the policy body is visible without executing the SPA.
`scripts/check-release-config.mjs` fails `npm run build:android` while this is unset,
still a placeholder, or pointing at a shared platform subdomain (`pages.dev`,
`vercel.app`, `netlify.app`, `github.io`).

### Declarations to answer

| Question                                             | Answer                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target audience and categories                       | **Adults and professionals only.** Not directed at children, not offered to patients. Declare no age group under 13. The app _records_ minors' clinical data on behalf of a lab, which is the lab's processing, not a child-directed feature. |
| Ads                                                  | **No.** No ad SDK is present.                                                                                                                                                                                                                 |
| In-app purchases                                     | **No.** No Play Billing dependency, no paid entitlement.                                                                                                                                                                                      |
| News app                                             | **No.**                                                                                                                                                                                                                                       |
| Health apps → does it show health data to consumers? | **No** — operator-facing. Patient-facing output is a printed PDF issued by a laboratory.                                                                                                                                                      |
| On-device encryption                                 | **Yes**, at rest (SQLCipher / AES-256, hardware keystore).                                                                                                                                                                                    |
| Account deletion                                     | **Handled in-app**: Settings → Security → "Erase all data & delete account" wipes the database and the account. There is no remote account to delete, so no deletion URL is required.                                                         |

### Data safety form

Answer **all of these as "No data collected"** and use the "why" text below.

| Field                                 | Entry                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Data collected                        | None                                                                                                                           |
| Data shared                           | None                                                                                                                           |
| Data backed up                        | No                                                                                                                             |
| Data encrypted in transit             | **N/A — the app requests no `INTERNET` permission and has no network path.** Do not answer "yes"; answer that nothing is sent. |
| Data encrypted at rest                | Yes (device keystore / SQLCipher AES-256)                                                                                      |
| Users can request data deletion       | Yes, in-app, self-service                                                                                                      |
| Data kept after deletion              | No — the delete action empties every local table                                                                               |
| Third-party SDKs with data access     | None (no analytics, ads, crash or social SDK)                                                                                  |
| HIPAA / health-addendum applicability | Not applicable to the developer; the laboratory is the data controller                                                         |

**Supporting evidence to keep on hand if Google asks:** the merged release manifest
permission list is exactly

```
android.permission.VIBRATE
android.permission.USE_BIOMETRIC
android.permission.USE_FINGERPRINT
android.permission.POST_NOTIFICATIONS
android.permission.WAKE_LOCK
android.permission.RECEIVE_BOOT_COMPLETED
com.pathomitra.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
```

— with **no** `INTERNET`, and with `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` deliberately
**removed** by `tools:node="remove"` in `android/app/src/main/AndroidManifest.xml` (Play treats
exact-alarm scheduling as a sensitive permission needing a declared use case, and the app does not
need it — banners are posted when an alert is derived, not fired at a wall-clock instant).
Regenerate this list rather than trusting it: `@capacitor/local-notifications` was added 2026-10-11
and contributed two of the last three, which is why the build itself checks — `npm run check:android`
prints the count and fails on anything outside the allow-list in
`scripts/check-android-manifest.mjs`.

Verify any uploaded artifact with

```
npm run sync:android && npm run android:aab
# then inspect the release merged manifest under android/app/build/intermediates
```

Do not let the Data Safety form drift from `src/lib/privacy-policy.ts`; both restate the
same three load-bearing facts, and a mismatch between them is what invites a manual
review to look harder.

---

## 3. Console: Release

### Pre-upload gate (all must pass)

```
npm run lint:ci        # 0 errors; ratchet is --max-warnings=21
npm run test:coverage  # includes the report-claim and lockout regression guards
npm run build:privacy  # fails if the contact/URL are placeholders
npm run verify:android # config guard -> native build -> asset guard -> AAB
```

Then assert on the artifact:

- `versionCode` and `versionName` come from `package.json` (`2.5.8` → `2005008`);
  a collision is rejected silently at upload, so confirm the Gradle log line.
- `debuggable` is absent/`false` in the **release** merged manifest.
- No `INTERNET` permission.
- `android/app/src/main/assets/public/` contains **no** `robots.txt`, `sitemap.xml`,
  `llms.txt`, `sw.js`, `manifest.json`, `_headers` or `_redirects`. Those declare the
  old web deployment's Firebase/Google endpoints and contradict the Data Safety
  answers if left inside the APK.
- Bundle is signed by your release key; Play App Signing is enabled in the Console.

### Tester track

Upload to a **closed/internal** track first, run Play pre-launch checks, then promote to
production only once vitals are clean (crash < 1.0%, ANR < 1.5%).

---

## 4. Things Google may ask for that code cannot answer

1. **Category = Medical** typically triggers a request for laboratory licensing or
   accreditation evidence. That belongs to the _laboratory_, not the app. Have the
   operator's own documentation ready, and be ready to explain that the app is a
   professional tool and the accreditation text on a report is operator-supplied.
2. **A real support mailbox** at your own domain. It appears in the policy, in the
   Console contact fields, and in the DPDP grievance line.
3. **DPDP Act 2023 posture** (India): the laboratory is the Data Fiduciary. The policy
   says so; you must actually be able to honour consent, retention and grievance duties.
4. **Data-loss disclosure**: there is no server-side backup. If a device is lost or
   broken and the lab never exported a backup, their records are gone. The policy and
   Settings both say this; make sure it is also in your support material.

---

## 5. Pre-submission checklist

- [x] The orphaned "Staff access code" upgrade UI was **removed 2026-10-11** —
      `DashboardLayout` (guest banner, `handleUpgrade`, the `db/doc/updateDoc` and
      `ShieldAlert` imports) and the `Unlock staff access above` line in
      `OverviewPage`. With a single local operator `role` is only ever
      `'admin' | null` (`AuthContext.toUser`), so the branch could never render —
      but its strings shipped inside the APK and implied a multi-user system that
      does not exist. The same commit removed `ConnectionBanner`, which promised
      "will sync automatically when you reconnect" in an app with no sync path.
- [ ] **BLOCKER — `VITE_SUPPORT_EMAIL` / `VITE_PRIVACY_URL must be real.** The
  2.5.1 build shipped `privacy@pathomitra.test`and
 `https://policy.pathomitra.test/` (RFC 2606 reserved, can never resolve),
      which fails User Data Policy for an app holding patient data. Both are now
      rejected by `scripts/check-release-config.mjs` (reserved TLDs + a live
      fetch that requires the hosted page to name the same contact), so
      `npm run build:android` fails until they are set. Set them, run
      `npm run build:privacy`, and host `privacy-site/` on that domain.
- [ ] **Upload only a bundle that passes `npm run check:android`** — it asserts the
      merged release manifest's package id, `versionCode`/`versionName`, the
      permission allow-list, `debuggable=false`, `allowBackup=false`, the
      data-extraction rules, and that no `INTERNET` crept in. The pre-rebrand
      `app-release.aab` was renamed
      `STALE_WRONG_PACKAGE_healthcareos_DO_NOT_UPLOAD.aab` for this reason.
- [ ] Screenshots must come from the installed release build with synthetic data,
      plus the 1024×512 feature graphic — neither exists yet for PathoMitra.
- [ ] Report footer geometry was changed (larger legal ribbon); verify it visually in
      `Settings → Report Templates → Preview PDF` and on a real print.
- [ ] **Re-lock on inactivity, not on backgrounding** (behaviour changed 2026-10-11):
      leaving the app starts the same countdown the lab set in
      Settings → Security → "Re-lock after inactivity" (default 5 min) instead of locking on the
      spot, and the elapsed time is measured against the wall clock on return. Verify that opening
      the print/share sheet or another app and coming back within the window does NOT cost a sign-in,
      and that returning after longer than the window DOES lock.
- [ ] **Screenshot protection is now ON by default** (Android `FLAG_SECURE`, set in
      `MainActivity.onCreate` before the WebView loads, with a Settings → Security →
      "Screenshot protection" switch that only ever clears it). Verify on device that a
      screenshot really is blocked, that the Recents thumbnail is blank, and — the part
      that used to be the lab's request — that printing and sharing a report PDF still
      work, because `FLAG_SECURE` blocks screen capture only, never the print framework
      or a FileProvider grant. Tell the lab before shipping: this reverses the earlier
      "screens must be capturable" decision, now as an opt-out instead of a default.
- [ ] **Backups are sealed by default** (PBKDF2-SHA256 + AES-256-GCM, `lib/backup.ts`
      → `lib/backup-crypto.ts`), with the plaintext path still offered per-backup. Older
      unsealed snapshots restore unchanged; a sealed one prompts for the passphrase.
      Confirm on device that a sealed backup restores onto a second device, and that a
      lost passphrase really is unrecoverable — then say so in support material.
- [ ] **Permission declarations in the Console** for the three that
      `@capacitor/local-notifications` needs: `POST_NOTIFICATIONS` (the opt-in story — overdue-report
      and unpaid-bill banners the lab switches on in Settings → Notifications), `WAKE_LOCK` (fire a
      scheduled banner while the app is closed) and `RECEIVE_BOOT_COMPLETED` (the plugin's boot
      receiver re-arms pending banners after a reboot). `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`
      are stripped in the manifest, so **do not** describe an exact-timing feature in the listing —
      the declaration would then not match the binary. Still **no** dangerous permission: no camera,
      microphone, location, contacts, SMS, call log or storage.
- [ ] Release keystore created, backed up off-machine, and Play App Signing configured.
