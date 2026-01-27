'use strict';

const Store = require('electron-store').default;

class DataStore extends Store {
  constructor(settings) {
    super(settings);

    this.clear();
    this.todos = [];
  }

  saveTodos() {
    this.set('todos', this.todos);
    return this;
  }

  getTodos() {
    this.todos = this.get('todos') || [];

    return this;
  }

  addTodo(text) {
    const todo = {
      id: Date.now(),
      text,
      completed: false,
    };
    this.todos = [...this.todos, todo];
    return this.saveTodos();
  }

  deleteTodo(id) {
    const numId = typeof id === 'string' ? Number(id) : id;
    this.todos = this.todos.filter((t) => t.id !== numId);
    return this.saveTodos();
  }

  toggleTodo(id) {
    const numId = typeof id === 'string' ? Number(id) : id;
    this.todos = this.todos.map((t) =>
      t.id === numId ? { ...t, completed: !t.completed } : t
    );
    return this.saveTodos();
  }

  editTodo(id, newText) {
    const numId = typeof id === 'string' ? Number(id) : id;
    this.todos = this.todos.map((t) =>
      t.id === numId ? { ...t, text: newText } : t
    );
    return this.saveTodos();
  }
}

module.exports = DataStore;
