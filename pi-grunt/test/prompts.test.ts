import test from "node:test";
import assert from "node:assert/strict";
import { WORKER_PROMPT } from "../src/prompts.ts";

test("worker prompt defines isolation and completion contract", () => {
  assert.match(WORKER_PROMPT, /isolated temporary Git worktree/i);
  assert.match(WORKER_PROMPT, /Do not commit/);
  assert.match(WORKER_PROMPT, /Status: completed/);
  assert.match(WORKER_PROMPT, /Status: blocked/);
});
