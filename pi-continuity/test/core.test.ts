import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  compact,
  candidate,
  factsForOwners,
  normalizeCandidatesFile,
  normalizeMemoryFile,
  isMemoryFile,
  MEMORY_SCHEMA_VERSION,
  type PendingCandidate,
  type Fact,
} from "../src/memory.ts";
import { readJson, readVersionedJson, updateJson, writeJson } from "../src/storage.ts";
import { captureEvidence, classifyProjectFacts, projectContext } from "../src/worktree.ts";
import { blocked } from "../src/plan-gate.ts";
import { buildContext, shortlistFacts } from "../src/context.ts";
import {
  fresh,
  setPlan,
  updateTodo,
  hasRemainingTodos,
  isWork,
  sessionWorkFile,
} from "../src/active-work.ts";
import { validateQuestion } from "../src/questions.ts";
import {
  defaultConfig,
  loadConfig,
  parseModelRef,
  saveConfig,
} from "../src/config.ts";
import { isRunEntry, runTimelineId } from "../src/run.ts";
const exec = promisify(execFile);
test("model profiles parse, persist, and reset to defaults", async () => {
  assert.deepEqual(parseModelRef("provider/model:high"), {
    provider: "provider",
    id: "model",
    thinking: "high",
  });
  assert.deepEqual(parseModelRef("provider/model:version"), {
    provider: "provider",
    id: "model:version",
  });
  const root = await mkdtemp(join(tmpdir(), "continuity-config-"));
  const path = join(root, "config.json");
  await saveConfig(
    {
      version: 1,
      planner: { model: "provider/planner", thinking: "high" },
      executor: { model: "provider/executor" },
    },
    path,
  );
  assert.deepEqual(await loadConfig(path), {
    version: 1,
    planner: { model: "provider/planner", thinking: "high" },
    executor: { model: "provider/executor" },
  });
  assert.deepEqual(defaultConfig(), { version: 1 });
});

test("run metadata validates backward-compatible timeline lineage", () => {
  const legacy = {
    version: 1 as const,
    runId: "run",
    role: "planner" as const,
    createdAt: new Date().toISOString(),
  };
  assert.equal(isRunEntry(legacy), true);
  assert.equal(runTimelineId(legacy), "run");
  assert.equal(isRunEntry({ ...legacy, runId: "run-2", timelineId: "run" }), true);
  assert.equal(runTimelineId({ ...legacy, runId: "run-2", timelineId: "run" }), "run");
  assert.equal(isRunEntry({ ...legacy, timelineId: "" }), false);
  assert.equal(
    isRunEntry({ version: 1, runId: "run", role: "invalid", createdAt: "x" }),
    false,
  );
});

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
  const result = compact([], [c]);
  assert.equal(result.facts.length, 1);
  assert.deepEqual(result.candidates, []);
});
test("V4 candidate queue drops malformed records without losing valid records", () => {
  const pending = candidate({ text: "npm test" });
  const normalized = normalizeCandidatesFile({
    schemaVersion: MEMORY_SCHEMA_VERSION,
    candidates: [pending, { ...pending, id: "broken", text: "" }],
  });
  assert.deepEqual(normalized?.candidates, [pending]);
  assert.equal(normalizeCandidatesFile({ schemaVersion: 1, candidates: [pending] }), undefined);
});
test("memory is keyed and retention favors preferences and warnings", () => {
  const first = candidate({
      key: "workflow.test", kind: "workflow", text: "npm test", source: "README",
      confidence: 1, action: "add",
    }),
    second = candidate({
      key: "workflow.test", kind: "workflow", text: "npm run test", source: "package.json",
      confidence: 1, action: "add",
    });
  const keyed = compact([], [first, second]);
  assert.equal(keyed.facts.length, 1);
  assert.equal(keyed.facts[0].text, "npm run test");

  const facts: Fact[] = [
    { key: "workflow.build", kind: "workflow", text: "Build", source: "scripts", confidence: 1, updatedAt: "2026-03-01" },
    { key: "warning.deploy", kind: "warning", text: "Check deploy", source: "README", confidence: 0.5, updatedAt: "2026-02-01" },
    { key: "preference.style", kind: "preference", text: "Keep output terse", source: "user", confidence: 0.5, updatedAt: "2026-01-01" },
  ];
  assert.deepEqual(
    compact(facts, [], 2).facts.map((fact) => fact.key),
    ["preference.style", "warning.deploy"],
  );
});
test("V4 memory keeps valid records and resets unsupported files", async () => {
  const root = await mkdtemp(join(tmpdir(), "continuity-memory-"));
  const path = join(root, "memory.json");
  const valid = compact([], [candidate({ text: "Run npm test" })]).facts[0]!;
  await writeJson(path, { schemaVersion: MEMORY_SCHEMA_VERSION, facts: [valid, { bad: true }] });
  const loaded = normalizeMemoryFile(await readJson(
    path, { schemaVersion: MEMORY_SCHEMA_VERSION, facts: [] as Fact[] }, isMemoryFile,
  ));
  assert.deepEqual(loaded?.facts, [valid]);
  await writeJson(path, { schemaVersion: 1, facts: [] });
  const reset = await readVersionedJson(path, { schemaVersion: MEMORY_SCHEMA_VERSION, facts: [] as Fact[] }, isMemoryFile);
  assert.deepEqual(reset.facts, []);
  assert.ok((await readdir(root)).some((name) => name.startsWith("memory.json.reset-unsupported-")));
});

