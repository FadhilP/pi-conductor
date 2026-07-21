import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  return new Promise<string>((resolve, reject) =>
    execFile("git", args, {
      cwd,
      env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    }, (error, stdout, stderr) =>
      error
        ? reject(Error(String(stderr || error.message).slice(0, 8192)))
        : resolve(String(stdout).replace(/\r?\n$/, "")),
    ),
  );
}

export async function worktreeFingerprint(cwd: string): Promise<string | undefined> {
  try {
    const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
    const [head, status] = await Promise.all([
      git(root, ["rev-parse", "HEAD"]),
      git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    ]);
    if (!status) return `${root}\n${head}\nclean`;

    const indexTree = await git(root, ["write-tree"]);
    const dir = await mkdtemp(join(tmpdir(), "pylon-worktree-"));
    const env = { GIT_INDEX_FILE: join(dir, "index") };
    try {
      await git(root, ["read-tree", "HEAD"], env);
      await git(root, ["add", "-A", "--", "."], env);
      return `${root}\n${head}\n${indexTree}\n${await git(root, ["write-tree"], env)}`;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } catch {
    return undefined;
  }
}
