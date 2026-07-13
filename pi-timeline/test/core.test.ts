import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { capture } from "../src/snapshot.ts";
import { restore } from "../src/restore.ts";
import { preflight } from "../src/safety.ts";
import { findRunEntry, isRunEntry } from "../src/run.ts";

const exec = promisify(execFile);

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
