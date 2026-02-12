document.getElementById('xssForm2').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = document.getElementById('xssInput2').value;
  document.getElementById('xssOutput2').innerHTML = val;
});
