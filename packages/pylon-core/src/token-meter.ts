const CHARS_PER_ESTIMATED_TOKEN = 4;

export interface ToolUsage {
  calls: number;
  inputChars: number;
  outputChars: number;
  images: number;
  errors: number;
}

export interface TokenMeter {
  byTool: Map<string, ToolUsage>;
  seenCallIds: Set<string>;
}

interface ContentPart {
  type?: string;
  text?: string;
}

interface ToolResultLike {
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  content: ContentPart[];
  isError: boolean;
}

export function createTokenMeter(): TokenMeter {
  return { byTool: new Map(), seenCallIds: new Set() };
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return String(value).length;
  }
}

export function recordToolResult(meter: TokenMeter, result: ToolResultLike): void {
  if (meter.seenCallIds.has(result.toolCallId)) return;
  meter.seenCallIds.add(result.toolCallId);
  const usage = meter.byTool.get(result.toolName) ?? {
    calls: 0,
    inputChars: 0,
    outputChars: 0,
    images: 0,
    errors: 0,
  };
  usage.calls++;
  usage.inputChars += serializedLength(result.input ?? {});
  usage.outputChars += result.content.reduce(
    (sum, part) => sum + (part.type === "text" && typeof part.text === "string" ? part.text.length : 0),
    0,
  );
  usage.images += result.content.filter((part) => part.type === "image").length;
  if (result.isError) usage.errors++;
  meter.byTool.set(result.toolName, usage);
}

export function meterFromBranch(entries: readonly any[]): TokenMeter {
  const meter = createTokenMeter();
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
  for (const entry of entries) {
    const message = entry?.type === "message" ? entry.message : undefined;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part?.type === "toolCall" && typeof part.id === "string" && typeof part.name === "string")
        calls.set(part.id, { name: part.name, input: part.arguments ?? {} });
    }
  }
  for (const entry of entries) {
    const message = entry?.type === "message" ? entry.message : undefined;
    if (message?.role !== "toolResult" || typeof message.toolCallId !== "string") continue;
    const call = calls.get(message.toolCallId);
    recordToolResult(meter, {
      toolCallId: message.toolCallId,
      toolName: typeof message.toolName === "string" ? message.toolName : call?.name ?? "unknown",
      input: call?.input ?? {},
      content: Array.isArray(message.content) ? message.content : [],
      isError: message.isError === true,
    });
  }
  return meter;
}

export const estimatedTokens = (characters: number): number =>
  Math.ceil(characters / CHARS_PER_ESTIMATED_TOKEN);

export function formatTokenMeter(meter: TokenMeter): string {
  const rows = [...meter.byTool.entries()].sort((a, b) => {
    const aChars = a[1].inputChars + a[1].outputChars;
    const bChars = b[1].inputChars + b[1].outputChars;
    return bChars - aChars || a[0].localeCompare(b[0]);
  });
  if (!rows.length)
    return "Estimated tool payload tokens: no completed tool calls in current session branch.";

  let totalCalls = 0, totalInput = 0, totalOutput = 0, totalImages = 0, totalErrors = 0;
  const lines = rows.map(([name, usage]) => {
    totalCalls += usage.calls;
    totalInput += usage.inputChars;
    totalOutput += usage.outputChars;
    totalImages += usage.images;
    totalErrors += usage.errors;
    return `${name}: ${usage.calls} call${usage.calls === 1 ? "" : "s"}; input ~${estimatedTokens(usage.inputChars)}; output ~${estimatedTokens(usage.outputChars)}; total ~${estimatedTokens(usage.inputChars + usage.outputChars)} tokens${usage.images ? `; images ${usage.images}` : ""}${usage.errors ? `; errors ${usage.errors}` : ""}`;
  });
  return [
    "Estimated tool payload tokens (serialized arguments + text results; ~4 characters/token):",
    ...lines,
    `Total: ${totalCalls} calls; input ~${estimatedTokens(totalInput)}; output ~${estimatedTokens(totalOutput)}; total ~${estimatedTokens(totalInput + totalOutput)} tokens; images ${totalImages}; errors ${totalErrors}`,
  ].join("\n");
}
