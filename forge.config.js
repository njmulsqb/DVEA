module.exports = {
  packagerConfig: {},
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      
    },
    {
      name: '@electron-forge/maker-rpm',
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
