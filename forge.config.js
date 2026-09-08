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