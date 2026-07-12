import test from "node:test";
import assert from "node:assert/strict";
import { ADVISOR_PROMPT, capAdvice } from "../src/advisor.ts";

test("advisor prompt fixes structure and review role", () => {
  assert.match(ADVISOR_PROMPT, /## Recommended approach/);
  assert.match(ADVISOR_PROMPT, /do not call tools/);
  assert.match(ADVISOR_PROMPT, /tentative judgments/i);
  assert.match(ADVISOR_PROMPT, /unsupported conclusions/i);
  assert.match(ADVISOR_PROMPT, /what remains unknown/i);
});
test("advice cap is explicit", () => { const value = capAdvice("a\nb\nc", 100, 2); assert.equal(value.truncated, true); assert.match(value.text, /truncated/); });
