
// --- UI State ---
let allTodos = [];
let filter = 'all'; // all | active | completed

function renderTodos() {
  const todoList = document.getElementById('todoList');
  todoList.innerHTML = '';
  let filtered = allTodos;
  if (filter === 'active') filtered = allTodos.filter(t => !t.completed);
  if (filter === 'completed') filtered = allTodos.filter(t => t.completed);

  filtered.forEach((todo) => {
    const li = document.createElement('li');
    li.className = 'todo-item card';
    if (todo.completed) li.classList.add('completed');

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = todo.completed;
    checkbox.className = 'todo-checkbox';
    checkbox.addEventListener('change', () => window.todoAPI.toggleTodo(todo.id));
    li.appendChild(checkbox);

    // Text (vulnerable: use innerHTML)
    const span = document.createElement('span');
    span.className = 'todo-text';
    span.innerHTML = todo.text;
    li.appendChild(span);

    // Edit button
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm btn-link todo-edit';
    editBtn.innerHTML = '✏️';
    editBtn.title = 'Edit';
    editBtn.addEventListener('click', () => editTodoPrompt(todo));
    li.appendChild(editBtn);

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-link text-error todo-delete';
    delBtn.innerHTML = '🗑️';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', () => confirmDelete(todo.id));
    li.appendChild(delBtn);

    todoList.appendChild(li);
  });

  // Update count
  document.getElementById('todoCount').textContent = `${allTodos.filter(t => !t.completed).length} left`;
}

function confirmDelete(id) {
  if (confirm('Delete this todo?')) {
    window.todoAPI.deleteTodo(id);
  }
}

function editTodoPrompt(todo) {
  const newText = prompt('Edit todo:', todo.text);
  if (newText && newText.trim() && newText !== todo.text) {
    window.todoAPI.editTodo(todo.id, newText.trim());
  }
}

// Filter buttons
document.getElementById('filterAll').addEventListener('click', () => { filter = 'all'; renderTodos(); });
document.getElementById('filterActive').addEventListener('click', () => { filter = 'active'; renderTodos(); });
document.getElementById('filterCompleted').addEventListener('click', () => { filter = 'completed'; renderTodos(); });

document.getElementById('createTodoBtn').addEventListener('click', () => {
  window.todoAPI.openAddWindow();
});

window.todoAPI.onTodos((event, todos) => {
  allTodos = todos;
  renderTodos();
});
