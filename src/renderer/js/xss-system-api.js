document.addEventListener('DOMContentLoaded', () => {
  function setBadge(id, ok, label) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (ok ? '✓ ' : '✗ ') + label;
    el.className = 'checklist-item ' + (ok ? 'pass' : 'fail');
  }

  // ---- Privileged-bridge check: genuinely observable from THIS world ----
  // Unlike Challenge 1, this window's preload DOES expose something — that's the whole
  // point of this challenge, so this badge should read true/red here.
  const hasPrivilegedBridge = typeof window.systemAPI !== 'undefined';
  setBadge('badge-preload', !hasPrivilegedBridge, 'Privileged bridge: ' + hasPrivilegedBridge);

  // ---- Sandbox / ContextIsolation / NodeIntegration: sourced from the MAIN PROCESS ----
  // Same fix as Challenge 1: window.process doesn't exist in this main world under
  // contextIsolation: true, so these are read from window.__dveaWindowConfig, which main
  // pushes via executeJavaScript from the same getLastWebPreferences() data the Config
  // Inspector uses — not a contextBridge exposure, just a one-way data write.
  const windowConfig = { sandbox: null, contextIsolation: null, nodeIntegration: null };

  function applyWindowConfig(cfg) {
    if (!cfg) return;
    windowConfig.sandbox = !!cfg.sandbox;
    windowConfig.contextIsolation = !!cfg.contextIsolation;
    windowConfig.nodeIntegration = !!cfg.nodeIntegration;
    setBadge('badge-sandbox', windowConfig.sandbox, 'Sandbox: ' + windowConfig.sandbox);
    setBadge('badge-isolation', windowConfig.contextIsolation, 'ContextIsolation: ' + windowConfig.contextIsolation);
    setBadge('badge-nodeintegration', !windowConfig.nodeIntegration, 'NodeIntegration: ' + windowConfig.nodeIntegration);
  }

  if (window.__dveaWindowConfig) {
    applyWindowConfig(window.__dveaWindowConfig);
  } else {
    window.addEventListener('dvea-config-ready', () => applyWindowConfig(window.__dveaWindowConfig));
  }

  // ---- The injection point: unsanitized input rendered via innerHTML (same sink as Ch1) ----
  const form = document.getElementById('xssForm2');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.getElementById('xssInput2').value;
      document.getElementById('xssOutput2').innerHTML = val;
    });
  }

  // ---- Task / flag tracking (same contract as Challenge 1's solveTask) ----
  const FLAGS = {
    1: 'DVEA{overprivileged_bridge_found}',
    2: 'DVEA{bridge_command_executed}',
    3: 'DVEA{bridge_to_os_pivot}',
  };
  const solved = { 1: false, 2: false, 3: false };

  const TASK_VARIANTS = {
    exploited: { className: 'checklist-item pass', label: 'Solved' },
    contained: { className: 'checklist-item contained', label: 'Contained ✓' },
  };

  function solveTask(n, note, variant) {
    if (solved[n]) return;
    solved[n] = true;

    const v = TASK_VARIANTS[variant] || TASK_VARIANTS.exploited;
    const status = document.getElementById('task-' + n + '-status');
    if (status) {
      status.textContent = v.label;
      status.className = v.className;
    }
    const item = document.getElementById('task-' + n);
    const flagEl = item ? item.querySelector('.task-flag') : null;
    if (flagEl) {
      flagEl.hidden = false;
      flagEl.textContent = 'Flag: ' + FLAGS[n] + (note ? ' — ' + note : '');
    }
    updateProgress();
  }

  function updateProgress() {
    const count = Object.values(solved).filter(Boolean).length;
    const el = document.getElementById('flag-progress');
    if (el) el.textContent = '(' + count + ' / 3 flags captured)';
  }
  updateProgress();

  // ---- Watch the attacker view for recon / bridge output ----
  const attackerLog = document.getElementById('attacker-log');

  function checkExfil() {
    const text = attackerLog ? attackerLog.textContent : '';
    if (!text) return;

    if (!solved[1]) {
      const m = text.match(/found:(\w+)/);
      // Don't just trust the claimed name — confirm window[name] is genuinely the shape
      // of the exposed bridge (an object with a runCommand function), same rigor as
      // Challenge 1's Task 4 verifying a real thrown error rather than a fabricated string.
      if (m && m[1] && window[m[1]] && typeof window[m[1]].runCommand === 'function') {
        solveTask(1, 'found window.' + m[1] + '.runCommand()');
      }
    }
    if (!solved[2] && text.includes(FLAGS[2])) {
      solveTask(2);
    }
    if (!solved[3] && text.includes(FLAGS[3])) {
      solveTask(3);
    }
  }

  if (attackerLog) {
    new MutationObserver(checkExfil).observe(attackerLog, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
});
