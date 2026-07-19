import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registerSearchTools, { boundedSearch, SCOUT_TOOL_MAX_BYTES, workspacePath } from "../extensions/search-tools.ts";

const previousChild = process.env.PI_SCOUT_CHILD;
process.env.PI_SCOUT_CHILD = "1";
test.after(() => {
  if (previousChild === undefined) delete process.env.PI_SCOUT_CHILD;
  else process.env.PI_SCOUT_CHILD = previousChild;
});

test("main registration keeps child-only tools out of the main model", () => {
  const tools = new Map<string, any>();
  registerSearchTools({ registerTool(tool: any) { tools.set(tool.name, tool); } } as any, false);
  assert.deepEqual([...tools.keys()], ["rg", "fd"]);
});

test("search paths cannot escape workspace", () => {
  assert.equal(workspacePath("/workspace", "src"), "src");
  assert.throws(() => workspacePath("/workspace", "../secret"), /within workspace/);
});

test("read override applies the child-local cap", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-scout-read-"));
  const tools = new Map<string, any>();
  registerSearchTools({ registerTool(tool: any) { tools.set(tool.name, tool); } } as any);
  try {
    await writeFile(join(root, "large.txt"), "x".repeat(SCOUT_TOOL_MAX_BYTES * 2));
    const result = await tools.get("read").execute("id", { path: "large.txt" }, undefined, undefined, { cwd: root });
    const text = result.content.find((part: any) => part.type === "text")?.text ?? "";
    assert.ok(Buffer.byteLength(text) <= SCOUT_TOOL_MAX_BYTES);
    assert.match(text, /omitted output/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rg uses argument arrays and reports no matches", async () => {
  const tools = new Map<string, any>();
  const calls: Array<{ command: string; args: string[] }> = [];
  registerSearchTools({
    registerTool(tool: any) { tools.set(tool.name, tool); },
    async exec(command: string, args: string[]) {
      calls.push({ command, args });
      return { stdout: "", stderr: "", code: 1, killed: false };
    },
  } as any);
  const result = await tools.get("rg").execute("id", { pattern: "a;b", path: "." }, undefined, undefined, { cwd: process.cwd() });
  assert.equal(calls[0].command, "rg");
  assert.ok(calls[0].args.includes("a;b"));
  assert.ok(calls[0].args.includes("--line-number"));
  assert.ok(!calls[0].args.includes("--files-with-matches"));
  assert.match(result.content[0].text, /No matches/);
});

test("search_excerpt returns bounded cited context, contains paths, and falls back safely", async () => {
  const tools = new Map<string, any>();
  const calls: Array<{ command: string; args: string[] }> = [];
  registerSearchTools({
    registerTool(tool: any) { tools.set(tool.name, tool); },
    async exec(command: string, args: string[]) {
      calls.push({ command, args });
      if (command === "rg") return { stdout: "", stderr: "ENOENT", code: 127, killed: false };
      return { stdout: "src/a.ts-9-before\nsrc/a.ts:10:needle\nsrc/a.ts-11-after\n", stderr: "", code: 0, killed: false };
    },
  } as any);
  const result = await tools.get("search_excerpt").execute("id", { pattern: "needle", path: "src", glob: "*.ts", context: 1 }, undefined, undefined, { cwd: process.cwd() });
  assert.deepEqual(calls.map((call) => call.command), ["rg", "grep"]);
  assert.ok(calls[0].args.includes("--sort"));
  assert.ok(calls[0].args.includes("path"));
  assert.ok(calls[1].args.includes("--include=*.ts"));
  assert.match(result.content[0].text, /src\/a\.ts:10:needle/);
  assert.equal(result.details.command, "grep");
  await assert.rejects(tools.get("search_excerpt").execute("id", { pattern: "x", path: "../secret" }, undefined, undefined, { cwd: process.cwd() }), /within workspace/);
});

test("bounded search samples citations across files instead of keeping only the head", () => {
  const output = Array.from({ length: 80 }, (_, index) =>
    `src/file-${String(index).padStart(2, "0")}.ts:1:needle ${"x".repeat(500)}`,
  ).join("\n");
  const result = boundedSearch(output);
  assert.ok(Buffer.byteLength(result) <= SCOUT_TOOL_MAX_BYTES);
  assert.match(result, /src\/file-00\.ts:1:/);
  assert.match(result, /src\/file-79\.ts:1:/);
  assert.match(result, /sampled across 80 files/i);
});

test("bounded search keeps context blocks intact while sampling", () => {
  const output = Array.from({ length: 30 }, (_, index) => [
    `src/file-${String(index).padStart(2, "0")}.ts-9-before`,
    `src/file-${String(index).padStart(2, "0")}.ts:10:needle`,
    `src/file-${String(index).padStart(2, "0")}.ts-11-after ${"x".repeat(900)}`,
  ].join("\n")).join("\n--\n");
  const result = boundedSearch(output);
  assert.match(result, /src\/file-29\.ts-9-before\nsrc\/file-29\.ts:10:needle\nsrc\/file-29\.ts-11-after/);
});

test("search_excerpt output is capped and reports omitted results", async () => {
  const tools = new Map<string, any>();
  registerSearchTools({
    registerTool(tool: any) { tools.set(tool.name, tool); },
    async exec() { return { stdout: "a.ts:1:" + "x".repeat(SCOUT_TOOL_MAX_BYTES * 2), stderr: "", code: 0, killed: false }; },
  } as any);
  const result = await tools.get("search_excerpt").execute("id", { pattern: "x" }, undefined, undefined, { cwd: process.cwd() });
  assert.ok(Buffer.byteLength(result.content[0].text) <= SCOUT_TOOL_MAX_BYTES);
  assert.match(result.content[0].text, /matching excerpts omitted/i);
});

test("rg files mode supports staged broad-to-focused discovery", async () => {
  const tools = new Map<string, any>();
  const calls: Array<{ command: string; args: string[] }> = [];
  registerSearchTools({
    registerTool(tool: any) { tools.set(tool.name, tool); },
    async exec(command: string, args: string[]) {
      calls.push({ command, args });
      return { stdout: "src/a.ts\nsrc/b.ts\n", stderr: "", code: 0, killed: false };
    },
  } as any);
  const tool = tools.get("rg");
  const result = await tool.execute("id", { pattern: "session_compact", glob: "*.ts", mode: "files" }, undefined, undefined, { cwd: process.cwd() });
  assert.ok(calls[0].args.includes("--files-with-matches"));
  assert.ok(!calls[0].args.includes("--line-number"));
  assert.deepEqual(result.content[0].text.trimEnd().split(/\r?\n/), ["src/a.ts", "src/b.ts"]);
  assert.match(tool.promptGuidelines.join("\n"), /use mode files to discover matching paths/i);
  assert.match(tool.promptGuidelines.join("\n"), /refine truncated output/i);
});

test("fd tries fdfind then directs model to built-in fallback", async () => {
  const tools = new Map<string, any>();
  const calls: string[] = [];
  registerSearchTools({
    registerTool(tool: any) { tools.set(tool.name, tool); },
    async exec(command: string) {
      calls.push(command);
      throw new Error("ENOENT");
    },
  } as any);
  const result = await tools.get("fd").execute("id", {}, undefined, undefined, { cwd: process.cwd() });
  assert.deepEqual(calls, ["fd", "fdfind"]);
  assert.match(result.content[0].text, /use find instead/);
});
