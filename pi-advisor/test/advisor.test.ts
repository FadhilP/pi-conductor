import test from "node:test";
import assert from "node:assert/strict";
import {
  ADVISOR_MAX_CALLS,
  ADVISOR_MAX_OUTPUT_TOKENS,
  ADVISOR_PROMPT,
  capAdvice,
} from "../src/advisor.ts";

test("advisor limits calls and output", () => {
  assert.equal(ADVISOR_MAX_CALLS, 3);
  assert.equal(ADVISOR_MAX_OUTPUT_TOKENS, 8_000);
});

test("advisor prompt fixes structure and review role", () => {
  assert.match(ADVISOR_PROMPT, /## Recommended approach/);
  assert.match(ADVISOR_PROMPT, /do not call tools/);
  assert.match(ADVISOR_PROMPT, /tentative judgments/i);
  assert.match(ADVISOR_PROMPT, /unsupported conclusions/i);
  assert.match(ADVISOR_PROMPT, /what remains unknown/i);
});
test("advice cap is explicit", () => {
  const value = capAdvice("a".repeat(33_000));
  assert.equal(value.truncated, true);
  assert.match(value.text, /estimated 8000 tokens/);
  assert.ok(Buffer.byteLength(value.text, "utf8") <= ADVISOR_MAX_OUTPUT_TOKENS * 4);
});
