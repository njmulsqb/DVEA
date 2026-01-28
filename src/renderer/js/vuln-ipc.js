document.getElementById('sendIpc').addEventListener('click', () => {
  // Intentionally unsafe: send arbitrary data to main
  window.todoAPI.addTodo('<script>alert(\'IPC Abuse!\')</script>');
  document.getElementById('ipcResult').textContent = 'IPC sent! Check main process.';
});
