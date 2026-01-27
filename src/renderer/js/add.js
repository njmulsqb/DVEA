'use strict';

document.getElementById('todoForm').addEventListener('submit', (evt) => {
  evt.preventDefault();
  const input = evt.target[0];
  window.todoAPI.addTodo(input.value);
  window.close();
});