test("text-only add defaults and replace/remove require keys", () => {
  const added = candidate({ text: "Use npm test" });
  assert.equal(added.kind, "workflow");
  assert.equal(added.confidence, 0.5);
  assert.equal(added.scope, "project");
  assert.match(added.key, /^memory\./);
  assert.throws(() => candidate({ action: "replace", text: "x" }), /requires a key/);
  assert.throws(() => candidate({ action: "replace", key: "x" }), /requires text/);
  assert.throws(() => candidate({ action: "remove" }), /requires a key/);
  assert.throws(() => candidate({ action: "remove", key: "x" }), /nonempty source/);
  const removal = candidate({ action: "remove", key: "x", source: "repository contradicted it" }, {
    owner: "project", captureCommit: "a".repeat(40),
    evidencePaths: [{ path: "package.json", sha256: "b".repeat(64) }],
  });
  assert.equal(removal.source, "repository contradicted it");
  assert.equal(removal.evidencePaths?.[0]?.path, "package.json");
  assert.throws(() => candidate({ action: "invalid" as any, text: "x" }), /invalid memory action/);
  assert.throws(() => candidate({ text: "x".repeat(1001) }), /field limits/);
});

test("compaction keeps 30 global user facts and 30 facts per project", () => {
  const sameKey = compact([], [
    candidate({ key: "same", text: "user", scope: "user" }, { owner: "default" }),
    candidate({ key: "same", text: "project" }, { owner: "project-a" }),
  ]).facts;
  assert.equal(sameKey.length, 2);
  const afterProjectRemove = compact(sameKey, [candidate({
    action: "remove", key: "same", source: "project evidence contradicted it",
  }, { owner: "project-a" })]).facts;
  assert.deepEqual(afterProjectRemove.map((fact) => `${fact.scope}/${fact.key}`), ["user/same"]);
  const candidates = [
    ...Array.from({ length: 31 }, (_, i) => candidate({ key: `user-${i}`, text: `user ${i}`, scope: "user" }, { owner: "default" })),
    ...Array.from({ length: 31 }, (_, i) => candidate({ key: `a-${i}`, text: `project a ${i}` }, { owner: "project-a" })),
    ...Array.from({ length: 31 }, (_, i) => candidate({ key: `b-${i}`, text: `project b ${i}` }, { owner: "project-b" })),
  ];
  const facts = compact([], candidates).facts;
  assert.equal(facts.filter((fact) => fact.scope === "user").length, 30);
  assert.equal(facts.filter((fact) => fact.owner === "project-a").length, 30);
  assert.equal(facts.filter((fact) => fact.owner === "project-b").length, 30);
});

test("memory visibility includes global user facts and isolates projects", () => {
  const facts = compact([], [
    candidate({ key: "user", text: "user fact", scope: "user" }, { owner: "default" }),
    candidate({ key: "project-a", text: "first project", scope: "project" }, { owner: "project-a" }),
    candidate({ key: "project-b", text: "second project", scope: "project" }, { owner: "project-b" }),
  ]).facts;
  assert.deepEqual(
    factsForOwners(facts, "project-a").map((fact) => fact.key).sort(),
    ["project-a", "user"],
  );
});
test("non-Git projects use the supplied canonical workspace identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "continuity-non-git-"));
  assert.deepEqual(await projectContext(root, "workspace-id"), { owner: "workspace-id" });
});

