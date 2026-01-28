document.getElementById('runNode').addEventListener('click', () => {
  try {
    // Intentionally vulnerable: direct Node.js access
    const os = require('os');
    document.getElementById('nodeResult').textContent = os.platform();
  } catch (e) {
    document.getElementById('nodeResult').textContent = 'NodeIntegration is not enabled.';
  }
});
