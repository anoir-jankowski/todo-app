const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { createServer } = require("node:http");
const { join } = require("node:path");
const { after, before, test } = require("node:test");
const { chromium } = require("playwright");

const appFiles = {
  "/todo-app/": ["index.html", "text/html"],
  "/todo-app/script.js": ["script.js", "text/javascript"],
  "/todo-app/style.css": ["style.css", "text/css"],
};

let browser;
let server;
let appUrl;

before(async () => {
  browser = await chromium.launch({ executablePath: process.env.TODO_TEST_CHROMIUM });
  server = createServer(async (request, response) => {
    const file = appFiles[request.url];
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    const [filename, contentType] = file;
    const contents = await readFile(join(__dirname, "..", "todo-app", filename));
    response.writeHead(200, { "Content-Type": `${contentType}; charset=utf-8` }).end(contents);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  appUrl = `http://127.0.0.1:${server.address().port}/todo-app/`;
});

after(async () => {
  await browser?.close();
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function openApp(t, setup) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], "The page should run without JavaScript errors");
  });

  if (setup) await page.addInitScript(setup);
  await page.goto(appUrl);
  return page;
}

test("adds, completes, reopens and deletes tasks across reloads", async (t) => {
  const page = await openApp(t);
  const input = page.getByRole("textbox", { name: "New task" });
  const add = page.getByRole("button", { name: "Add task" });
  const checkbox = page.getByRole("checkbox", { name: "Read chapter" });
  const taskText = page.getByText("Read chapter", { exact: true });
  const counter = page.locator("#taskCounter");

  assert.equal(await counter.textContent(), "Tasks: 0");
  assert.equal(await page.getByText("No tasks yet.").isVisible(), true);
  await add.click();
  await input.fill("   ");
  await input.press("Enter");
  assert.equal(await page.getByRole("listitem").count(), 0);

  await input.fill("  Read chapter  ");
  await input.press("Enter");
  assert.equal(await input.inputValue(), "");
  assert.equal(await input.evaluate((field) => field === document.activeElement), true);
  await input.fill("Write summary");
  await add.click();
  assert.equal(await counter.textContent(), "Tasks: 2");
  assert.equal(await page.getByText("No tasks yet.").isVisible(), false);

  await taskText.click();
  assert.equal(await checkbox.isChecked(), true);
  assert.equal(await taskText.evaluate((span) => getComputedStyle(span).textDecorationLine), "line-through");
  await page.reload();
  assert.equal(await checkbox.isChecked(), true);
  assert.equal(await page.getByRole("checkbox", { name: "Write summary" }).isChecked(), false);
  assert.equal(await counter.textContent(), "Tasks: 2");

  await checkbox.press("Space");
  assert.equal(await checkbox.isChecked(), false);
  assert.equal(await taskText.evaluate((span) => getComputedStyle(span).textDecorationLine), "none");
  await page.reload();
  assert.equal(await checkbox.isChecked(), false);

  await page.getByRole("button", { name: "Delete: Read chapter" }).press("Enter");
  const remainingDelete = page.getByRole("button", { name: "Delete: Write summary" });
  assert.equal(await remainingDelete.evaluate((button) => button === document.activeElement), true);
  await page.reload();
  assert.equal(await page.getByRole("checkbox").count(), 1);
  assert.equal(await checkbox.count(), 0);
  await remainingDelete.click();
  assert.equal(await input.evaluate((field) => field === document.activeElement), true);
  await page.reload();
  assert.equal(await page.getByRole("listitem").count(), 0);
  assert.equal(await counter.textContent(), "Tasks: 0");
  assert.equal(await page.getByText("No tasks yet.").isVisible(), true);
});

test("loads older text-only tasks and saves matching texts as separate tasks", async (t) => {
  const page = await openApp(t, () => {
    if (localStorage.getItem("tasks") === null) {
      localStorage.setItem("tasks", JSON.stringify(["Read chapter", "Read chapter"]));
    }
  });
  const checkboxes = page.getByRole("checkbox", { name: "Read chapter" });
  assert.equal(await checkboxes.count(), 2);
  assert.equal(await checkboxes.first().isChecked(), false);
  assert.equal(await checkboxes.last().isChecked(), false);
  await checkboxes.last().check();
  await page.reload();
  assert.equal(await checkboxes.first().isChecked(), false);
  assert.equal(await checkboxes.last().isChecked(), true);

  await page.getByRole("button", { name: "Delete: Read chapter" }).first().click();
  await page.reload();
  assert.equal(await checkboxes.count(), 1);
  assert.equal(await checkboxes.isChecked(), true);
});

test("keeps unreadable stored data and warns that changes are temporary", async (t) => {
  const page = await openApp(t, () => localStorage.setItem("tasks", "{broken"));
  const warning = page.locator("#storageWarning");
  assert.match(await warning.textContent(), /could not be loaded/);

  await page.getByRole("textbox", { name: "New task" }).fill("Temporary task");
  await page.getByRole("button", { name: "Add task" }).click();
  assert.equal(await page.getByRole("checkbox", { name: "Temporary task" }).count(), 1);
  assert.equal(await page.evaluate(() => localStorage.getItem("tasks")), "{broken");
});

test("warns after a failed save and persists current tasks when storage recovers", async (t) => {
  const page = await openApp(t, () => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (window.blockTaskWrites && key === "tasks") {
        throw new DOMException("Storage is full", "QuotaExceededError");
      }
      setItem.call(this, key, value);
    };
  });
  await page.evaluate(() => { window.blockTaskWrites = true; });
  await page.getByRole("textbox", { name: "New task" }).fill("Read chapter");
  await page.getByRole("button", { name: "Add task" }).click();
  const warning = page.locator("#storageWarning");
  assert.match(await warning.textContent(), /could not be saved/);

  await page.evaluate(() => { window.blockTaskWrites = false; });
  const checkbox = page.getByRole("checkbox", { name: "Read chapter" });
  await checkbox.check();
  assert.equal(await warning.textContent(), "");
  await page.reload();
  assert.equal(await checkbox.isChecked(), true);
});
