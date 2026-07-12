import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const commandRules: Array<[RegExp, string]> = [
  [/\b(?:sudo|doas)\b/i, "privilege escalation"],
  [/\brm\b[^\n;&|]*(?:--recursive|-[a-z]*r[a-z]*)/i, "recursive deletion"],
  [/\b(?:rmdir|rd)\b[^\n;&|]*\/(?:s|q)\b/i, "recursive directory deletion"],
  [/\bRemove-Item\b[^\n;|]*-(?:Recurse|Force)\b/i, "recursive or forced deletion"],
  [/\bgit\s+reset\s+--hard\b/i, "destructive Git reset"],
  [/\bgit\s+clean\s+-[a-z]*f/i, "destructive Git clean"],
  [/\bgit\s+push\b[^\n;&|]*\s--force(?:-with-lease)?\b/i, "forced Git push"],
  [/\b(?:mkfs(?:\.[a-z0-9]+)?|diskpart)\b/i, "disk modification"],
  [/\bdd\b[^\n;&|]*\bof=\s*\/dev\//i, "raw device write"],
  [/\b(?:chmod|chown)\b[^\n;&|]*\s-R\b/i, "recursive permission change"],
];

export function commandRisk(command: string): string | undefined {
  return commandRules.find(([pattern]) => pattern.test(command))?.[1];
}

async function canonicalTarget(cwd: string, input: string) {
  const target = resolve(cwd, input.replace(/^@/, ""));
  try {
    return await realpath(target);
  } catch {
    let parent = dirname(target);
    const suffix: string[] = [target.slice(parent.length + (parent.endsWith(sep) ? 0 : 1))];
    for (;;) {
      try {
        return resolve(await realpath(parent), ...suffix.reverse());
      } catch {
        const next = dirname(parent);
        if (next === parent) return target;
        suffix.push(parent.slice(next.length + (next.endsWith(sep) ? 0 : 1)));
        parent = next;
      }
    }
  }
}

export async function pathRisk(
  cwd: string,
  input: string,
): Promise<{ action: "block" | "confirm"; reason: string } | undefined> {
  const root = await realpath(cwd);
  const target = await canonicalTarget(cwd, input);
  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
    return { action: "block", reason: "write target escapes workspace" };
  const segments = fromRoot.split(/[\\/]/).map((part) => part.toLowerCase());
  if (segments.includes(".git"))
    return { action: "block", reason: ".git internals are protected" };
  if (segments.includes("node_modules"))
    return { action: "block", reason: "node_modules is generated and protected" };
  if (segments.some((part) => part === ".env" || part.startsWith(".env.")))
    return { action: "confirm", reason: "environment file may contain secrets" };
  return undefined;
}
