import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type Check = { label: string; command: string; args: string[] };

async function text(path: string) {
  return readFile(path, "utf8").catch(() => undefined);
}

export async function detectChecks(cwd: string): Promise<Check[]> {
  const checks: Check[] = [];
  const packageText = await text(join(cwd, "package.json"));
  if (packageText) {
    try {
      const scripts = JSON.parse(packageText)?.scripts ?? {};
      for (const name of ["verify", "check", "typecheck", "lint", "test"])
        if (typeof scripts[name] === "string")
          checks.push({ label: `npm ${name}`, command: "npm", args: ["run", name] });
    } catch {}
  }

  const pyproject = await text(join(cwd, "pyproject.toml"));
  if (pyproject) {
    if (/^\s*\[tool\.ruff(?:\.|\])/m.test(pyproject))
      checks.push({ label: "ruff", command: "python", args: ["-m", "ruff", "check", "."] });
    if (/^\s*\[tool\.mypy(?:\.|\])/m.test(pyproject))
      checks.push({ label: "mypy", command: "python", args: ["-m", "mypy", "."] });
    if (/^\s*\[tool\.pytest(?:\.|\])/m.test(pyproject))
      checks.push({ label: "pytest", command: "python", args: ["-m", "pytest"] });
  }
  if (await text(join(cwd, "Cargo.toml")))
    checks.push({ label: "cargo test", command: "cargo", args: ["test"] });
  if (await text(join(cwd, "go.mod")))
    checks.push({ label: "go test", command: "go", args: ["test", "./..."] });

  const makefile = await text(join(cwd, "Makefile"));
  if (makefile)
    for (const target of ["verify", "check", "test", "lint"])
      if (new RegExp(`^${target}\\s*:`, "m").test(makefile))
        checks.push({ label: `make ${target}`, command: "make", args: [target] });

  const seen = new Set<string>();
  return checks.filter((check) => {
    const key = `${check.command}\0${check.args.join("\0")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}
