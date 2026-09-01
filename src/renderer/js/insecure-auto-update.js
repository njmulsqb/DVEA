document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start-server');
  const stopBtn = document.getElementById('stop-server');
  const resetBtn = document.getElementById('reset-server');
  const feedInput = document.getElementById('feed-url');
  const modeSelect = document.getElementById('mode');
  const checkBtn = document.getElementById('check-update');
  const logEl = document.getElementById('log');
  const sentinelBtn = document.getElementById('check-sentinel');
  const sentinelStatus = document.getElementById('sentinel-status');

  function log(msg) {
    const now = new Date().toISOString();
    logEl.textContent = `[${now}] ${msg}\n` + logEl.textContent;
  }

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    log('Starting local feed server...');
    try {
      const info = await window.api.startAutoUpdateServer();
      log('Server started: HTTP port ' + info.httpPort + ', HTTPS port ' + info.httpsPort);
      if (info.httpPoisonedManifest) {
        log('HTTP poisoned manifest: ' + info.httpPoisonedManifest);
        log('HTTP clean manifest: ' + info.httpCleanManifest);
      }
      if (info.httpsPoisonedManifest) {
        log('HTTPS poisoned manifest: ' + info.httpsPoisonedManifest);
        log('HTTPS clean manifest: ' + info.httpsCleanManifest);
      }
      // Prefer HTTP poisoned manifest by default (vulnerable demo). Use HTTPS variant for hardened tests.
      feedInput.value = info.httpPoisonedManifest || info.httpsPoisonedManifest || '';

      // Populate attack artifacts in the UI
      try {
        const pm = document.getElementById('poisoned-manifest');
        const pp = document.getElementById('poisoned-payload');
        const cm = document.getElementById('clean-manifest');
        const cp = document.getElementById('clean-payload');
        if (pm) pm.textContent = info.httpPoisonedManifestText || info.httpsPoisonedManifestText || '';
        if (pp) pp.textContent = info.httpPoisonedPayloadText || info.httpsPoisonedPayloadText || '';
        if (cm) cm.textContent = info.httpCleanManifestText || info.httpsCleanManifestText || '';
        if (cp) cp.textContent = info.httpCleanPayloadText || info.httpsCleanPayloadText || '';
        // Pretty-print JSON manifests if present
        try {
          if (pm && pm.textContent) pm.textContent = JSON.stringify(JSON.parse(pm.textContent), null, 2);
        } catch (e) {}
        try {
          if (cm && cm.textContent) cm.textContent = JSON.stringify(JSON.parse(cm.textContent), null, 2);
        } catch (e) {}
      } catch (err) {
        // ignore UI population errors
      }
      stopBtn.disabled = false;
    } catch (err) {
      log('Error starting server: ' + err);
      startBtn.disabled = false;
    }
  });

  stopBtn.addEventListener('click', async () => {
    stopBtn.disabled = true;
    log('Stopping local feed server...');
    try {
      await window.api.stopAutoUpdateServer();
      log('Server stopped.');
      startBtn.disabled = false;
    } catch (err) {
      log('Error stopping server: ' + err);
      stopBtn.disabled = false;
    }
  });

  resetBtn.addEventListener('click', async () => {
    resetBtn.disabled = true;
    log('Resetting demo (stop server + clear sentinels)...');
    try {
      const res = await window.api.resetAutoUpdate();
      if (res && res.ok) {
        log('Reset complete.');
        feedInput.value = '';
      } else {
        log('Reset failed: ' + (res && res.error ? res.error : JSON.stringify(res)));
      }
    } catch (err) {
      log('Reset error: ' + err);
    } finally {
      resetBtn.disabled = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      // clear artifact displays
      try {
        const ids = ['poisoned-manifest','poisoned-payload','clean-manifest','clean-payload'];
        ids.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.textContent = '';
        });
      } catch (e) {}
    }
  });

  checkBtn.addEventListener('click', async () => {
    log('Checking for updates...');
    const feed = feedInput.value.trim();
    const mode = modeSelect.value;
    if (!feed) {
      log('Feed URL is empty');
      return;
    }
    try {
      const res = await window.api.checkForUpdate({ feed, mode });
      log('Result: ' + JSON.stringify(res));
    } catch (err) {
      log('Error: ' + (err && err.message ? err.message : err));
    }
  });

  sentinelBtn.addEventListener('click', async () => {
    sentinelStatus.textContent = '';
    try {
      const exists = await window.api.checkSentinel();
      sentinelStatus.textContent = exists ? 'Sentinel present — app was compromised.' : 'No sentinel present.';
      sentinelStatus.style.color = exists ? 'red' : 'green';
    } catch (err) {
      sentinelStatus.textContent = 'Error: ' + err;
      sentinelStatus.style.color = 'orange';
    }
  });
});