test("linked worktrees share project identity while divergence is suspect, not deleted", async () => {
  const root = await mkdtemp(join(tmpdir(), "continuity-git-"));
  const base = join(root, "base"), linked = join(root, "linked");
  await exec("git", ["init", "-q", base]);
  await exec("git", ["-C", base, "config", "user.email", "test@example.invalid"]);
  await exec("git", ["-C", base, "config", "user.name", "test"]);
  await writeFile(join(base, "file.txt"), "base\n");
  await exec("git", ["-C", base, "add", "."]);
  await exec("git", ["-C", base, "commit", "-qm", "base"]);
  await exec("git", ["-C", base, "worktree", "add", "-q", "-b", "linked", linked]);
  const main = await projectContext(base, "base"), other = await projectContext(linked, "linked");
  assert.equal(main.owner, other.owner);
  const evidencePaths = await captureEvidence(base, ["file.txt"]);
  const fact = compact([], [candidate({ key: "workflow.test", text: "Run tests", scope: "project" }, {
    owner: main.owner, captureCommit: main.captureCommit, evidencePaths,
  })]).facts;
  assert.equal((await classifyProjectFacts(linked, fact))[0]!.status, "active");
  await exec("git", ["-C", linked, "checkout", "--orphan", "rebased"]);
  await writeFile(join(linked, "other.txt"), "unrelated\n");
  await exec("git", ["-C", linked, "add", "."]);
  await exec("git", ["-C", linked, "commit", "-qm", "unrelated"]);
  assert.equal((await classifyProjectFacts(linked, fact))[0]!.status, "suspect");
  assert.equal((await classifyProjectFacts(linked, [{ ...fact[0]!, captureCommit: "0".repeat(40) }]))[0]!.status, "unverifiable");
  assert.equal(fact.length, 1, "suspect facts remain persisted");
  await exec("git", ["-C", linked, "checkout", "-q", "linked"]);
  assert.equal((await classifyProjectFacts(linked, fact))[0]!.status, "active", "returning to captured history revives fact");
});

test("evidence is hashed server-side and changed evidence is suspect", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "continuity-evidence-"));
  await writeFile(join(root, "guide.txt"), "first\n");
  const evidencePaths = await captureEvidence(root, ["guide.txt"]);
  assert.match(evidencePaths[0]!.sha256, /^[0-9a-f]{64}$/);
  const fact: Fact = {
    key: "guide", kind: "workflow", text: "follow guide", source: "guide", confidence: 1,
    updatedAt: new Date().toISOString(), scope: "project", owner: "project", evidencePaths,
  };
  assert.equal((await classifyProjectFacts(root, [fact]))[0]!.status, "active");
  await writeFile(join(root, "guide.txt"), "changed\n");
  assert.equal((await classifyProjectFacts(root, [fact]))[0]!.status, "suspect");
  await rm(join(root, "guide.txt"));
  assert.equal((await classifyProjectFacts(root, [fact]))[0]!.status, "suspect");
  assert.equal((await classifyProjectFacts(root, [{ ...fact, evidencePaths: undefined }]))[0]!.status, "unchecked");
  await assert.rejects(captureEvidence(root, ["../guide.txt"]), /invalid|escape/);
  await writeFile(join(root, ".env"), "secret\n");
  await assert.rejects(captureEvidence(root, [".env"]), /sensitive/);
  const outside = join(root, "outside"), linked = join(root, "linked");
  await mkdir(outside);
  await writeFile(join(outside, "guide.txt"), "outside\n");
  try {
    await symlink(outside, linked, "junction");
    await assert.rejects(captureEvidence(root, ["linked/guide.txt"]), /symlink/);
  } catch (error: any) {
    if (error?.code !== "EPERM") throw error;
    t.diagnostic("symlink creation unavailable; escape rejection covered by traversal test");
  }
});

