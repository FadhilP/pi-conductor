import test from "node:test";
import assert from "node:assert/strict";
import {
  extractSessionTitle,
  promptText,
  promptTitle,
} from "../src/prompts.ts";

test("prompt preview", () =>
  assert.equal(
    promptText({ content: [{ type: "text", text: "hello" }, { type: "image" }] }),
    "hello [image]",
  ));

test("prompt title is concise and single-line", () =>
  assert.equal(
    promptTitle({ content: "  Update\n\n session   naming with a title that stays readable in the session picker and footer" }),
    "Update session naming with a title that stays readable in t…",
  ));

test("session title marker is extracted and removed", () => {
  const original = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "done" },
      { type: "text", text: "Finished.\n<!-- pi-session-title: Persistent Session Titles -->" },
    ],
  };
  assert.deepEqual(extractSessionTitle(original), {
    title: "Persistent Session Titles",
    message: {
      ...original,
      content: [original.content[0], { type: "text", text: "Finished." }],
    },
  });
  assert.deepEqual(extractSessionTitle({ role: "assistant", content: [{ type: "text", text: "No marker" }] }), {
    title: undefined,
    message: { role: "assistant", content: [{ type: "text", text: "No marker" }] },
  });
  const trailingText = {
    role: "assistant",
    content: [
      { type: "text", text: "<!-- pi-session-title: Ignore This -->" },
      { type: "text", text: "Actual ending" },
    ],
  };
  assert.deepEqual(extractSessionTitle(trailingText), {
    title: undefined,
    message: trailingText,
  });
});
