export const MAX_BYTES = 16 * 1024;
/** Repo Scout's final child report budget; other callers retain the general default. */
export const SCOUT_REPORT_MAX_BYTES = 12 * 1024;

function trimToBytes(text: string, maxBytes: number): string {
  let output = text;
  while (Buffer.byteLength(output, "utf8") > maxBytes) output = output.slice(0, -1);
  return output;
}

function markdownBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | undefined;
  const flush = () => {
    const block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\s*(```|~~~)/)?.[1];
    if (marker) fence = fence === marker ? undefined : fence ?? marker;
    if (!fence && !line.trim()) flush();
    else current.push(line);
  }
  flush();
  return blocks;
}

export function capReport(
  text: string,
  maxBytes = SCOUT_REPORT_MAX_BYTES,
): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  const blocks = markdownBlocks(text);
  const noticeFor = (count: number) => `\n\n[Omitted content: ${count} complete report block${count === 1 ? "" : "s"}. Cap: ${maxBytes} bytes.]`;
  const kept: string[] = [];
  let omitted = 0;
  const reservedNoticeBytes = Buffer.byteLength(noticeFor(blocks.length), "utf8");
  for (const block of blocks) {
    const candidate = [...kept, block].join("\n\n");
    if (Buffer.byteLength(candidate, "utf8") + reservedNoticeBytes <= maxBytes) kept.push(block);
    else omitted++;
  }
  const notice = noticeFor(omitted);
  return { text: [kept.join("\n\n"), notice.trim()].filter(Boolean).join("\n\n"), truncated: true };
}

export function capText(
  text: string,
  maxBytes = MAX_BYTES,
  maxLines?: number,
): { text: string; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  let output = maxLines === undefined ? lines.join("\n") : lines.slice(0, maxLines).join("\n");
  const truncated = maxLines !== undefined && lines.length > maxLines || Buffer.byteLength(output, "utf8") > maxBytes;
  if (!truncated) return { text: output, truncated: false };

  const limit = `${maxBytes} bytes${maxLines === undefined ? "" : `/${maxLines} lines`}`;
  const notice = `\n\n[Truncated; omitted content. Cap: ${limit}.]`;
  if (Buffer.byteLength(notice, "utf8") > maxBytes)
    return { text: trimToBytes("[Truncated; omitted content.]", maxBytes), truncated: true };
  output = trimToBytes(output, maxBytes - Buffer.byteLength(notice, "utf8"));
  return { text: `${output}${notice}`, truncated: true };
}
