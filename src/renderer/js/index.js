"use strict";

// delete todo by its text value
const deleteTodo = (e) => {
  window.todoAPI.deleteTodo(e.target.textContent);
};

// create add todo window button
document.getElementById("createTodoBtn").addEventListener("click", () => {
  window.todoAPI.openAddWindow();
});

// on receive todos
window.todoAPI.onTodos((event, todos) => {
  const todoList = document.getElementById("todoList");

  const todoItems = todos.reduce((html, todo) => {
    html += `<li class="todo-item">${todo}</li>`;
    return html;
  }, "");

  // ⚠️ Stored XSS still lives here (intentionally)
  todoList.innerHTML = todoItems;

  todoList.querySelectorAll(".todo-item").forEach((item) => {
    item.addEventListener("click", deleteTodo);
  });
});
