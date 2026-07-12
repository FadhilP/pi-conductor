import { redact } from "./redact.ts";

export type Snapshot = { text: string; estimatedTokens: number; redactionCount: number; truncated: boolean };
function contentText(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => part?.type === "text" ? part.text : part?.type === "image" ? "[image omitted]" : part?.type === "thinking" ? "[thinking omitted]" : part?.type === "toolCall" ? `[tool call ${part.name}]` : "[unsupported content omitted]").join("\n");
}
export function serializeMessage(message: any): string {
  switch (message?.role) {
    case "user": return `[USER]\n${contentText(message.content)}`;
    case "assistant": return `[ASSISTANT]\n${contentText(message.content)}`;
    case "toolResult": return `[TOOL ${message.toolName ?? "unknown"}]\n${contentText(message.content)}`;
    case "compactionSummary": return `[COMPACTION SUMMARY]\n${message.summary ?? ""}`;
    case "branchSummary": return `[BRANCH SUMMARY]\n${message.summary ?? ""}`;
    case "bashExecution": return `[BASH EXECUTION]\n${message.command ?? ""}\n${message.output ?? ""}`;
    case "custom": return `[CUSTOM ${message.customType ?? "message"}]\n${contentText(message.content)}`;
    default: return `[${String(message?.role ?? "unsupported").toUpperCase()}]\n[unsupported message omitted]`;
  }
}

export function advisorMaxTokens(contextWindow: number): number {
  const window = Number.isFinite(contextWindow)
    ? Math.max(512, Math.floor(contextWindow))
    : 8_192;
  return Math.max(128, Math.min(4_096, Math.floor(window * 0.25)));
}

export function buildSnapshot(systemPrompt: string, messages: any[], contextWindow: number): Snapshot {
  const window = Number.isFinite(contextWindow)
      ? Math.max(512, Math.floor(contextWindow))
      : 8_192,
    tokenBudget = Math.max(
      128,
      Math.min(
        96_000,
        Math.floor(window * 0.7),
        window - advisorMaxTokens(window) - 256,
      ),
    );
  const charBudget = tokenBudget * 4;
  let system = systemPrompt;
  let truncated = false;
  const wrapperChars = 160;
  if (system.length > Math.floor(charBudget * 0.45)) { system = `${system.slice(0, Math.floor(charBudget * 0.45))}\n[system prompt truncated]`; truncated = true; }
  const serialized = messages.map(serializeMessage);
  const mandatory = new Set<number>();
  for (let i = 0; i < messages.length; i++) if (messages[i]?.role === "compactionSummary" || messages[i]?.role === "branchSummary") mandatory.add(i);
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "user") { mandatory.add(i); break; }
  let used = system.length + wrapperChars;
  const selected = new Set<number>();
  const add = (i: number) => { const size = serialized[i].length + 2; if (used + size <= charBudget) { selected.add(i); used += size; } else truncated = true; };
  for (const i of mandatory) add(i);
  for (let i = messages.length - 1; i >= 0; i--) if (!selected.has(i)) add(i);
  if (selected.size < messages.length) truncated = true;
  const transcript = serialized.filter((_value, index) => selected.has(index)).join("\n\n");
  const marker = truncated ? "\n\n[Earlier or oversized executor context omitted to fit advisor budget.]" : "";
  const raw = `<executor-system-prompt>\n${system}\n</executor-system-prompt>\n\n<executor-transcript>\n${transcript}${marker}\n</executor-transcript>`;
  const clean = redact(raw);
  return { text: clean.text, estimatedTokens: Math.ceil(clean.text.length / 4), redactionCount: clean.count, truncated };
}
