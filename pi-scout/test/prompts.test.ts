import test from "node:test";
import assert from "node:assert/strict";
import { REPO_SCOUT_PROMPT } from "../src/prompts.ts";

test("repo scout prompt preserves core contracts", () => {
  assert.match(REPO_SCOUT_PROMPT, /path:start-end/);
  assert.match(REPO_SCOUT_PROMPT, /under 20 lines/i);
  assert.match(REPO_SCOUT_PROMPT, /Do not edit/i);
  assert.match(REPO_SCOUT_PROMPT, /do not assign severity/i);
  assert.match(REPO_SCOUT_PROMPT, /batch clearly independent searches/i);
});
