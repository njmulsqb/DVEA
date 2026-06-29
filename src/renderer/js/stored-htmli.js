document.getElementById('profileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('displayName').value;
  window.api.openAnalytics(name);
});