test("retention evicts suspect facts before active facts", () => {
  const facts = Array.from({ length: 31 }, (_, index) => compact([], [candidate({
    key: `fact-${index}`, text: `fact ${index}`, source: "test",
  })]).facts[0]!);
  const statuses = new Map(facts.map((fact, index) => [
    `${fact.scope}\0${fact.owner}\0${fact.key}`, index === 0 ? "suspect" as const : "active" as const,
  ]));
  assert.equal(compact(facts, [], 30, statuses).facts.some((fact) => fact.key === "fact-0"), false);
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
test("context includes preferences but rejects weak one-word memory matches", () => {
  const facts: Fact[] = [
    { key: "preference.style", kind: "preference", text: "Keep output terse", source: "user", confidence: 1, updatedAt: "2026-01-01" },
    { key: "workflow.release", kind: "workflow", text: "Run release check", source: "README", confidence: 1, updatedAt: "2026-01-01" },
  ];
  const text = buildContext(undefined, facts, "discuss release migrations");
  assert.match(text, /Memory preference\.style: Keep output terse/);
  assert.doesNotMatch(text, /workflow\.release/);
});
test("one preference is reserved without crowding out relevant facts", () => {
  const preferences: Fact[] = Array.from({ length: 10 }, (_, index) => ({
    key: `preference.style${index}`, kind: "preference", text: `Style choice ${index}`,
    source: "user", confidence: 1, updatedAt: `2026-01-${String(index + 1).padStart(2, "0")}`,
  }));
  const facts: Fact[] = [
    ...preferences,
    { key: "workflow.release", kind: "workflow", text: "Run release check", source: "README", confidence: 1, updatedAt: "2026-01-01" },
    { key: "warning.deploy", kind: "warning", text: "Check deploy warning", source: "README", confidence: 1, updatedAt: "2026-01-01" },
  ];
  const selected = shortlistFacts(facts, "release check deploy warning");
  assert.deepEqual(selected.map((fact) => fact.key), ["preference.style9", "warning.deploy", "workflow.release"]);
});
test("context accepts two-term and exact-identifier memory matches", () => {
  const facts: Fact[] = [
    { key: "workflow.release", kind: "workflow", text: "Run release check", source: "README", confidence: 1, updatedAt: "2026-01-01" },
    { key: "architecture.web_scout", kind: "architecture", text: "Use web_scout for public research", source: "source", confidence: 1, updatedAt: "2026-01-01" },
  ];
  assert.match(buildContext(undefined, facts, "release check"), /workflow\.release/);
  assert.match(buildContext(undefined, facts, "call web_scout"), /architecture\.web_scout/);
});
test("context normalizes inflections and conservative workflow synonyms", () => {
  const release: Fact = {
    key: "workflow.release", kind: "workflow", text: "Run test before release",
    source: "README", confidence: 1, updatedAt: "2026-01-01",
  };
  const tests: Fact = {
    key: "workflow.tests", kind: "workflow", text: "Run test suite",
    source: "README", confidence: 1, updatedAt: "2026-01-01",
  };
  assert.match(buildContext(undefined, [release], "Verify package before shipping"), /workflow\.release/);
  assert.match(buildContext(undefined, [tests], "run tests"), /workflow\.tests/);
  assert.equal(buildContext(undefined, [tests], "check formatting"), "");
});
test("context reserves room for active memory and suspect metadata without stale text", () => {
  const active: Fact = {
    key: "workflow.release", kind: "workflow", text: "Run release check", source: "README",
    confidence: 1, updatedAt: "2026-01-01",
  };
  const text = buildContext(undefined, [active], "release check", 100, [], [{
    key: "workflow.old", status: "suspect", reason: "capture is not an ancestor of HEAD",
  }]);
  assert.match(text, /Memory workflow\.release: Run release check/);
  assert.match(text, /Memory workflow\.old \[suspect\]/);
  assert.match(text, /ancestry or age alone never justifies deletion/);
  assert.doesNotMatch(text, /obsolete command text/);
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
  assert.equal(
    isWork({
      ...fresh("goal"),
      runId: "run",
      timelineId: "timeline",
      baseModel: { provider: "provider", id: "model" },
      baseThinking: "high",
    }),
    true,
  );
  assert.equal(isWork({ ...fresh("goal"), runId: "" }), false);
  assert.equal(isWork({ ...fresh("goal"), timelineId: "" }), false);
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
