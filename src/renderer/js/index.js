'use strict';

const deleteTodo = (e) => {
  window.todoAPI.deleteTodo(e.target.textContent);
};
document.getElementById('createTodoBtn').addEventListener('click', () => {
  window.todoAPI.openAddWindow();
});
window.todoAPI.onTodos((event, todos) => {
  const todoList = document.getElementById('todoList');

  const todoItems = todos.reduce((html, todo) => {
    html += `<li class="todo-item">${todo}</li>`;
    return html;
  }, '');

  // ⚠️ Stored XSS still lives here (intentionally)
  todoList.innerHTML = todoItems;

  todoList.querySelectorAll('.todo-item').forEach((item) => {
    item.addEventListener('click', deleteTodo);
  });
});
