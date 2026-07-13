import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectChecks } from "../src/detect.ts";

const npmCommand = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
const npmArgs = (name: string) => process.platform === "win32"
  ? ["/d", "/s", "/c", "npm", "run", name]
  : ["run", name];

test("detects only declared npm verification scripts in stable order", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-verify-npm-"));
  await writeFile(join(root, "package.json"), JSON.stringify({
    scripts: { test: "node --test", check: "tsc --noEmit", start: "node app" },
  }));
  const detected = await detectChecks(root);
  assert.deepEqual(detected.checks, [
    { id: "npm:check", label: "npm check", command: npmCommand, args: npmArgs("check"), cwd: root },
    { id: "npm:test", label: "npm test", command: npmCommand, args: npmArgs("test"), cwd: root },
  ]);
  assert.deepEqual(detected.omitted, []);
});

test("detects configured Python, Rust, Go, and Make checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-verify-mixed-"));
  await writeFile(join(root, "pyproject.toml"), "[tool.ruff]\n[tool.pytest.ini_options]\n");
  await writeFile(join(root, "Cargo.toml"), "[package]\nname='x'\n");
  await writeFile(join(root, "go.mod"), "module example.test/x\n");
  await writeFile(join(root, "Makefile"), "check:\n\t@true\nrandom:\n\t@true\n");
  const labels = (await detectChecks(root)).checks.map((check) => check.label);
  assert.deepEqual(labels, ["ruff", "pytest", "cargo test", "go test", "make check"]);
});

test("discovers immediate child packages and reports six-check cap", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-verify-monorepo-"));
  for (const name of ["a", "b", "c", "d"]) {
    const child = join(root, name);
    await mkdir(child);
    await writeFile(join(child, "package.json"), JSON.stringify({ scripts: { check: "true", test: "true" } }));
  }
  const detected = await detectChecks(root);
  assert.deepEqual(detected.checks.map((check) => check.id), [
    "a/npm:check", "a/npm:test", "b/npm:check", "b/npm:test", "c/npm:check", "c/npm:test",
  ]);
  assert.deepEqual(detected.omitted.map((check) => check.id), ["d/npm:check", "d/npm:test"]);
  assert.equal(detected.available.length, 8);
});
