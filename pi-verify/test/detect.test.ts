import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectChecks } from "../src/detect.ts";

test("detects only declared npm verification scripts in stable order", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-verify-npm-"));
  await writeFile(join(root, "package.json"), JSON.stringify({
    scripts: { test: "node --test", check: "tsc --noEmit", start: "node app" },
  }));
  assert.deepEqual(await detectChecks(root), [
    { label: "npm check", command: "npm", args: ["run", "check"] },
    { label: "npm test", command: "npm", args: ["run", "test"] },
  ]);
});

test("detects configured Python, Rust, Go, and Make checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-verify-mixed-"));
  await writeFile(join(root, "pyproject.toml"), "[tool.ruff]\n[tool.pytest.ini_options]\n");
  await writeFile(join(root, "Cargo.toml"), "[package]\nname='x'\n");
  await writeFile(join(root, "go.mod"), "module example.test/x\n");
  await writeFile(join(root, "Makefile"), "check:\n\t@true\nrandom:\n\t@true\n");
  const labels = (await detectChecks(root)).map((check) => check.label);
  assert.deepEqual(labels, ["ruff", "pytest", "cargo test", "go test", "make check"]);
});
