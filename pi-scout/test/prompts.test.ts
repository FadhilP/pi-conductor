import test from "node:test";
import assert from "node:assert/strict";
import { REPO_SCOUT_PROMPT } from "../src/prompts.ts";

test("repo scout requires bounded cited evidence", () => {
  assert.match(REPO_SCOUT_PROMPT, /path:start-end/);
  assert.match(REPO_SCOUT_PROMPT, /short relevant excerpt/i);
  assert.match(REPO_SCOUT_PROMPT, /under 20 lines/i);
  assert.match(REPO_SCOUT_PROMPT, /Never paste whole files/i);
  assert.match(REPO_SCOUT_PROMPT, /Gaps:/);
  assert.match(REPO_SCOUT_PROMPT, /Prefer rg/);
  assert.match(REPO_SCOUT_PROMPT, /fd for path discovery/);
  assert.match(REPO_SCOUT_PROMPT, /fall back to grep\/find/);
  assert.match(REPO_SCOUT_PROMPT, /scout_checkpoint/);
  assert.match(REPO_SCOUT_PROMPT, /never include raw reads/i);
  assert.match(REPO_SCOUT_PROMPT, /do not assign severity/i);
  assert.match(REPO_SCOUT_PROMPT, /without concrete search criteria/i);
  assert.match(REPO_SCOUT_PROMPT, /main model evaluates evidence/i);
});
