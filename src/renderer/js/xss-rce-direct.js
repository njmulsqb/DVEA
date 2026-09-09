document.addEventListener('DOMContentLoaded', () => {
  function setBadge(id, ok, label) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (ok ? '✓ ' : '✗ ') + label;
    el.className = 'checklist-item ' + (ok ? 'pass' : 'fail');
  }

  // ---- Privileged-bridge check: genuinely observable from THIS world ----
  // Unlike Challenge 2, nothing was deliberately exposed here — this window has no preload at
  // all. The badge stays green precisely because no bridge was ever needed: nodeIntegration
  // alone is enough.
  const noPrivilegedBridge = typeof window.api === 'undefined' && typeof window.systemapi === 'undefined';
  setBadge('badge-preload', noPrivilegedBridge, 'Privileged bridge: ' + !noPrivilegedBridge);

  // ---- Sandbox / ContextIsolation / NodeIntegration: sourced from the MAIN PROCESS ----
  // Same fix as Challenge 1/2: window.process doesn't exist reliably as a cross-check here
  // (this window's isolation is off anyway), so the authoritative values are read from
  // window.__dveaWindowConfig, which main pushes via executeJavaScript from the same
  // getLastWebPreferences() data the Config Inspector uses. NodeIntegration: true is the
  // headline this time — the badge that makes clear where the danger actually lives.
  const windowConfig = { sandbox: null, contextIsolation: null, nodeIntegration: null };
  const groundTruth = { nodeVersion: null, whoami: null };

  function applyWindowConfig(cfg) {
    if (!cfg) return;
    windowConfig.sandbox = !!cfg.sandbox;
    windowConfig.contextIsolation = !!cfg.contextIsolation;
    windowConfig.nodeIntegration = !!cfg.nodeIntegration;
    setBadge('badge-sandbox', windowConfig.sandbox, 'Sandbox: ' + windowConfig.sandbox);
    setBadge('badge-isolation', windowConfig.contextIsolation, 'ContextIsolation: ' + windowConfig.contextIsolation);
    setBadge('badge-nodeintegration', !windowConfig.nodeIntegration, 'NodeIntegration: ' + windowConfig.nodeIntegration);
  }

  function applyGroundTruth(gt) {
    if (!gt) return;
    groundTruth.nodeVersion = gt.nodeVersion || null;
    groundTruth.whoami = gt.whoami || null;
  }

  if (window.__dveaWindowConfig) {
    applyWindowConfig(window.__dveaWindowConfig);
  } else {
    window.addEventListener('dvea-config-ready', () => applyWindowConfig(window.__dveaWindowConfig));
  }
  if (window.__dveaGroundTruth) {
    applyGroundTruth(window.__dveaGroundTruth);
  } else {
    window.addEventListener('dvea-config-ready', () => applyGroundTruth(window.__dveaGroundTruth));
  }

  // ---- The injection point: unsanitized input rendered via innerHTML (same sink as Ch1/Ch2) ----
  const form = document.getElementById('xssForm3');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.getElementById('xssInput3').value;
      document.getElementById('xssOutput3').innerHTML = val;
    });
  }

  // ---- Task / flag tracking (same contract as Challenge 1/2's solveTask) ----
  const FLAGS = {
    1: 'DVEA{node_in_the_renderer}',
    2: 'DVEA{arbitrary_command_execution}',
    3: 'DVEA{full_host_compromise}',
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

  // ---- Watch the attacker view for genuine renderer-side Node/OS output ----
  // Ground truth (real Node version, real `id` output) comes from main introspecting its own
  // process independently of this renderer, so matching against it confirms a payload's
  // output is genuinely from Node/a real command running in THIS page, not a fabricated
  // string.
  const attackerLog = document.getElementById('attacker-log');

  function checkExfil() {
    const text = attackerLog ? attackerLog.textContent : '';
    if (!text) return;

    if (!solved[1] && groundTruth.nodeVersion && text.includes(groundTruth.nodeVersion)) {
      solveTask(1);
    }
    if (!solved[2] && groundTruth.whoami && text.includes(groundTruth.whoami)) {
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
