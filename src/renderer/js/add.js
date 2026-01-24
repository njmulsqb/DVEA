"use strict";

document.getElementById("todoForm").addEventListener("submit", (evt) => {
  // prevent default refresh functionality of forms
  evt.preventDefault();

  // input on the form
  const input = evt.target[0];

  // send todo to main process
  window.todoAPI.addTodo(input.value);

  // reset input
  input.value = "";
});
