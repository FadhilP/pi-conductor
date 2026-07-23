const PATTERNS: RegExp[] = [
  /-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/gi,
  /\b(?:sk-ant-|sk-proj-|sk-|ghp_|github_pat_|AIza|xox[baprs]-)[A-Za-z0-9._-]{12,}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(?:authorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+|(?:api[_-]?key|token|password|secret|cookie)\s*[:=]\s*[^\s,;]+)/gi,
  /\b[A-Za-z0-9+/=_-]{40,}\b/g,
];

const FAILURE_MESSAGE_MAX_LENGTH = 500;

export function redact(text: string): { text: string; count: number } {
  const marker = "\uE000";
  let count = 0;
  let output = text;
  for (const pattern of PATTERNS)
    output = output.replace(pattern, () => {
      count++;
      return marker;
    });
  return { text: output.replaceAll(marker, "[possible credential redacted]"), count };
}

export function sanitizeFailureMessage(value: unknown, fallback: string): string {
  const message = value instanceof Error
    ? value.message
    : typeof value === "string"
      ? value
      : fallback;
  const clean = redact(message).text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim() || fallback;
  return clean.length > FAILURE_MESSAGE_MAX_LENGTH
    ? `${clean.slice(0, FAILURE_MESSAGE_MAX_LENGTH - 3)}...`
    : clean;
}
