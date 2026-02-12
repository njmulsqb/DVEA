document.getElementById('rce-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const code = document.getElementById('code-input').value;
  window.systemapi.executeCode(code).then(result => {
    document.getElementById('result').innerText = result;
  }).catch(err => {
    document.getElementById('result').innerText = 'Error: ' + err;
  });
});
