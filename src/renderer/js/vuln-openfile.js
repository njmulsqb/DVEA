document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('path');
  const btn = document.getElementById('simulate-open');
  const out = document.getElementById('file-output');

  btn?.addEventListener('click', async () => {
    const p = input && input.value;
    if (!p) return;
    out.textContent = 'Reading...';
    try {
      const res = await window.api.simulateDeepLinkOpen(p);
      out.textContent = res && res.content ? res.content : (res && res.error) || String(res);
    } catch (err) {
      out.textContent = 'Error: ' + err.message;
    }
  });

  // Listen for real deep-link open events forwarded from main.
  // onDeepLinkOpen lives on window.api (see preload.js) — window.ipc only carries onRedirect
  // and onCaptured. Guarding on window.ipc.onDeepLinkOpen was always false, so the listener
  // never registered and a real dvea://open?path=... link rendered nothing, even though main
  // had read the file and sent it. The simulator button hid this: it uses invoke() and gets
  // the content back as a return value, never touching this listener.
  if (window.api && window.api.onDeepLinkOpen) {
    window.api.onDeepLinkOpen((_, data) => {
      try {
        const text = data && data.content ? data.content : (data && data.error) || JSON.stringify(data);
        out.textContent = text;
      } catch (err) { out.textContent = String(data); }
    });
  }
});
