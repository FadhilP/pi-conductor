import test from "node:test";
import assert from "node:assert/strict";
import { promptText, promptTitle } from "../src/prompts.ts";

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
