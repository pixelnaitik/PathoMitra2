/**
 * electron-builder configuration — Windows first.
 *
 * Default artifact: a single self-contained **.msi** — double-click, one UAC
 * "Yes", and PathoMitra is installed for every account on the machine with a
 * Desktop and Start Menu shortcut. It is also the format lab IT can push with
 * GPO/SCCM (`msiexec /i PathoMitra-<version>.msi /qn`), and Windows Installer
 * never touches %APPDATA%\PathoMitra on uninstall, so the encrypted database
 * and the exported reports survive an upgrade or a removal.
 *
 * Choose another target with PM_WIN_TARGETS: `nsis` (per-user setup exe, no
 * elevation) or `appx`.
 *
 * msix is deliberately absent: electron-builder 26.15.3 has no msix target at
 * all (out/winPackager.js knows nsis/portable/nsis-web/squirrel/appx/msi/
 * msiwrapped — the last attempt died with "Unknown target: msix", see
 * .tmp/electron-builder.log), and MSIX is the wrong container for this app
 * because it redirects %APPDATA%\PathoMitra into the package LocalCache, which
 * Windows deletes on uninstall/repair. MSIX comes back only as a Microsoft
 * Store artifact, on electron-builder 27.x — see PROJECT_MEMORY.
 *
 * `buildResources` is NOT the default `build/` because the root .gitignore
 * pattern `build/` matches at any depth — default would make the tile
 * logos silently un-committable.
 */
export default {
  appId: 'com.pathomitra.desktop',
  productName: 'PathoMitra',
  copyright: 'Copyright © 2026 Naitik Raj',
  directories: {
    output: 'release-desktop',
    buildResources: 'desktop-resources',
  },
  // Only the built artifacts go into the app payload; src/ stays out.
  files: ['dist/**', 'dist-electron/**'],
  // Native modules load from unpacked node_modules — asar cannot host .node files.
  asarUnpack: [
    'node_modules/better-sqlite3-multiple-ciphers/**',
    'node_modules/@napi-rs/keyring/**',
  ],
  win: {
    target: (process.env.PM_WIN_TARGETS ?? 'msi')
      .split(',')
      .filter(Boolean)
      .map(name => ({ target: name.trim(), arch: ['x64'] })),
  },
  msi: {
    // Double-click → progress → installed. The wizard only appears if this is
    // set to false (electron-builder then pulls in the WiX UI extension).
    oneClick: true,
    // Program Files, one install shared by every Windows account, shortcut on
    // the public Desktop. Costs a single UAC prompt; this is also the scope
    // GPO/SCCM assignment needs.
    perMachine: true,
    // 'always' re-creates the link on a reinstall even if the operator deleted
    // it — a lab PC's desktop gets tidied by hand.
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'PathoMitra',
    // No "Naitik Raj" submenu: one clinical app, straight into the Start Menu.
    menuCategory: false,
    runAfterFinish: true,
    artifactName: 'PathoMitra-${version}.${ext}',
  },
  nsis: {
    // The per-user alternative (PM_WIN_TARGETS=nsis): no elevation, installs
    // into %LOCALAPPDATA%\Programs, still leaves a Desktop shortcut.
    oneClick: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'PathoMitra',
    runAfterFinish: true,
    // Uninstall must never take the lab's data with it (MSI has no such option
    // — it simply does not touch the app folders).
    deleteAppDataOnUninstall: false,
    uninstallDisplayName: 'PathoMitra',
    artifactName: 'PathoMitra-${version}-setup.${ext}',
  },
  appx: {
    // Reserved for the Store listing; must match the Partner Center reservation.
    identityName: 'PathoMitra.PathoMitra',
    // Only used for sideload signing — the Store re-signs on submission.
    publisher: 'CN=Naitik Raj',
    publisherDisplayName: 'Naitik Raj',
    displayName: 'PathoMitra',
    // Offline app: deliberately nothing beyond the Electron-mandatory capability.
    capabilities: ['runFullTrust'],
    minVersion: '10.0.17763.0', // Windows 10 1809 — Store floor
    maxVersionTested: '10.0.26100.0', // Windows 11 24H2
    artifactName: 'PathoMitra-${version}.${ext}',
  },
  toolsets: {
    // Modern bundle carries makeappx/makepri; the legacy 2.6.0 one cannot do MSIX.
    winCodeSign: '1.1.0',
  },
  publish: null,
};
