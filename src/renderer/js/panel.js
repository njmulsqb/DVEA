// Subscribe to monitor updates exposed by preload-panel.js.
// Capture wiring (monitor.onUpdate + the client-side __dvea_monitor__ / ipc-monitor-preload
// filter) is unchanged — only the rendering was rebuilt to the terminal aesthetic.
const lastEl = document.getElementById('last-update');
const countEl = document.getElementById('ipc-count');
const storeEl = document.getElementById('store');
const ipcLogContainer = document.getElementById('ipc-log-container');
const ipcLogEl = document.getElementById('ipc-log');

// Classify a log row's accent by IPC direction/kind for the terminal log treatment.
function loglineModifier(e) {
  const dir = e.direction || '';
  const kind = e.kind || '';
  if (kind === 'invoke-response') return 'ok';
  if (dir === 'R→M') return 'info';
  if (dir === 'M→R') return 'muted';
  return 'muted';
}

function renderIpcLog(entries) {
  if (!ipcLogEl) return;
  const wasNearBottom =
    ipcLogContainer.scrollHeight - ipcLogContainer.scrollTop - ipcLogContainer.clientHeight < 40;

  ipcLogEl.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-note';
    empty.textContent = 'no ipc traffic captured yet';
    ipcLogEl.appendChild(empty);
  }

  for (const e of entries) {
    const row = document.createElement('div');
    row.className = 'logline logline--' + loglineModifier(e);

    const ts = document.createElement('span');
    ts.className = 'logline__ts';
    ts.textContent = new Date(e.ts).toLocaleTimeString();

    const tag = document.createElement('span');
    tag.className = 'logline__tag';
    const dir = e.direction || '';
    const kind = e.kind || '';
    tag.textContent = (dir + ' ' + kind).trim();

    const msg = document.createElement('span');
    msg.className = 'logline__msg';
    const chan = e.channel || '';
    const sender = e.senderId != null ? '#' + e.senderId : '';
    const args = e.args ? e.args.join(' ') : '';
    msg.textContent = [chan, sender, args].filter(Boolean).join('  ');

    row.appendChild(ts);
    row.appendChild(tag);
    row.appendChild(msg);
    ipcLogEl.appendChild(row);
  }

  if (wasNearBottom) {
    ipcLogContainer.scrollTop = ipcLogContainer.scrollHeight;
  }
}

if (window.monitor && window.monitor.onUpdate) {
  window.monitor.onUpdate((payload) => {
    try {
      lastEl.textContent = new Date(payload.ts).toLocaleTimeString();
      storeEl.textContent = JSON.stringify(payload.config || {}, null, 2);
      const entries = (payload.ipcLog || []).filter((e) => {
        // defensive client-side filter: exclude plumbing channel entries
        if (!e || !e.channel) return true;
        if (String(e.channel).startsWith('__dvea_monitor__')) return false;
        if (String(e.channel).startsWith('ipc-monitor-preload')) return false;
        return true;
      });
      if (countEl) countEl.textContent = entries.length + ' events';
      renderIpcLog(entries);
    } catch (err) {
      storeEl.textContent = String(payload);
    }
  });
} else {
  lastEl.textContent = 'monitor API not available';
}
