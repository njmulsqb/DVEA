module.exports = {
  packagerConfig: {
    // NOTE: Electron Forge's own default `ignore` (excludes its /out build-output dir)
    // is only applied if packagerConfig has no `ignore` of its own — setting `ignore`
    // here replaces, not merges with, that default. /^\/out\// is repeated below so the
    // build-output dir stays excluded from packaging.
    //
    // Keep repo-only docs out of the packaged/shipped app. Lab writeups in particular
    // must never be reachable from a filesystem path inside a built/installed DVEA —
    // they're meant to be read from the source repo, not shipped alongside the app.
    ignore: [/^\/out\//, /^\/writeups($|\/)/],
  },
  rebuildConfig: {},
  makers: [

    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: {
        // Without this the generated .desktop file has no MimeType line, so nothing in the
        // desktop database claims x-scheme-handler/dvea — a browser or `xdg-open dvea://...`
        // finds no handler and falls back to a web search. The whole Deep Link Hijacking
        // module depends on the OS routing this scheme to DVEA.
        mimeType: ['x-scheme-handler/dvea'],

        // App icon for the installed .deb. Deliberately the OBJECT form, not a plain string
        // path: electron-installer-common treats a string as a single legacy *pixmap* icon
        // (/usr/share/pixmaps/dvea.png), which modern desktop environments often ignore — the
        // usual reason a packaged Linux Electron app installs with a blank/generic icon even
        // though the config looks right. Each key here is installed into the hicolor theme as
        // /usr/share/icons/hicolor/<key>/apps/dvea.png, which is what the generated .desktop
        // file's `Icon=dvea` line actually resolves against.
        //
        // Format is fixed by the installer, not a preference: numeric size keys MUST be PNG and
        // the file's real pixel dimensions must match the key, while `scalable` MUST be SVG.
        // Note packagerConfig.icon is intentionally NOT set — @electron/packager only applies
        // that on Windows (.ico) and macOS (.icns), so it would do nothing for the .deb.
        icon: {
          '16x16': 'assets/dvea-favicon-16.png',
          '32x32': 'assets/dvea-favicon-32.png',
          '512x512': 'assets/dvea-icon-512.png',
          scalable: 'assets/dvea-icon-crimson.svg',
        },
      },
    },
   
  ],
  publishers: [
  {
    name: '@electron-forge/publisher-github',
    config: {
      repository: {
        owner: 'njmulsqb',
        name: 'DVEA',
      },
      draft: true,
      prerelease: false,
    },
  },
],
};