// Demo wiring: use the exact vulnerable navigation path implemented in main
// (main loads attacker-controlled URL into the trusted app window).

document.addEventListener('DOMContentLoaded', () => {
  const targetInput = document.getElementById('target');
  const simulate = document.getElementById('simulate');

  const status = document.getElementById('simulate-status');

  function setStatus(text, ok) {
    if (!status) return;
    status.textContent = text;
    status.className = 'text-small ' + (ok ? 'text-gray' : 'simulate-status-error');
  }

  simulate?.addEventListener('click', async () => {
    const url = targetInput && targetInput.value;
    if (!url) {
      setStatus('Enter a target URL first.', false);
      return;
    }
    setStatus('Opening…', true);
    try {
      // Same vulnerable main-process navigation path a real deep link would use.
      const res = await window.api.simulateDeepLinkWindow(url);
      // Main reports what it actually did. Without this the invoke resolves to undefined
      // whether a window opened or not, so a failed target looked identical to success.
      if (res && res.ok) {
        setStatus('Opened a new app window loading: ' + res.target, true);
      } else {
        setStatus((res && res.error) || 'Could not open that target.', false);
      }
    } catch (err) {
      console.error('simulateDeepLinkWindow failed', err);
      setStatus('Failed: ' + err.message, false);
    }
  });

  // Listen for harvested credentials forwarded by main and display them in the attacker view.
  const capturedLog = document.getElementById('captured-log');
  if (capturedLog && window.ipc && window.ipc.onCaptured) {
    window.ipc.onCaptured((_, data) => {
      try {
        const pretty = JSON.stringify(data, null, 2);
        capturedLog.textContent = pretty;
      } catch (err) {
        capturedLog.textContent = String(data);
      }
    });
  }
});
