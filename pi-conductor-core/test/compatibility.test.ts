import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import conductor from "../extensions/pi-conductor-core.ts";
import advisor from "../../pi-advisor/extensions/pi-advisor.ts";
import scout from "../../pi-scout/extensions/pi-scout.ts";
import continuity from "../../pi-continuity/extensions/pi-continuity.ts";

class Bus {
  handlers = new Map<string, Set<(value: unknown) => void>>();
  on(channel: string, handler: (value: unknown) => void) {
    const handlers = this.handlers.get(channel) ?? new Set();
    handlers.add(handler); this.handlers.set(channel, handlers);
    return () => handlers.delete(handler);
  }
  emit(channel: string, value: unknown) {
    for (const handler of this.handlers.get(channel) ?? []) handler(value);
  }
}

test("actual Advisor, Scout, and Continuity adapters coordinate end to end", async () => {
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  const root = await mkdtemp(join(tmpdir(), "conductor-compat-"));
  const cwd = join(root, "repo");
  await mkdir(cwd);
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  try {
    const events = new Bus();
    let active = ["read", "grep", "find", "ls", "edit", "write", "bash"];
    const handlers = new Map<string, Function[]>();
    const commands = new Map<string, any>();
    const pi: any = {
      events,
      getActiveTools: () => [...active],
      setActiveTools: (tools: string[]) => { active = [...tools]; },
      getThinkingLevel: () => "low",
      on: (name: string, handler: Function) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
      registerTool: (tool: any) => { if (!active.includes(tool.name)) active.push(tool.name); },
      registerCommand: (name: string, command: any) => commands.set(name, command),
      registerEntryRenderer: () => {},
      appendEntry: () => {},
      sendUserMessage: () => {},
    };
    conductor(pi); advisor(pi); scout(pi); continuity(pi);
    const ctx: any = {
      cwd,
      hasUI: false,
      mode: "json",
      model: undefined,
      modelRegistry: {
        find: () => undefined,
        hasConfiguredAuth: () => false,
        getAvailable: () => [],
      },
      sessionManager: { getSessionId: () => "compat-session" },
      ui: {
        notify: () => {}, setStatus: () => {}, setWidget: () => {}, confirm: async () => false,
      },
    };
    for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
    assert.ok(active.includes("repo_scout"));
    assert.ok(active.includes("continuity_update"));
    assert.ok(!active.includes("advisor"));
    await commands.get("plan").handler("compatibility", ctx);
    assert.ok(active.includes("read"));
    assert.ok(active.includes("repo_scout"));
    assert.ok(!active.includes("edit"));
    await commands.get("scout").handler("disable", ctx);
    assert.ok(!active.includes("repo_scout"));
    for (const handler of handlers.get("session_shutdown") ?? []) await handler({ reason: "quit" }, ctx);
    assert.equal(events.handlers.get("pi-conductor:tool-policy")?.size ?? 0, 0);
  } finally {
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  }
});
