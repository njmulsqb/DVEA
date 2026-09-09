// Demo mechanics (unchanged): storing a display name opens the analytics window with it.
document.getElementById('profileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('displayName').value;
  window.api.openAnalytics(name);
});

// Flag submission: the solver pastes the session token they captured by completing the chain.
// Validation happens in the main process (submit-stored-htmli-flag) against the real in-memory
// token — this page never holds the answer.
const flagBtn = document.getElementById('flagSubmitBtn');
const flagInput = document.getElementById('flagSubmit');
const flagResult = document.getElementById('flagResult');

function showResult(text, ok) {
  flagResult.hidden = false;
  flagResult.textContent = text;
  flagResult.className = 'xss-output ' + (ok ? 'status-ok' : 'status-err');
}

if (flagBtn) {
  flagBtn.addEventListener('click', async () => {
    const submitted = (flagInput.value || '').trim();
    if (!submitted) {
      showResult('Paste the token you captured.', false);
      return;
    }
    try {
      const res = await window.api.submitStoredHtmliFlag(submitted);
      if (res && res.ok) {
        showResult('Correct — flag: ' + res.flag, true);
      } else {
        showResult('Not the token. Keep going.', false);
      }
    } catch (err) {
      showResult('Error: ' + (err && err.message ? err.message : err), false);
    }
  });
}
