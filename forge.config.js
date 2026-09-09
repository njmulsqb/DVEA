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