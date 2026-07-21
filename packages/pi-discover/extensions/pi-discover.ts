import { isAbsolute, relative, resolve } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const TIMEOUT_MS = 30_000;
const MAX_MATCHES = 200;
const MAX_RESULT_CHARS = 2_000;

export type ToolMetadata = { name: string; description?: string };
export type ToolDiscoveryResult = {
  error?: string;
  selected?: string[];
  blocked?: string[];
};
export type ToolDiscoveryCapability = {
  eligible(): string[];
  select(names: string[]): ToolDiscoveryResult;
  reset(): ToolDiscoveryResult;
};

export function workspacePath(cwd: string, input = "."): string {
  const clean = input.replace(/^@/, "") || ".";
  const absolute = resolve(cwd, clean);
  const within = relative(resolve(cwd), absolute);
  if (within === ".." || within.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(within))
    throw new Error("Search path must stay within workspace");
  return within || ".";
}

function fit(text: string, maxBytes: number): string {
  let value = text;
  while (Buffer.byteLength(value, "utf8") > maxBytes) value = value.slice(0, -1);
  return value;
}

function bounded(output: string, maxBytes = DEFAULT_MAX_BYTES): string {
  const result = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes });
  if (!result.truncated) return result.content;
  const notice = `\n\n[Output truncated; omitted output after ${result.outputLines}/${result.totalLines} lines and ${formatSize(result.outputBytes)}/${formatSize(result.totalBytes)}. Cap: ${formatSize(maxBytes)}.]`;
  return `${fit(result.content, maxBytes - Buffer.byteLength(notice, "utf8"))}${notice}`;
}

function unavailable(error: unknown): boolean {
  return /ENOENT|not recognized|not found|cannot find/i.test(String(error));
}

function keywords(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])];
}

/** Deterministically rank tools by query keywords in their name and description. */
export function keywordRankTools(tools: readonly ToolMetadata[], query: string, limit = 3): ToolMetadata[] {
  const terms = keywords(query);
  if (!terms.length) return [];
  return tools
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const description = (tool.description ?? "").toLowerCase();
      const score = terms.reduce((total, term) => total
        + (name === term ? 16 : name.includes(term) ? 8 : 0)
        + (description.includes(term) ? 2 : 0), 0);
      return { tool, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit)
    .map(({ tool }) => tool);
}

/** Rank only inactive tools, excluding search_tools itself. */
export function rankInactiveTools(tools: readonly ToolMetadata[], activeNames: readonly string[], query: string, limit = 3): ToolMetadata[] {
  const active = new Set(activeNames);
  return keywordRankTools(tools.filter((tool) => tool.name !== "search_tools" && !active.has(tool.name)), query, limit);
}

function discoveryCapability(pi: ExtensionAPI): ToolDiscoveryCapability | undefined {
  const responses: unknown[] = [];
  pi.events.emit("pylon:tool-discovery", { version: 1, respond: (capability: unknown) => responses.push(capability) });
  if (responses.length !== 1) return undefined;
  const capability = responses[0] as Partial<ToolDiscoveryCapability>;
  if (typeof capability?.eligible !== "function" || typeof capability.select !== "function" || typeof capability.reset !== "function") return undefined;
  return capability as ToolDiscoveryCapability;
}

function resultText(value: unknown): string {
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return fit(text ?? "", MAX_RESULT_CHARS);
}

