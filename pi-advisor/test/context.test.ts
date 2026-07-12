import test from "node:test";
import assert from "node:assert/strict";
import {
  advisorMaxTokens,
  buildSnapshot,
  serializeMessage,
} from "../src/context.ts";

test("snapshot orders messages, omits images/thinking, and redacts", () => {
  const snapshot = buildSnapshot("system", [{ role: "user", content: [{ type: "text", text: "token=sk-proj-abcdefghijklmnopqrstuvwxyz" }, { type: "image" }] }, { role: "assistant", content: [{ type: "thinking", thinking: "secret thought" }, { type: "text", text: "answer" }] }], 20_000);
  assert.ok(snapshot.text.indexOf("[USER]") < snapshot.text.indexOf("[ASSISTANT]")); assert.match(snapshot.text, /image omitted/); assert.match(snapshot.text, /thinking omitted/); assert.ok(!snapshot.text.includes("abcdefghijklmnopqrstuvwxyz"));
});
test("small budget marks truncation and keeps newest user", () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({ role: "user", content: `message-${i} ${"x".repeat(1000)}` }));
  const snapshot = buildSnapshot("system", messages, 9000); assert.equal(snapshot.truncated, true); assert.match(snapshot.text, /message-29/); assert.match(snapshot.text, /omitted/);
});

test("snapshot includes and redacts high-priority evidence", () => {
  const snapshot = buildSnapshot(
    "system",
    [
      { role: "user", content: "review finding" },
      {
        role: "custom",
        customType: "advisor-evidence",
        content: "<high-priority-evidence>\n1: token=sk-proj-abcdefghijklmnopqrstuvwxyz\n</high-priority-evidence>",
      },
    ],
    20_000,
  );
  assert.match(snapshot.text, /high-priority-evidence/i);
  assert.doesNotMatch(snapshot.text, /abcdefghijklmnopqrstuvwxyz/);
});

test("small model windows reserve bounded input and output", () => {
  const window = 1000;
  const snapshot = buildSnapshot(
    "system",
    [{ role: "user", content: "x".repeat(20_000) }],
    window,
  );
  assert.ok(snapshot.estimatedTokens + advisorMaxTokens(window) + 256 <= window);
  assert.equal(advisorMaxTokens(window), 250);
});
