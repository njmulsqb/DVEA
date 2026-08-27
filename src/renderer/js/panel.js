// Subscribe to monitor updates exposed by preload-panel.js
const lastEl = document.getElementById('lastUpdate');
const storeEl = document.getElementById('store');
const ipcLogContainer = document.getElementById('ipc-log-container');
const ipcLogEl = document.getElementById('ipc-log');

function renderIpcLog(entries) {
  if (!ipcLogEl) return;
  // Determine if the user is near the bottom before rendering
  const wasNearBottom = (ipcLogContainer.scrollHeight - ipcLogContainer.scrollTop - ipcLogContainer.clientHeight) < 40;

  // Render entries as list items
  ipcLogEl.innerHTML = '';
  for (const e of entries) {
    const li = document.createElement('li');
    const time = new Date(e.ts).toLocaleTimeString();
    const chan = e.channel || '';
    const kind = e.kind || '';
    const dir = e.direction || '';
    const sender = e.senderId != null ? `#${e.senderId}` : '';
    const args = e.args ? e.args.join(' ') : '';
    li.textContent = `[${time}] ${dir} ${kind} ${chan} ${sender} ${args}`;
    ipcLogEl.appendChild(li);
  }

  // After rendering, if the view was near bottom, scroll to bottom
  if (wasNearBottom) {
    ipcLogContainer.scrollTop = ipcLogContainer.scrollHeight;
  }
}

if (window.monitor && window.monitor.onUpdate) {
  window.monitor.onUpdate((payload) => {
    try {
      lastEl.textContent = new Date(payload.ts).toLocaleString();
      // show config in the store block
      storeEl.textContent = JSON.stringify(payload.config || {}, null, 2);
      // render ipc log entries specifically and keep user's scroll position if they scrolled up
      const entries = (payload.ipcLog || []).filter((e) => {
        // defensive client-side filter: exclude plumbing channel entries
        if (!e || !e.channel) return true;
        if (String(e.channel).startsWith('__dvea_monitor__')) return false;
        if (String(e.channel).startsWith('ipc-monitor-preload')) return false;
        return true;
      });
      renderIpcLog(entries);
    } catch (err) {
      storeEl.textContent = String(payload);
    }
  });
} else {
  lastEl.textContent = 'monitor API not available';
}
