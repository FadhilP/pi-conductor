import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packages = [
  "pi-advisor",
  "pi-conductor-core",
  "pi-continuity",
  "pi-focus",
  "pi-guard",
  "pi-heartbeat",
  "pi-scout",
  "pi-timeline",
  "pi-verify",
];
const action = process.argv[2];
const scripts = action === "verify" ? ["check", "test"] : [action];
if (!scripts.every((script) => script === "check" || script === "test")) {
  console.error("Usage: node scripts/run-packages.mjs verify|check|test");
  process.exit(2);
}
for (const script of scripts) {
  for (const name of packages) {
    console.log(`\n=== ${name}: ${script} ===`);
    const npmCli = process.env.npm_execpath;
    const result = spawnSync(npmCli ? process.execPath : "npm", npmCli ? [npmCli, "run", script] : ["run", script], {
      cwd: join(root, name),
      stdio: "inherit",
      shell: !npmCli && process.platform === "win32",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
