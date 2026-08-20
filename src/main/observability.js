// Minimal observability store for DVEA
// Holds { config: {}, ipcLog: [] } and pushes one-way snapshots to a
// reserved channel '__dvea_monitor__' in the panel window.

const MAX_STORED_LOG = 500; // total retained entries
const MAX_PUSH_LOG = 200; // entries included in each pushed snapshot

class Observability {
  constructor() {
    this.config = {};
    this.ipcLog = [];
    this._panelWindow = null; // BrowserWindow instance
  }

  setPanelWindow(win) {
    this._panelWindow = win;
  }

  clearPanelWindow() {
    this._panelWindow = null;
  }

  // Replace or merge config. Caller-owned objects are fine.
  updateConfig(patch) {
    Object.assign(this.config, patch);
    this._pushSnapshot();
  }

  // Push an ipcLog entry. Maintain bounded storage and push a snapshot.
  pushIpcLog(entry) {
    try {
      this.ipcLog.push(entry);
      if (this.ipcLog.length > MAX_STORED_LOG) {
        // drop oldest
        this.ipcLog.splice(0, this.ipcLog.length - MAX_STORED_LOG);
      }
    } catch (err) {
      // ignore malformed entries
    }
    this._pushSnapshot();
  }

  // Internal: send a snapshot to the panel window (one-way).
  _pushSnapshot() {
    if (!this._panelWindow) return;
    try {
      if (this._panelWindow.isDestroyed && this._panelWindow.isDestroyed()) return;
    } catch {}

    const snapshot = {
      config: this.config,
      ipcLog: this.ipcLog.slice(-MAX_PUSH_LOG),
      ts: Date.now(),
    };

    try {
      this._panelWindow.webContents.send('__dvea_monitor__', snapshot);
    } catch (err) {
      // no-op if send fails (window may be closed)
    }
  }
}

module.exports = new Observability();
