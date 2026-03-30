document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('savefile-form');
  const status = document.getElementById('status');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    const path = document.getElementById('filepath').value;
    const content = document.getElementById('filecontent').value;
    try {
      await window.api.saveFile({ path, content });
      status.textContent = 'File saved successfully.';
      status.style.color = 'green';
    } catch (err) {
      status.textContent = 'Error: ' + (err && err.message ? err.message : err);
      status.style.color = 'red';
    }
  });
});
