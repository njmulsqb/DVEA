// Minimal observability store for DVEA
// Holds { config: {}, ipcLog: [] } and pushes one-way snapshots to a
// reserved channel '__dvea_monitor__' in the panel window.

const MAX_STORED_LOG = 500; // total retained entries
const MAX_PUSH_LOG = 200; // entries included in each pushed snapshot

class Observability {
  constructor() {
    this.config = {}; // top-level store values
    this.ipcLog = [];
    this._panelWindow = null; // BrowserWindow instance
    this._windows = new Map(); // id -> { win, declared, effective, preload, csp }
  }

  // Serialize IPC args with caps and optional redaction
  serializeArgs(args, redact = false) {
    const perArgMax = 1024; // chars per arg
    const totalMax = 16 * 1024; // total chars
    let pieces = [];
    let total = 0;
    for (const a of args || []) {
      let text;
      try {
        if (redact) {
          text = '<<REDACTED>>';
        } else {
          text = JSON.stringify(a);
        }
      } catch (err) {
        try {
          text = String(a);
        } catch {
          text = '<unserializable>';
        }
      }
      if (text.length > perArgMax) text = text.slice(0, perArgMax) + '...';
      if (total + text.length > totalMax) {
        pieces.push('[truncated]');
        break;
      }
      pieces.push(text);
      total += text.length;
    }
    return pieces;
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

  // Register a created window so we can read declared prefs and probe effective ones.
  registerWindow(win, declaredWebPreferences = {}) {
    if (!win || !win.id) return;
    this._windows.set(win.id, {
      win,
      declared: declaredWebPreferences,
      effective: null,
      preload: null,
      csp: null,
    });
    // push initial declared state into store.config.windows
    this._publishWindowConfig(win.id);
    // listen for webContents focus to set active
    try {
      win.on('focus', () => this.setActiveWindow(win.id));
      win.on('closed', () => this.unregisterWindow(win));
      // Re-read on navigation/load events so CSP meta and other prefs update.
      try {
        if (win.webContents) {
          win.webContents.on('did-finish-load', () => this.refreshWindow(win));
          win.webContents.on('did-navigate', () => this.refreshWindow(win));
          win.webContents.on('did-navigate-in-page', () => this.refreshWindow(win));
          win.webContents.on('dom-ready', () => this.refreshWindow(win));
        }
      } catch (err) {}
    } catch {}
    // attempt initial scan (includes effective prefs + meta CSP)
    this.refreshWindow(win);
  }

  unregisterWindow(win) {
    const id = win && win.id ? win.id : win;
    this._windows.delete(id);
    if (this.config.activeWindow === id) {
      this.updateConfig({ activeWindow: null });
    }
    this._pushSnapshot();
  }

  setActiveWindow(id) {
    if (!id) return;
    this.updateConfig({ activeWindow: id });
    const info = this._windows.get(id);
    if (info && info.win) this._updateEffectiveFromWin(info.win);
  }

  handlePreloadCorroboration(webContentsId, data) {
    const entry = this._windows.get(webContentsId);
    if (!entry) return;
    entry.preload = data;
    this._publishWindowConfig(webContentsId);
  }

  handleCspForWebContents(webContentsId, cspValue) {
    const entry = this._windows.get(webContentsId);
    if (!entry) return;
    entry.csp = cspValue || 'none';
    this._publishWindowConfig(webContentsId);
  }

  _publishWindowConfig(id) {
    const entry = this._windows.get(id);
    if (!entry) return;
    // Build a windows map for store.config
    const winMap = this.config.windows || {};
    winMap[id] = {
      declared: entry.declared || {},
      effective: entry.effective || {},
      preload: entry.preload || null,
      csp: entry.csp || 'none',
      versions: entry.versions || null,
    };
    this.updateConfig({ windows: winMap });
  }

  _updateEffectiveFromWin(win) {
    if (!win || !win.webContents) return;
    try {
      const webPrefs = win.webContents.getLastWebPreferences() || {};
      const info = this._windows.get(win.id);
      if (!info) return;
      info.effective = {
        nodeIntegration: !!webPrefs.nodeIntegration,
        contextIsolation: !!webPrefs.contextIsolation,
        sandbox: !!webPrefs.sandbox,
        webSecurity: !!webPrefs.webSecurity,
        preload: webPrefs.preload || null,
        nodeIntegrationInSubFrames: !!webPrefs.nodeIntegrationInSubFrames,
        webviewTag: !!webPrefs.webviewTag,
      };
      info.versions = {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      };
      this._publishWindowConfig(win.id);
      // Attach session header listener to capture CSP for this webContents id
      try {
        const ses = win.webContents.session;
        const entry = this._windows.get(win.id) || {};
        if (!entry._headersHooked) {
          ses.webRequest.onHeadersReceived((details, callback) => {
            try {
              if (details.webContentsId === win.webContents.id) {
                const headers = details.responseHeaders || {};
                // Normalize header key casing
                const csp = headers['content-security-policy'] || headers['Content-Security-Policy'] || headers['content-security-policy-report-only'] || headers['Content-Security-Policy-Report-Only'];
                if (csp && csp.length) {
                  const val = Array.isArray(csp) ? csp.join('; ') : String(csp);
                  this.handleCspForWebContents(win.id, val);
                }
              }
            } catch (err) {}
            callback({ cancel: false });
          });
          entry._headersHooked = true;
          this._windows.set(win.id, entry);
        }
      } catch (err) {}
    } catch (err) {}
  }

  // Public: re-scan effective prefs and CSP meta for a window (called on load/navigation)
  refreshWindow(win) {
    try {
      if (!win || !win.webContents) return;
      this._updateEffectiveFromWin(win);
      // Try to read meta CSP from DOM for local files
        try {
          const js = `(function(){var m = document.querySelector('meta[http-equiv="Content-Security-Policy" i]'); return m ? m.content : null; })()`;
          const entry = this._windows.get(win.id) || {};
          // clear retry marker
          entry._metaRetry = false;
          win.webContents.executeJavaScript(js, true)
            .then((val) => {
              if (val) {
                this.handleCspForWebContents(win.id, val);
              } else {
                // If no meta found, schedule a single delayed retry to catch dynamically-inserted metas
                if (!entry._metaRetry) {
                  entry._metaRetry = true;
                  this._windows.set(win.id, entry);
                  setTimeout(() => {
                    try {
                      win.webContents.executeJavaScript(js, true).then((val2) => {
                        if (val2) this.handleCspForWebContents(win.id, val2);
                      }).catch(() => {});
                    } catch (err) {}
                  }, 150);
                }
              }
            })
            .catch(() => {});
        } catch (err) {}
    } catch (err) {}
  }

  // Push an ipcLog entry. Maintain bounded storage and push a snapshot.
  pushIpcLog(entry) {
    try {
      // Deduplicate rapid duplicate entries coming from multiple capture points
      // Consider entries duplicate when kind, direction, channel, senderId match
      // within a short time window (500ms). Compare against recent tail of log.
      const now = entry && entry.ts ? entry.ts : Date.now();
      const recentWindow = 500; // ms
      const tail = this.ipcLog.slice(-20); // check last 20 entries
      let isDup = false;
      for (let i = tail.length - 1; i >= 0; i--) {
        const e = tail[i];
        if (!e) continue;
        if (Math.abs((e.ts || 0) - now) > recentWindow) continue;
        if (e.kind === entry.kind && e.direction === entry.direction && e.channel === entry.channel && e.senderId === entry.senderId) {
          isDup = true;
          break;
        }
      }
      if (isDup) return; // skip duplicate

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
