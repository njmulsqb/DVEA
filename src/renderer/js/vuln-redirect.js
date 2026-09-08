// Demo wiring: use the exact vulnerable navigation path implemented in main
// (main loads attacker-controlled URL into the trusted app window).

document.addEventListener('DOMContentLoaded', () => {
  const targetInput = document.getElementById('target');
  const simulate = document.getElementById('simulate');

  simulate?.addEventListener('click', async () => {
    const url = targetInput && targetInput.value;
    if (!url) return;
    try {
      // Same vulnerable main-process navigation path a real deep link would use.
      await window.api.simulateDeepLinkWindow(url);
    } catch (err) {
      console.error('simulateDeepLinkWindow failed', err);
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
