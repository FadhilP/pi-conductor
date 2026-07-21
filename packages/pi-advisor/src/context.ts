import { ADVISOR_MAX_OUTPUT_TOKENS } from "./advisor.ts";
import { redact } from "./redact.ts";

export type Snapshot = { text: string; estimatedTokens: number; redactionCount: number; truncated: boolean; requiredContextOmitted: boolean };
const CHARS_PER_TOKEN = 4;
const MAX_INPUT_TOKENS = 32_768;

function contentText(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => part?.type === "text" ? part.text : part?.type === "image" ? "[image omitted]" : part?.type === "thinking" ? "[thinking omitted]" : part?.type === "toolCall" ? `[tool call ${part.name}]` : "[unsupported content omitted]").join("\n");
}
function assistantText(content: any): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.filter(part => part?.type === "text").map(part => part.text).join("\n").trim();
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
  return Math.max(128, Math.min(ADVISOR_MAX_OUTPUT_TOKENS, Math.floor(window * 0.25)));
}

export function buildSnapshot(systemPrompt: string, messages: any[], contextWindow: number, reservedInputTokens = 0): Snapshot {
  const window = Number.isFinite(contextWindow)
      ? Math.max(512, Math.floor(contextWindow))
      : 8_192,
    reserved = Math.max(0, reservedInputTokens),
    tokenBudget = Math.max(
      0,
      Math.min(
        MAX_INPUT_TOKENS - reserved,
        Math.floor(window * 0.7) - reserved,
        window - advisorMaxTokens(window) - 256 - reserved,
      ),
    );
  const charBudget = tokenBudget * CHARS_PER_TOKEN;
  const request = messages.filter(message => message?.role === "custom" && message.customType === "advisor-request").slice(-1).map(serializeMessage);
  const evidence = messages.filter(message => message?.role === "custom" && message.customType === "advisor-evidence").map(serializeMessage);
  const continuity = messages.filter(message => message?.role === "custom" && message.customType === "pi-continuity").map(serializeMessage);
  const verification = messages.filter(message => message?.role === "custom" && message.customType === "pi-verify-result").slice(-1).map(serializeMessage);
  const summaries = messages.filter(message => message?.role === "compactionSummary" || message?.role === "branchSummary").map(serializeMessage).reverse();
  const latestUser = [...messages].reverse().find(message => message?.role === "user");
  const latestAssistant = [...messages].reverse().find(message => message?.role === "assistant" && assistantText(message.content));
  const system = systemPrompt ? [systemPrompt] : [];
  const sectionSize = (label: string, records: string[]) => records.length
    ? `<${label}>\n${records.join("\n\n")}\n</${label}>`.length + 2
    : 0;
  const requiredSize = sectionSize("advisor-request", request) + sectionSize("executor-system-prompt", system);
  if (requiredSize > charBudget) {
    return { text: "", estimatedTokens: 0, redactionCount: 0, truncated: true, requiredContextOmitted: true };
  }

  const sections: string[] = [];
  let used = 0;
  let truncated = false;
  const add = (label: string, records: string[], reservedChars = 0) => {
    if (!records.length) return;
    const kept: string[] = [];
    for (const record of records) {
      const candidate = [...kept, record];
      if (used + sectionSize(label, candidate) + reservedChars <= charBudget) kept.push(record);
      else truncated = true;
    }
    if (!kept.length) return;
    const section = `<${label}>\n${kept.join("\n\n")}\n</${label}>`;
    sections.push(section);
    used += section.length + 2;
  };

  const systemSize = sectionSize("executor-system-prompt", system);
  add("advisor-request", request, systemSize);
  add("explicit-evidence", evidence, systemSize);
  add("continuity-state", continuity, systemSize);
  add("latest-verification", verification, systemSize);
  add("session-summaries-newest-first", summaries, systemSize);
  add("latest-user-request", latestUser ? [serializeMessage(latestUser)] : [], systemSize);
  add("latest-assistant-judgment", latestAssistant ? [`[ASSISTANT]\n${assistantText(latestAssistant.content)}`] : [], systemSize);
  add("executor-system-prompt", system);

  const selected = new Set([latestUser, latestAssistant].filter(Boolean));
  if (messages.some(message => !selected.has(message) && !(message?.role === "custom" && (message.customType === "advisor-request" || message.customType === "advisor-evidence" || message.customType === "pi-continuity" || message.customType === "pi-verify-result")) && message?.role !== "compactionSummary" && message?.role !== "branchSummary")) truncated = true;
  const marker = "\n\n[Non-priority, earlier, or oversized executor context omitted.]";
  let raw = sections.join("\n\n");
  if (truncated && raw.length + marker.length <= charBudget) raw += marker;
  const clean = redact(raw);
  return { text: clean.text, estimatedTokens: Math.ceil(clean.text.length / CHARS_PER_TOKEN), redactionCount: clean.count, truncated, requiredContextOmitted: false };
}
