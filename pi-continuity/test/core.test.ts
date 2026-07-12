import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compact,
  candidate,
  isCandidatesFile,
  isMemoryFile,
  type Candidate,
  type Fact,
} from "../src/memory.ts";
import { readJson, updateJson, writeJson } from "../src/storage.ts";
import { registerWorkspace } from "../src/workspace.ts";
import { blocked } from "../src/plan-gate.ts";
import { buildContext } from "../src/context.ts";
import {
  fresh,
  setPlan,
  updateTodo,
  hasRemainingTodos,
  isWork,
  sessionWorkFile,
} from "../src/active-work.ts";
import { validateQuestion } from "../src/questions.ts";
test("session work files are isolated", () => {
  assert.notEqual(sessionWorkFile("session-a"), sessionWorkFile("session-b"));
  assert.equal(sessionWorkFile("../session"), "..%2Fsession.json");
});
test("memory deterministic", () => {
  const c = candidate({
    key: "workflow.test",
    kind: "workflow",
    text: "npm test",
    source: "README",
    confidence: 1,
    action: "add",
  });
  assert.equal(compact([], [c]).facts.length, 1);
});
test("memory persists, compacts, reloads, and reaches child context", async () => {
  const root = await mkdtemp(join(tmpdir(), "continuity-memory-"));
  const parentPath = join(root, "repo");
  const childPath = join(parentPath, "package");
  await mkdir(childPath, { recursive: true });
  const parent = await registerWorkspace(root, parentPath);
  const child = await registerWorkspace(root, childPath);
  assert.equal(child.workspace.parentId, parent.workspace.id);
  const pending = candidate({
    key: "workflow.test",
    kind: "workflow",
    text: "Run npm test",
    source: "README",
    confidence: 1,
    action: "add",
  });
  const candidatePath = join(parent.dir, "candidates.json");
  await writeJson(candidatePath, { schemaVersion: 1, candidates: [pending] });
  const loadedCandidates = await readJson(
    candidatePath,
    { schemaVersion: 1 as const, candidates: [] as Candidate[] },
    isCandidatesFile,
  );
  const compacted = compact([], loadedCandidates.candidates);
  await writeJson(candidatePath, { schemaVersion: 1, candidates: compacted.candidates });
  const memoryPath = join(parent.dir, "memory.json");
  await writeJson(memoryPath, { schemaVersion: 1, facts: compacted.facts });
  const loadedMemory = await readJson(
    memoryPath,
    { schemaVersion: 1 as const, facts: [] as Fact[] },
    isMemoryFile,
  );
  assert.match(
    buildContext(undefined, [], "npm test", 900, loadedMemory.facts),
    /Parent memory workflow\.test: Run npm test/,
  );
  const decidedCandidates = await readJson(
    candidatePath,
    { schemaVersion: 1 as const, candidates: [] as Candidate[] },
    isCandidatesFile,
  );
  assert.equal(decidedCandidates.candidates[0].status, "applied");
  await writeJson(memoryPath, { schemaVersion: 1, facts: [{ bad: true }] });
  const rejectedMemory = await readJson(
    memoryPath,
    { schemaVersion: 1 as const, facts: [] as Fact[] },
    isMemoryFile,
  );
  assert.deepEqual(rejectedMemory.facts, []);
  assert.ok((await readdir(parent.dir)).some((name) => name.startsWith("memory.json.corrupt-")));
});
test("gate fail closed", () => {
  for (const x of ["edit", "write", "bash", "other"])
    assert.equal(blocked(true, x), true);
  for (const x of [
    "read",
    "grep",
    "find",
    "ls",
    "continuity_update",
    "repo_scout",
    "advisor",
  ])
    assert.equal(blocked(true, x), false);
});
test("empty continuity state injects no context", () => {
  assert.equal(buildContext(undefined, [], ""), "");
});
test("context bounded active first", () => {
  const w = fresh("goal");
  assert.ok(buildContext(w, [], "", 20).length <= 80);
});
test("context exposes exact todo IDs and status", () => {
  const w = fresh("goal");
  setPlan(w, ["inspect"]);
  const text = buildContext(w, [], "", 900);
  assert.match(text, /Todo todo_1 \[pending\]: inspect/);
});
test("plan refresh preserves todo progress", () => {
  const w = fresh("goal");
  setPlan(w, ["inspect", "fix"], "1");
  assert.equal(updateTodo(w, "todo_1", "done", "2"), true);
  setPlan(w, ["inspect", "test"], "3");
  assert.equal(w.todos[0].status, "done");
  assert.equal(w.todos[1].status, "pending");
  assert.equal(new Set(w.todos.map((t) => t.id)).size, 2);
  assert.equal(hasRemainingTodos(w), true);
  updateTodo(w, w.todos[1].id, "done", "4");
  assert.equal(hasRemainingTodos(w), false);
});
test("todo current state follows status", () => {
  const w = fresh();
  setPlan(w, ["work"]);
  assert.equal(updateTodo(w, "todo_1", "in_progress"), true);
  assert.equal(w.currentTodoId, "todo_1");
  updateTodo(w, "todo_1", "done");
  assert.equal(w.currentTodoId, undefined);
  assert.equal(updateTodo(w, "missing", "done"), false);
});
test("questions validate", () => {
  assert.throws(() => validateQuestion("q", [{ label: "x" }, { label: "x" }]));
  validateQuestion("q", [{ label: "x" }, { label: "y" }]);
});
test("secret rejected", () =>
  assert.throws(
    () =>
      candidate({
        key: "x",
        kind: "warning",
        text: "api_key=sk-proj-abcdefghijklmnopqrstuvwxyz",
        source: "x",
        confidence: 1,
        action: "add",
      }),
    /possible credential/,
  ));

test("work schema rejects malformed persisted state", () => {
  assert.equal(isWork(fresh("goal")), true);
  assert.equal(isWork({ ...fresh("goal"), schemaVersion: 2 }), false);
  assert.equal(isWork({ ...fresh("goal"), todos: [{ bad: true }] }), false);
});

test("concurrent JSON updates do not lose writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "continuity-update-"));
  const path = join(root, "state.json");
  await Promise.all(
    Array.from({ length: 20 }, (_, value) =>
      updateJson<number[]>(path, [], (items) => [...items, value], Array.isArray),
    ),
  );
  const items = await readJson<number[]>(path, [], Array.isArray);
  assert.equal(items.length, 20);
  assert.equal(new Set(items).size, 20);
});
