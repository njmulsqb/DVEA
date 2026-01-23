module.exports = {
  repository: {
    owner: 'njmulsqb',
    name: 'DVEA',
  },

  makers: [
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: {},
    },
  ],

  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        draft: true,
      },
    },
  ],
};
