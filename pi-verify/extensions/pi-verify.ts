import { StringEnum } from "@earendil-works/pi-ai";
import {
  truncateTail,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { detectChecks } from "../src/detect.ts";

type Result = {
  label: string;
  command: string;
  code: number | null;
  output: string;
  truncated: boolean;
  durationMs: number;
};
type Details = { scope: "changed" | "project"; skipped?: string; results: Result[] };

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "verify",
    label: "Verify",
    description:
      "Detect and run existing project verification commands with bounded output. Scope changed skips clean Git worktrees; project always runs.",
    promptSnippet: "Run detected project checks and return bounded failures",
    promptGuidelines: [
      "Use verify after code changes before claiming completion. Use scope changed for normal edits and project for broad refactors or release checks. Verify runs only commands declared or implied by recognized project manifests; never use it to install dependencies.",
    ],
    parameters: Type.Object(
      { scope: StringEnum(["changed", "project"] as const) },
      { additionalProperties: false },
    ),
    async execute(_id, params, signal, onUpdate, ctx) {
      if (params.scope === "changed") {
        const status = await pi.exec("git", ["status", "--porcelain"], {
          cwd: ctx.cwd,
          signal,
          timeout: 15_000,
        });
        if (status.code === 0 && !status.stdout.trim()) {
          const details: Details = {
            scope: params.scope,
            skipped: "Git worktree is clean.",
            results: [],
          };
          return { content: [{ type: "text" as const, text: details.skipped! }], details };
        }
      }

      const checks = await detectChecks(ctx.cwd);
      if (!checks.length) {
        const details: Details = {
          scope: params.scope,
          skipped: "No declared verification commands detected.",
          results: [],
        };
        return { content: [{ type: "text" as const, text: details.skipped! }], details };
      }

      const results: Result[] = [];
      for (const [index, check] of checks.entries()) {
        if (signal?.aborted) break;
        onUpdate?.({
          content: [{ type: "text", text: `Running ${index + 1}/${checks.length}: ${check.label}` }],
          details: { scope: params.scope, results },
        });
        const started = Date.now();
        const execution = await pi.exec(check.command, check.args, {
          cwd: ctx.cwd,
          signal,
          timeout: 5 * 60_000,
        });
        const raw = [execution.stdout, execution.stderr].filter(Boolean).join("\n");
        const bounded = truncateTail(raw, { maxLines: 160, maxBytes: 12 * 1024 });
        results.push({
          label: check.label,
          command: [check.command, ...check.args].join(" "),
          code: execution.code,
          output: bounded.content.trim(),
          truncated: bounded.truncated,
          durationMs: Date.now() - started,
        });
        if (execution.code !== 0) break;
      }

      const passed = results.length === checks.length && results.every((result) => result.code === 0);
      const summary = results
        .map((result) => `${result.code === 0 ? "PASS" : "FAIL"} ${result.command} (${(result.durationMs / 1000).toFixed(1)}s)${result.output ? `\n${result.output}` : ""}${result.truncated ? "\n[output truncated]" : ""}`)
        .join("\n\n");
      const details: Details = { scope: params.scope, results };
      return {
        content: [{ type: "text" as const, text: `${passed ? "Verification passed." : "Verification failed."}\n\n${summary}` }],
        details,
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("Verify ")) + theme.fg("muted", args.scope),
        0,
        0,
      );
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as Details | undefined;
      if (!details) return new Text("Verify", 0, 0);
      if (details.skipped) return new Text(theme.fg("muted", details.skipped), 0, 0);
      const failed = details.results.find((item) => item.code !== 0);
      let text = theme.fg(failed ? "error" : "success", failed ? "Verification failed" : "Verification passed");
      text += theme.fg("dim", ` · ${details.results.length} check(s)`);
      if (expanded)
        text += `\n${details.results.map((item) => `${item.code === 0 ? "PASS" : "FAIL"} ${item.command}${item.output ? `\n${item.output}` : ""}`).join("\n\n")}`;
      return new Text(text, 0, 0);
    },
  });
}
