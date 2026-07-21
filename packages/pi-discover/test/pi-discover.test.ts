import test from "node:test";
import assert from "node:assert/strict";
import discover, { keywordRankTools, rankInactiveTools } from "../extensions/pi-discover.ts";

class Bus {
  handlers = new Map<string, ((value: any) => void)[]>();
  on(name: string, handler: (value: any) => void) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
  }
  emit(name: string, value: any) {
    for (const handler of this.handlers.get(name) ?? []) handler(value);
  }
}

function setup() {
  const tools = new Map<string, any>();
  const events = new Bus();
  const active = ["read", "rg", "fd", "search_tools"];
  let setActiveCalls = 0;
  const pi: any = {
    events,
    registerTool: (tool: any) => tools.set(tool.name, tool),
    getActiveTools: () => active,
    getAllTools: () => [
      { name: "read", description: "Read files" },
      { name: "rg", description: "Search repository content" },
      { name: "fd", description: "Find paths" },
      { name: "search_tools", description: "Find inactive tools" },
      { name: "git_history", description: "Search commit history and changes" },
      { name: "web_lookup", description: "Search public web pages" },
      { name: "shell", description: "Run shell commands" },
    ],
    setActiveTools: () => { setActiveCalls++; },
  };
  discover(pi);
  return { events, tools, getSetActiveCalls: () => setActiveCalls };
}

test("host entrypoint registers only rg, fd, and search_tools", () => {
  const { tools } = setup();
  assert.deepEqual([...tools.keys()], ["rg", "fd", "search_tools"]);
});

test("keyword ranking is deterministic and excludes active search tool", () => {
  const tools = [
    { name: "beta_search", description: "web documents" },
    { name: "alpha_search", description: "web documents" },
    { name: "unrelated", description: "nothing" },
  ];
  assert.deepEqual(keywordRankTools(tools, "search web", 3).map((tool) => tool.name), ["alpha_search", "beta_search"]);
  assert.deepEqual(rankInactiveTools([...tools, { name: "search_tools", description: "web search" }], ["beta_search"], "web", 3).map((tool) => tool.name), ["alpha_search"]);
});

test("search_tools uses exactly one synchronous capability and activates eligible matches", async () => {
  const { events, tools, getSetActiveCalls } = setup();
  const selected: string[][] = [];
  events.on("pylon:tool-discovery", (request) => request.respond({
    eligible: () => ["git_history"],
    select: (names: string[]) => { selected.push(names); return { selected: names }; },
    reset: () => ({ reset: true }),
  }));
  const result = await tools.get("search_tools").execute("id", { query: "search history" }, undefined, undefined, {});
  assert.deepEqual(selected, [["git_history"]]);
  assert.equal(getSetActiveCalls(), 0);
  assert.match(result.content[0].text, /next model turn/i);
  assert.deepEqual(result.details.matches, ["git_history"]);
});

test("search_tools does not change tools when Pylon coordination is absent", async () => {
  const { tools, getSetActiveCalls } = setup();
  const result = await tools.get("search_tools").execute("id", { query: "web" }, undefined, undefined, {});
  assert.equal(getSetActiveCalls(), 0);
  assert.match(result.content[0].text, /coordination is unavailable/i);
});

test("selection failures are reported without claiming activation", async () => {
  const { events, tools } = setup();
  events.on("pylon:tool-discovery", (request) => request.respond({
    eligible: () => ["git_history"],
    select: () => ({ error: "forced failure" }),
    reset: () => ({ selected: [] }),
  }));
  const result = await tools.get("search_tools").execute("id", { query: "history" }, undefined, undefined, {});
  assert.match(result.content[0].text, /activation failed/i);
  assert.equal(result.details.failureCode, "selection_failed");
});

test("reset delegates to the discovery capability", async () => {
  const { events, tools } = setup();
  let resets = 0;
  events.on("pylon:tool-discovery", (request) => request.respond({
    eligible: () => [], select: () => undefined, reset: () => { resets++; return { reset: true }; },
  }));
  const result = await tools.get("search_tools").execute("id", { action: "reset" }, undefined, undefined, {});
  assert.equal(resets, 1);
  assert.match(result.content[0].text, /reset/i);
});
