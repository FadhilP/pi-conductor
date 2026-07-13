import test from "node:test";
import assert from "node:assert/strict";
import extension, { ringCompletionBell } from "../extensions/pi-focus.ts";

test("completion bell writes only in TUI mode", () => {
  let output = "";
  const write = (text: string) => { output += text; };
  ringCompletionBell("json", write);
  assert.equal(output, "");
  ringCompletionBell("tui", write);
  assert.equal(output, "\x07");
});

test("focused header shows current session name", () => {
  const handlers = new Map<string, Function[]>();
  let sessionName: string | undefined = "Timeline naming";
  const pi: any = {
    getSessionName: () => sessionName,
    getThinkingLevel: () => "low",
    on: (name: string, handler: Function) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerCommand() {},
  };
  extension(pi);

  let headerFactory: any;
  const theme: any = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  };
  const ctx: any = {
    mode: "tui",
    cwd: "/work/pi-conductor",
    ui: {
      theme,
      setHeader: (factory: any) => { headerFactory = factory; },
      setFooter() {},
      setEditorComponent() {},
      setWorkingIndicator() {},
    },
  };
  handlers.get("session_start")![0]({}, ctx);
  const header = headerFactory({}, theme);
  assert.match(header.render(120)[0], /Timeline naming/);

  sessionName = "Renamed session";
  assert.match(header.render(120)[0], /Renamed session/);
});

test("ui command toggles and reports completion bell", async () => {
  const commands = new Map<string, any>();
  const handlers = new Map<string, Function[]>();
  const pi: any = {
    getSessionName: () => undefined,
    getThinkingLevel: () => "low",
    on: (name: string, handler: Function) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerCommand: (name: string, command: any) => commands.set(name, command),
  };
  extension(pi);
  let notification = "";
  const ctx: any = {
    mode: "json",
    ui: { notify: (text: string) => { notification = text; } },
  };
  await commands.get("ui").handler("status", ctx);
  assert.match(notification, /Completion bell: disabled/);
  await commands.get("ui").handler("bell on", ctx);
  assert.equal(notification, "Completion bell: enabled");
  await commands.get("ui").handler("status", ctx);
  assert.match(notification, /Completion bell: enabled/);
  await commands.get("ui").handler("bell off", ctx);
  assert.equal(notification, "Completion bell: disabled");
  assert.ok(handlers.has("agent_settled"));
});
