document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('path');
  const btn = document.getElementById('simulate-open');
  const out = document.getElementById('file-output');

  const defaultPath = new URL('secret.txt', window.location.href).pathname.replace('file://','');
  if (input) input.value = 'src/renderer/pages/secret.txt';

  btn?.addEventListener('click', async () => {
    const p = input && input.value;
    out.textContent = 'Reading...';
    try {
      const res = await window.api.simulateDeepLinkOpen(p);
      out.textContent = res && res.content ? res.content : (res && res.error) || String(res);
    } catch (err) {
      out.textContent = 'Error: ' + err.message;
    }
  });

  // Listen for real deep-link open events forwarded from main
  if (window.api && window.ipc && window.ipc.onDeepLinkOpen) {
    window.ipc.onDeepLinkOpen((_, data) => {
      try {
        const text = data && data.content ? data.content : (data && data.error) || JSON.stringify(data);
        out.textContent = text;
      } catch (err) { out.textContent = String(data); }
    });
  }
});
