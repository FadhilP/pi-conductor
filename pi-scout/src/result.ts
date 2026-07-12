export const MAX_BYTES = 8 * 1024;
export const MAX_LINES = 250;

export function capText(
  text: string,
  maxBytes = MAX_BYTES,
  maxLines = MAX_LINES,
): { text: string; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  let output = lines.slice(0, maxLines).join("\n");
  let truncated = lines.length > maxLines;
  while (Buffer.byteLength(output, "utf8") > maxBytes) {
    output = output.slice(0, -1);
    truncated = true;
  }
  return {
    text: truncated
      ? `${output}\n\n[Truncated to ${maxBytes} bytes/${maxLines} lines.]`
      : output,
    truncated,
  };
}
