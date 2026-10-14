# Changelog

All notable changes to this project are documented in this file and are generated automatically from [Conventional Commits](https://www.conventionalcommits.org/) by `npm run release`.

## 2.1.2 (2026-10-11)

First public release of the offline, local-first PathLab OS.

### ✨ Features

- Encrypted on-device clinical database — SQLCipher (AES-256) with the key held in the Android hardware keystore
- Local operator authentication — PBKDF2-hashed passcode, optional biometric / screen-lock unlock, rising lockout, and auto re-lock on background or idle
- Patient, doctor, report, invoice and analytics management with a multi-range calendar and derived Notification Center alerts
- PDF report generation (jsPDF) with four templates, custom tests and profiles, and age/sex reference-range flagging
- Draft → issue workflow with amendment history (`version`, `updatedBy`, `updatedAt`) and the issuing operator printed on the report
- Operator-owned JSON backups and in-app data erase — the app requests no `INTERNET` permission and ships no analytics, ads or crash reporting
- Android build pipeline (Capacitor 8) with release signing from git-ignored files or CI secrets, R8 minification, and asset guards that keep web-deploy artifacts out of the APK

### ⚡ Performance

- Bounded, paginated list reads so a growing lab history never turns a screen into a full table scan
- Cache-first service worker and pre-paint theme bootstrap for the web build

### 🔧 Build & CI

- GitHub Actions: PR checks, Cloudflare Pages deploy with a privacy-site artifact, signed AAB releases with 16 KB page-alignment verification, and AAB/APK build artifacts
- Quality gates: TypeScript strict, ESLint warning ratchet, Vitest coverage gate, husky pre-commit, standard-version releases
