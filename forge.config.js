module.exports = {
  packagerConfig: {},
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-appimage',
      config: {},
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
