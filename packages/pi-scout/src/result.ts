export const MAX_BYTES = 16 * 1024;
/** Repo Scout's final child report budget; other callers retain the general default. */
export const SCOUT_REPORT_MAX_BYTES = 12 * 1024;

function trimToBytes(text: string, maxBytes: number): string {
  let output = text;
  while (Buffer.byteLength(output, "utf8") > maxBytes) output = output.slice(0, -1);
  return output;
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
