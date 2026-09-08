document.addEventListener('DOMContentLoaded', () => {
  function setBadge(id, ok, label) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (ok ? '✓ ' : '✗ ') + label;
    el.className = 'checklist-item ' + (ok ? 'pass' : 'fail');
  }

  // ---- Privileged-bridge check: genuinely observable from THIS world ----
  // Whether a preload exposed something via contextBridge is a fact about this main
  // world specifically, so it's measured here directly rather than asserted from main.
  const noPrivilegedBridge = typeof window.api === 'undefined' && typeof window.systemapi === 'undefined';
  setBadge('badge-preload', noPrivilegedBridge, 'Privileged bridge: ' + !noPrivilegedBridge);

  // ---- Sandbox / ContextIsolation / NodeIntegration: sourced from the MAIN PROCESS ----
  // With contextIsolation: true, `window.process` does not exist in this main world at all
  // (it lives only in the preload's isolated world) — probing it here would read undefined
  // and misreport these badges as false precisely BECAUSE isolation is working. So instead,
  // main pushes this window's real effective webPreferences — the exact same
  // getLastWebPreferences() data the Config Inspector reads (src/main/observability.js) —
  // directly into this world via executeJavaScript once the page has loaded (see
  // openXSSContainedWindow() in src/main/main.js). That's a one-way data write, not a
  // contextBridge exposure: nothing callable is added to this world, so it doesn't touch the
  // privileged-bridge badge above.
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

  // ---- Sensitive-looking session token this page displays ----
  const token =
    'sess_' +
    Array.from(crypto.getRandomValues(new Uint8Array(10)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const tokenEl = document.getElementById('session-token');
  if (tokenEl) tokenEl.textContent = token;

  // ---- Renderer-local storage secret (Task 2 target; the value IS the flag) ----
  const STORAGE_FLAG = 'DVEA{localStorage_is_reachable}';
  try {
    localStorage.setItem('dvea_secret', STORAGE_FLAG);
  } catch (err) {}

  // ---- The injection point: unsanitized input rendered via innerHTML ----
  const form = document.getElementById('xssForm1');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.getElementById('xssInput1').value;
      document.getElementById('xssOutput1').innerHTML = val;
    });
  }

  // ---- Task / flag tracking ----
  const FLAGS = {
    1: 'DVEA{renderer_dom_theft}',
    2: STORAGE_FLAG,
    3: 'DVEA{xss_phishing_harvest}',
    4: 'DVEA{contained_the_sandbox_held}',
  };
  const solved = { 1: false, 2: false, 3: false, 4: false };

  // A completed task is not always the same kind of outcome. Tasks 1-3 are exploit
  // successes (green). The "try to escape" task type is different: here the escape is
  // BLOCKED by the hardened config, which is itself the thing to confirm — not the same
  // as an exploit landing, so it gets a visually distinct amber "Contained" state rather
  // than green "Solved". The same task type reappears in later challenges where the
  // escape actually succeeds; that variant renders as green "Exploited" instead — pass
  // 'exploited' as the variant there. This function is written to support both.
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
    if (el) el.textContent = '(' + count + ' / 4 flags captured)';
  }
  updateProgress();

  // ---- Watch the attacker view for exfiltrated / harvested data ----
  const attackerLog = document.getElementById('attacker-log');

  function checkExfil() {
    const text = attackerLog ? attackerLog.textContent : '';
    if (!text) return;

    if (!solved[1] && text.includes(token)) {
      solveTask(1);
    }
    if (!solved[2] && text.includes(STORAGE_FLAG)) {
      solveTask(2);
    }
    if (!solved[3]) {
      const m = text.match(/cred:([^\s:<>]+):([^\s:<>]+)/);
      if (m && m[1] && m[2]) solveTask(3);
    }
  }

  if (attackerLog) {
    new MutationObserver(checkExfil).observe(attackerLog, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  // ---- Watch for a genuinely blocked escape attempt (Task 4) ----
  // An injected payload that references require/process internals/child_process throws a
  // real ReferenceError from the JS engine (nothing here fabricates the failure) — if the
  // payload doesn't swallow it itself, it surfaces here as an uncaught error.
  window.addEventListener('error', (event) => {
    if (solved[4]) return;
    const msg = (event && event.message) || '';
    const triedNodeSymbol = /\b(require|process\.binding|process\.mainModule|child_process|__dirname|module\.exports)\b/.test(
      msg
    );
    const genuinelyBlocked = /is not defined|is not a function/.test(msg);
    if (triedNodeSymbol && genuinelyBlocked) {
      solveTask(
        4,
        'blocked because sandbox=' + windowConfig.sandbox + ', contextIsolation=' + windowConfig.contextIsolation +
          ', nodeIntegration=' + windowConfig.nodeIntegration + ' — check the Config Inspector for this window.',
        'contained'
      );
    }
  });
});
