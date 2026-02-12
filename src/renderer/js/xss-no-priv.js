document.getElementById('xssForm1').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = document.getElementById('xssInput1').value;
  document.getElementById('xssOutput1').innerHTML = val;
});
