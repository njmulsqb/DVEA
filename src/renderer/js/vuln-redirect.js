document.getElementById('redirectForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = document.getElementById('destUrl').value;
  // Intentionally unsafe: no validation
  window.location.href = `dvea://redirect?target=${encodeURIComponent(url)}`;
});
