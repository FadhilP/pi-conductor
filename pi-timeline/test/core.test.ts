import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import extension from "../extensions/pi-timeline.ts";
import { capture } from "../src/snapshot.ts";
import { restore } from "../src/restore.ts";
import { preflight } from "../src/safety.ts";
import { findRunEntry, isRunEntry } from "../src/run.ts";

const exec = promisify(execFile);

function namingHarness(entries: any[]) {
  const handlers = new Map<string, Function[]>(), names: string[] = [];
  const pi: any = {
    events: { on: () => () => {} },
    on: (name: string, handler: Function) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerCommand() {},
    setSessionName: (name: string) => names.push(name),
  };
  extension(pi);
  const ctx: any = {
    cwd: join(tmpdir(), "pi-timeline-naming-test"),
    hasUI: false,
    sessionManager: {
      getBranch: () => entries,
      getEntries: () => entries,
      getLeafId: () => entries.at(-1)?.id,
      getSessionFile: () => undefined,
      getSessionId: () => "naming-test",
    },
  };
  return { handlers, names, ctx };
}

test("unnamed sessions are named from first prompt after settled turn", async () => {
  const entries = [{
    type: "message",
    id: "user-1",
    message: { role: "user", content: "  Add session naming\nwithout noise  " },
  }];
  const { handlers, names, ctx } = namingHarness(entries);
  await handlers.get("session_start")![0]({}, ctx);
  await handlers.get("agent_settled")![0]({}, ctx);
  assert.deepEqual(names, ["Add session naming without noise"]);
});

test("main model supplies semantic title without exposing marker", async () => {
  const entries = [{
    type: "message",
    id: "user-1",
    message: { role: "user", content: "Can we add session name to the TUI?" },
  }];
  const { handlers, names, ctx } = namingHarness(entries);
  await handlers.get("session_start")![0]({}, ctx);
  const prompt = await handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, ctx);
  assert.match(prompt.systemPrompt, /3-8 word semantic task title/);

  const result = await handlers.get("message_end")![0]({
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Done.\n<!-- pi-session-title: Persistent TUI Session Names -->" }],
    },
  }, ctx);
  assert.deepEqual(names, ["Persistent TUI Session Names"]);
  assert.deepEqual(result.message.content, [{ type: "text", text: "Done." }]);

  await handlers.get("agent_settled")![0]({}, ctx);
  assert.deepEqual(names, ["Persistent TUI Session Names"]);
});

test("manual rename wins while semantic title is pending", async () => {
  const entries = [{
    type: "message",
    id: "user-1",
    message: { role: "user", content: "First prompt" },
  }];
  const { handlers, names, ctx } = namingHarness(entries);
  await handlers.get("session_start")![0]({}, ctx);
  await handlers.get("before_agent_start")![0]({ systemPrompt: "base" }, ctx);
  await handlers.get("session_info_changed")![0]({ name: "Manual title" }, ctx);
  const result = await handlers.get("message_end")![0]({
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Done.\n<!-- pi-session-title: Generated Title -->" }],
    },
  }, ctx);
  assert.deepEqual(names, []);
  assert.deepEqual(result.message.content, [{ type: "text", text: "Done." }]);
});

test("existing or manually cleared session names remain untouched", async () => {
  for (const name of ["Existing name", ""]) {
    const entries = [
      { type: "message", id: "user-1", message: { role: "user", content: "First prompt" } },
      { type: "session_info", id: "name-1", name },
    ];
    const { handlers, names, ctx } = namingHarness(entries);
    await handlers.get("session_start")![0]({}, ctx);
    await handlers.get("agent_settled")![0]({}, ctx);
    assert.deepEqual(names, []);
  }
});

test("run metadata is optional and latest valid entry wins", () => {
  assert.equal(findRunEntry([]), undefined);
  const planner = {
    version: 1 as const,
    runId: "run-1",
    role: "planner" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const executor = {
    ...planner,
    role: "executor" as const,
    parentSessionId: "planner-session",
  };
  assert.equal(isRunEntry(planner), true);
  assert.deepEqual(
    findRunEntry([
      { type: "custom", customType: "pi-conductor-run", data: planner },
      { type: "custom", customType: "other", data: {} },
      { type: "custom", customType: "pi-conductor-run", data: executor },
    ]),
    executor,
  );
});

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "pi-timeline-test-"));
  const git = async (...args: string[]) =>
    (await exec("git", args, { cwd: root, windowsHide: true })).stdout.trim();
  await git("init", "-q");
  await git("config", "user.email", "timeline@test.local");
  await git("config", "user.name", "timeline-test");
  await writeFile(join(root, ".gitignore"), "ignored.log\n");
  await writeFile(join(root, "tracked.txt"), "base\n");
  await git("add", ".gitignore", "tracked.txt");
  await git("commit", "-qm", "base");
  return { root, git };
}

async function deleteRefs(root: string, refs: string[]) {
  for (const ref of refs)
    await exec("git", ["update-ref", "-d", ref], { cwd: root });
}

test("capture completes and restore preserves ignored files", { timeout: 20_000 }, async () => {
  const { root, git } = await repository();
  try {
    await writeFile(join(root, "tracked.txt"), "checkpoint\n");
    await writeFile(join(root, "ordinary.txt"), "ordinary\n");
    await writeFile(join(root, "ignored.log"), "ignored-before\n");
    const snapshot = await capture(root, "test-session");
    assert.match(snapshot.worktreeTree, /^[0-9a-f]{40}$/);
    assert.equal(
      (await git("for-each-ref", "--format=%(refname)", "refs/pi-timeline"))
        .split(/\r?\n/)
        .filter(Boolean).length,
      2,
    );

    await writeFile(join(root, "tracked.txt"), "later\n");
    await rm(join(root, "ordinary.txt"));
    await writeFile(join(root, "ignored.log"), "ignored-later\n");
    await restore(snapshot);

    assert.equal(
      (await readFile(join(root, "tracked.txt"), "utf8")).replace(/\r\n/g, "\n"),
      "checkpoint\n",
    );
    assert.equal(
      (await readFile(join(root, "ordinary.txt"), "utf8")).replace(/\r\n/g, "\n"),
      "ordinary\n",
    );
    assert.equal(await readFile(join(root, "ignored.log"), "utf8"), "ignored-later\n");
    await deleteRefs(root, [snapshot.worktreeRef, snapshot.indexRef]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore validates objects before mutation", async () => {
  const { root } = await repository();
  try {
    const snapshot = await capture(root, "test-session");
    await writeFile(join(root, "tracked.txt"), "safe\n");
    await assert.rejects(
      restore({ ...snapshot, worktreeTree: "not-an-object" }),
      /Invalid checkpoint object ID/,
    );
    assert.equal(await readFile(join(root, "tracked.txt"), "utf8"), "safe\n");
    await deleteRefs(root, [snapshot.worktreeRef, snapshot.indexRef]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preflight refuses common untracked credential files", async () => {
  const { root } = await repository();
  try {
    await writeFile(join(root, ".npmrc"), "//registry.example/:_authToken=secret\n");
    await assert.rejects(preflight(root), /Unsafe untracked path: \.npmrc/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
