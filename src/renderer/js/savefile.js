document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('savefile-form');
  const status = document.getElementById('status');
  const banner = document.getElementById('app-banner');

  // ---- Task / flag tracking (same contract as the XSS challenge pages' solveTask) ----
  const solved = { 1: false, 2: false, 3: false };

  function renderTask(n, flag) {
    if (solved[n] || !flag) return;
    solved[n] = true;
    const statusEl = document.getElementById('task-' + n + '-status');
    if (statusEl) {
      statusEl.textContent = 'Solved';
      statusEl.className = 'checklist-item pass';
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

  // Apply a state object (from init or from a save) — flags come from main, which awards them
  // only after inspecting real disk state, so nothing here can fabricate a solve.
  function applyState(state) {
    if (!state || state.error) return;
    if (state.flags) {
      for (const n of [1, 2, 3]) if (state.flags[n]) renderTask(n, state.flags[n]);
    }
    if (state.banner) applyBanner(state.banner);
  }

  function applyBanner(b) {
    if (!banner) return;
    if (b.ok) {
      banner.textContent = b.banner;
      banner.classList.remove('bad');
    } else {
      // The config was overwritten with something the app can't parse — that's still the app's
      // behavior changing from a file write, just into a broken state.
      banner.textContent = '⚠ config unreadable: ' + (b.error || 'unknown error');
      banner.classList.add('bad');
    }
  }

  // ---- Recon: ask main where its own files are and what it currently shows ----
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  try {
    const recon = await window.api.initFileWrite();
    if (recon && !recon.error) {
      setText('save-dir', recon.saveDir);
      setText('marker-path', recon.markerPath);
      setText('config-path', recon.configPath);
      applyState(recon);
    } else {
      setText('save-dir', '(failed to initialize lab)');
    }
  } catch (err) {
    setText('save-dir', '(failed to initialize lab: ' + (err && err.message ? err.message : err) + ')');
  }

  // ---- The injection point: renderer-supplied path + content, written unvalidated ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    const path = document.getElementById('filepath').value;
    const content = document.getElementById('filecontent').value;
    try {
      const state = await window.api.saveFile({ path, content });
      status.textContent = 'File written to: ' + (state && state.resolved ? state.resolved : path);
      status.className = 'status-ok';
      applyState(state);
    } catch (err) {
      status.textContent = 'Error: ' + (err && err.message ? err.message : err);
      status.className = 'status-err';
    }
  });
});
