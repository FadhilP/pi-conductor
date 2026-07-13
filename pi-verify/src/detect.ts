import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

export type Check = {
  id: string;
  label: string;
  command: string;
  args: string[];
  cwd: string;
};
export type Detection = { checks: Check[]; available: Check[]; omitted: Check[] };

const LIMIT = 6;

async function text(path: string) {
  return readFile(path, "utf8").catch(() => undefined);
}

async function checksAt(cwd: string, prefix = ""): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (id: string, label: string, command: string, args: string[]) =>
    checks.push({ id: `${prefix}${id}`, label: prefix ? `${prefix.slice(0, -1)}: ${label}` : label, command, args, cwd });
  const packageText = await text(join(cwd, "package.json"));
  if (packageText) {
    try {
      const scripts = JSON.parse(packageText)?.scripts ?? {};
      for (const name of ["verify", "check", "typecheck", "lint", "test"])
        if (typeof scripts[name] === "string") {
          const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
          const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm", "run", name] : ["run", name];
          add(`npm:${name}`, `npm ${name}`, command, args);
        }
    } catch {}
  }

  const pyproject = await text(join(cwd, "pyproject.toml"));
  if (pyproject) {
    if (/^\s*\[tool\.ruff(?:\.|\])/m.test(pyproject)) add("python:ruff", "ruff", "python", ["-m", "ruff", "check", "."]);
    if (/^\s*\[tool\.mypy(?:\.|\])/m.test(pyproject)) add("python:mypy", "mypy", "python", ["-m", "mypy", "."]);
    if (/^\s*\[tool\.pytest(?:\.|\])/m.test(pyproject)) add("python:pytest", "pytest", "python", ["-m", "pytest"]);
  }
  if (await text(join(cwd, "Cargo.toml"))) add("rust:test", "cargo test", "cargo", ["test"]);
  if (await text(join(cwd, "go.mod"))) add("go:test", "go test", "go", ["test", "./..."]);

  const makefile = await text(join(cwd, "Makefile"));
  if (makefile)
    for (const target of ["verify", "check", "test", "lint"])
      if (new RegExp(`^${target}\\s*:`, "m").test(makefile)) add(`make:${target}`, `make ${target}`, "make", [target]);
  return checks;
}

export async function detectChecks(cwd: string): Promise<Detection> {
  let available = await checksAt(cwd);
  if (!available.length) {
    const entries = await readdir(cwd, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith(".")).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(cwd, entry.name);
      if (await text(join(child, "package.json"))) available.push(...await checksAt(child, `${basename(child)}/`));
    }
  }

  const seen = new Set<string>();
  available = available.filter((check) => {
    const key = `${check.cwd}\0${check.command}\0${check.args.join("\0")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { checks: available.slice(0, LIMIT), available, omitted: available.slice(LIMIT) };
}
