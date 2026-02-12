'use strict';

const Store = require('electron-store').default;

class DataStore extends Store {
  constructor(settings) {
    super(settings);

    this.clear();
  }
}

module.exports = DataStore;
