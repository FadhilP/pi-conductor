import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeFailureMessage } from "../src/redact.ts";

test("Scout failure diagnostics are redacted, flattened, and bounded", () => {
  const secret = `sk-${"x".repeat(40)}`;
  const message = sanitizeFailureMessage(
    `bad\napi_key=${secret}\u0000\u0085\u2028\u2029${"z".repeat(600)}`,
    "Scout failed.",
  );
  assert.ok(message.length <= 500);
  assert.doesNotMatch(message, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
  assert.doesNotMatch(message, new RegExp(secret));
  assert.match(message, /\[possible credential redacted\]/);
  assert.equal(
    sanitizeFailureMessage("authorization: Bearer short-token", "Scout failed."),
    "[possible credential redacted]",
  );
  assert.equal(sanitizeFailureMessage({ private: "value" }, "Scout failed."), "Scout failed.");
});
