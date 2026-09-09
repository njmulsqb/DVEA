document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start-server');
  const stopBtn = document.getElementById('stop-server');
  const resetBtn = document.getElementById('reset-server');
  const feedInput = document.getElementById('feed-url');
  const modeSelect = document.getElementById('mode');
  const checkBtn = document.getElementById('check-update');
  const logEl = document.getElementById('log');
  const backdoorNote = document.getElementById('backdoor-note');

  function log(msg) {
    const now = new Date().toISOString();
    logEl.textContent = `[${now}] ${msg}\n` + logEl.textContent;
  }

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '—';
  };

  // ---- Task / flag tracking (same contract as the other challenge pages' solveTask) ----
  // Task 3 is a blocked-forgery outcome — it renders amber "Contained ✓", not green "Solved".
  const CONTAINED_TASKS = new Set([3]);
  const solved = { 1: false, 2: false, 3: false };

  function renderTask(n, flag) {
    if (solved[n] || !flag) return;
    solved[n] = true;
    const statusEl = document.getElementById('task-' + n + '-status');
    if (statusEl) {
      if (CONTAINED_TASKS.has(n)) {
        statusEl.textContent = 'Contained ✓';
        statusEl.className = 'checklist-item contained';
      } else {
        statusEl.textContent = 'Solved';
        statusEl.className = 'checklist-item pass';
      }
    }
    const item = document.getElementById('task-' + n);
    const flagEl = item ? item.querySelector('.task-flag') : null;
    if (flagEl) {
      flagEl.hidden = false;
      flagEl.textContent = 'Flag: ' + flag;
    }
    updateProgress();
  }

  function updateProgress() {
    const count = Object.values(solved).filter(Boolean).length;
    const el = document.getElementById('flag-progress');
    if (el) el.textContent = '(' + count + ' / 3 flags captured)';
  }
  updateProgress();

  function applyFlags(flags) {
    if (!flags) return;
    for (const n of [1, 2, 3]) if (flags[n]) renderTask(n, flags[n]);
  }

  function resetTaskUI() {
    for (const n of [1, 2, 3]) {
      solved[n] = false;
      const statusEl = document.getElementById('task-' + n + '-status');
      if (statusEl) {
        statusEl.textContent = 'Unsolved';
        statusEl.className = 'checklist-item fail';
      }
      const item = document.getElementById('task-' + n);
      const flagEl = item ? item.querySelector('.task-flag') : null;
      if (flagEl) {
        flagEl.hidden = true;
        flagEl.textContent = '';
      }
    }
    updateProgress();
    if (backdoorNote) backdoorNote.textContent = 'No payload has executed yet.';
  }

  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    log('Starting local feed server...');
    try {
      const info = await window.api.startAutoUpdateServer();
      // Starting the server begins a fresh challenge (main resets its flags too).
      resetTaskUI();
      log('Server started: HTTP port ' + info.httpPort + ', HTTPS port ' + info.httpsPort);
      setText('recon-http-root', info.httpRoot);
      setText('recon-http-clean', info.httpCleanManifest);
      setText('recon-http-poisoned', info.httpPoisonedManifest);
      setText('recon-https-root', info.httpsRoot);
      setText('recon-https-clean', info.httpsCleanManifest);
      setText('recon-https-poisoned', info.httpsPoisonedManifest);
      setText('recon-wallet', info.walletPath);
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
    log('Resetting (stop server + clear sentinels + reset challenge)...');
    try {
      const res = await window.api.resetAutoUpdate();
      log(res && res.ok ? 'Reset complete.' : 'Reset failed: ' + JSON.stringify(res));
    } catch (err) {
      log('Reset error: ' + err);
    } finally {
      resetBtn.disabled = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      feedInput.value = '';
      resetTaskUI();
      ['recon-http-root','recon-http-clean','recon-http-poisoned','recon-https-root','recon-https-clean','recon-https-poisoned','recon-wallet']
        .forEach((id) => setText(id, null));
    }
  });

  checkBtn.addEventListener('click', async () => {
    const feed = feedInput.value.trim();
    const mode = modeSelect.value;
    if (!feed) {
      log('Feed URL is empty');
      return;
    }
    log(`Checking for updates (mode=${mode}) against ${feed} ...`);
    try {
      const res = await window.api.checkForUpdate({ feed, mode });
      if (res.success) {
        log('Update APPLIED: ' + JSON.stringify({ success: res.success, applied: res.applied }));
      } else {
        log('Update rejected/failed: ' + (res.reason || 'unknown'));
      }
      if (res.backdoorNote && backdoorNote) {
        backdoorNote.textContent = res.backdoorNote;
      }
      applyFlags(res.flags);
    } catch (err) {
      log('Error: ' + (err && err.message ? err.message : err));
    }
  });

});
