// Subscribe to monitor updates exposed by preload-panel.js
const lastEl = document.getElementById('lastUpdate');
const storeEl = document.getElementById('store');

if (window.monitor && window.monitor.onUpdate) {
  window.monitor.onUpdate((payload) => {
    try {
      lastEl.textContent = new Date(payload.ts).toLocaleString();
      storeEl.textContent = JSON.stringify(payload, null, 2);
    } catch (err) {
      storeEl.textContent = String(payload);
    }
  });
} else {
  lastEl.textContent = 'monitor API not available';
}
