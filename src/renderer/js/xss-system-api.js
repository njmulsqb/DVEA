// XSS Variation 2: System APIs Exposed via preload
document.getElementById('xssForm2').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = document.getElementById('xssInput2').value;
  // Intentionally vulnerable: direct innerHTML
  document.getElementById('xssOutput2').innerHTML = val;
  // Example: attacker could access system APIs if exposed
  // window.systemAPI.writeFile('hacked.txt', 'XSS achieved!');
  // window.systemAPI.runCommand('open -a Calculator');
});
