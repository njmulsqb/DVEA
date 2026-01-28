document.getElementById('xssForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = document.getElementById('xssInput').value;
  // Intentionally vulnerable: direct innerHTML
  document.getElementById('xssOutput').innerHTML = val;
});
