// XSS Variation 1: No Privileged APIs Exposed
document.getElementById('xssForm1').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = document.getElementById('xssInput1').value;
  // Intentionally vulnerable: direct innerHTML
  document.getElementById('xssOutput1').innerHTML = val;
});