export default function discoverExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "rg",
    label: "ripgrep",
    description: `Fast read-only content search with line numbers or matching file paths. Output capped at ${formatSize(DEFAULT_MAX_BYTES)}. Use grep if ripgrep is unavailable.`,
    promptSnippet: "Fast read-only repository content search with line-numbered matches or matching file paths",
    promptGuidelines: ["Prefer rg for repository content search; use grep when unavailable. Narrow by path or glob; use mode files for broad discovery, then refine truncated output."],
    parameters: Type.Object({
      pattern: Type.String({ description: "Regular expression to search" }),
      path: Type.Optional(Type.String({ description: "Workspace-relative file or directory; default ." })),
      glob: Type.Optional(Type.String({ description: "Optional file glob, such as *.ts" })),
      mode: Type.Optional(StringEnum(["lines", "files"] as const, { description: "Return line-numbered matches (default) or only matching file paths" })),
    }),
    async execute(_id, params, signal, _update, ctx) {
      const path = workspacePath(ctx.cwd, params.path);
      const args = params.mode === "files"
        ? ["--files-with-matches", "--color=never"]
        : ["--line-number", "--color=never", "--max-columns=500", "--max-columns-preview", "--max-count", String(MAX_MATCHES)];
      if (params.glob) args.push("--glob", params.glob);
      args.push("--", params.pattern, path);
      try {
        const result = await pi.exec("rg", args, { signal, timeout: TIMEOUT_MS });
        if (result.code === 1) return { content: [{ type: "text" as const, text: "No matches found" }], details: { code: 1 } };
        if (result.code !== 0) {
          if (unavailable(result.stderr)) return { content: [{ type: "text" as const, text: "ripgrep unavailable; use grep instead." }], details: { unavailable: true } };
          throw new Error(`ripgrep failed (${result.code}): ${result.stderr.trim()}`);
        }
        return { content: [{ type: "text" as const, text: bounded(result.stdout) || "No matches found" }], details: { code: 0 } };
      } catch (error) {
        if (unavailable(error)) return { content: [{ type: "text" as const, text: "ripgrep unavailable; use grep instead." }], details: { unavailable: true } };
        throw error;
      }
    },
  });

  pi.registerTool({
    name: "fd",
    label: "fd",
    description: `Fast read-only file-name/path search. Output capped at ${formatSize(DEFAULT_MAX_BYTES)}. Use find if fd/fdfind is unavailable.`,
    promptSnippet: "Fast read-only repository file-name and path search",
    promptGuidelines: ["Prefer fd for repository file-name/path search; use find when fd reports it is unavailable."],
    parameters: Type.Object({
      pattern: Type.Optional(Type.String({ description: "Regular expression; default lists all entries" })),
      path: Type.Optional(Type.String({ description: "Workspace-relative directory; default ." })),
      glob: Type.Optional(Type.Boolean({ description: "Treat pattern as a glob" })),
    }),
    async execute(_id, params, signal, _update, ctx) {
      const path = workspacePath(ctx.cwd, params.path);
      const args = ["--color", "never", "--max-results", String(DEFAULT_MAX_LINES)];
      if (params.glob) args.push("--glob");
      args.push(params.pattern || ".", path);
      let lastError = "";
      for (const command of ["fd", "fdfind"]) {
        try {
          const result = await pi.exec(command, args, { signal, timeout: TIMEOUT_MS });
          if (result.code === 0) return { content: [{ type: "text" as const, text: bounded(result.stdout) || "No files found" }], details: { command } };
          lastError = result.stderr;
          if (!unavailable(result.stderr)) throw new Error(`${command} failed (${result.code}): ${result.stderr.trim()}`);
        } catch (error) {
          if (!unavailable(error)) throw error;
          lastError = String(error);
        }
      }
      return { content: [{ type: "text" as const, text: "fd/fdfind unavailable; use find instead." }], details: { unavailable: true, error: lastError } };
    },
  });

  pi.registerTool({
    name: "search_tools",
    label: "Search tools",
    description: "Find inactive Pi tools by keyword and ask Pylon to activate matching tools for the next model turn.",
    promptSnippet: "Find and activate inactive tools by keyword for the next turn",
    promptGuidelines: ["Use search_tools when a relevant Pi tool is inactive. Activated definitions become callable next model turn; do not assume they are callable in this turn."],
    parameters: Type.Object({
      action: Type.Optional(StringEnum(["search", "reset"] as const)),
      query: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: "Keywords to match against inactive tool names and descriptions" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 6, description: "Maximum matching tools to activate; default 3" })),
    }, { additionalProperties: false }),
    async execute(_id, params): Promise<{
      content: Array<{ type: "text"; text: string }>;
      details: Record<string, unknown>;
    }> {
      const capability = discoveryCapability(pi);
      if (!capability) return {
        content: [{ type: "text" as const, text: "Pylon tool coordination is unavailable; no tools were activated." }],
        details: { failureCode: "coordination_unavailable" },
      };
      if ((params.action ?? "search") === "reset") {
        const reset = capability.reset();
        if (reset.error) return {
          content: [{ type: "text" as const, text: `Pylon tool selection reset failed: ${reset.error}` }],
          details: { action: "reset", failureCode: "selection_failed" },
        };
        const result = resultText(reset);
        return {
          content: [{ type: "text" as const, text: `Pylon tool selection reset.${result ? ` ${result}` : ""} Definitions update next model turn.` }],
          details: { action: "reset" },
        };
      }
      const query = params.query?.trim() ?? "";
      if (!query) return {
        content: [{ type: "text" as const, text: "Provide query keywords to search inactive tools." }],
        details: { action: "search", matches: [] },
      };
      const eligible = [...new Set(capability.eligible())].sort();
      const eligibleSet = new Set(eligible);
      const matches = rankInactiveTools(
        ((pi.getAllTools?.() ?? []) as ToolMetadata[]).filter((tool) => eligibleSet.has(tool.name)),
        pi.getActiveTools(), query, params.limit ?? 3,
      );
      const names = matches.map((tool) => tool.name);
      if (!names.length) return {
        content: [{ type: "text" as const, text: `No eligible inactive tools matched "${query}".` }],
        details: { action: "search", query, matches: [] },
      };
      const selection = capability.select(names);
      if (selection.error) return {
        content: [{ type: "text" as const, text: `Tool activation failed: ${selection.error}` }],
        details: { action: "search", query, matches: names, failureCode: "selection_failed" },
      };
      const extra = resultText(selection);
      return {
        content: [{ type: "text" as const, text: `Activated: ${names.join(", ")}. Their definitions become callable next model turn.${extra ? ` ${extra}` : ""}` }],
        details: { action: "search", query, matches: names, blocked: selection.blocked ?? [] },
      };
    },
  });
}
