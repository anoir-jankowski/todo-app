const STORAGE_KEY = "tasks";

const taskForm = document.getElementById("taskForm");
const taskInput = document.getElementById("taskInput");
const taskList = document.getElementById("taskList");
const taskCounter = document.getElementById("taskCounter");
const emptyState = document.getElementById("emptyState");
const storageWarning = document.getElementById("storageWarning");

let canSaveTasks = true;
const tasks = loadTasks();

function loadTasks() {
  try {
    const savedTasks = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(savedTasks) || !savedTasks.every(isStoredTask)) {
      throw new TypeError("Invalid task list");
    }

    // Earlier versions stored only the task text.
    return savedTasks.map((task) => (
      typeof task === "string" ? { text: task, completed: false } : task
    ));
  } catch {
    // Leave unreadable data in storage so it can still be recovered.
    canSaveTasks = false;
    storageWarning.textContent = "Saved tasks could not be loaded. Changes will only last until you reload.";
    return [];
  }
}

function isStoredTask(task) {
  return typeof task === "string" || (
    task !== null && typeof task === "object" &&
    typeof task.text === "string" && typeof task.completed === "boolean"
  );
}

function saveTasks() {
  if (!canSaveTasks) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    storageWarning.textContent = "";
  } catch {
    storageWarning.textContent = "Changes could not be saved. They may be lost when you reload.";
  }
}

function updateTaskCount() {
  taskCounter.textContent = `Tasks: ${tasks.length}`;
  emptyState.hidden = tasks.length > 0;
}

function createTaskElement(task) {
  const item = document.createElement("li");
  const label = document.createElement("label");
  label.className = "task-label";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.completed;
  checkbox.addEventListener("change", () => {
    task.completed = checkbox.checked;
    saveTasks();
  });

  const text = document.createElement("span");
  text.textContent = task.text;
  label.append(checkbox, text);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-button";
  deleteButton.textContent = "Delete";
  deleteButton.setAttribute("aria-label", `Delete: ${task.text}`);
  deleteButton.addEventListener("click", () => {
    const nextItem = item.nextElementSibling ?? item.previousElementSibling;

    tasks.splice(tasks.indexOf(task), 1);
    item.remove();
    updateTaskCount();
    saveTasks();

    const nextControl = nextItem?.querySelector(".delete-button") ?? taskInput;
    nextControl.focus();
  });

  item.append(label, deleteButton);
  return item;
}

taskInput.addEventListener("input", () => taskInput.setCustomValidity(""));

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = taskInput.value.trim();

  if (!text) {
    taskInput.setCustomValidity("Enter a task.");
    taskInput.reportValidity();
    return;
  }

  const task = { text, completed: false };
  tasks.push(task);
  taskList.append(createTaskElement(task));
  updateTaskCount();
  saveTasks();

  taskForm.reset();
  taskInput.focus();
});

for (const task of tasks) {
  taskList.append(createTaskElement(task));
}
updateTaskCount();
