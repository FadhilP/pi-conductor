import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.ts";
import { preflight } from "./safety.ts";
export type Snapshot = {
  snapshotId: string;
  gitRoot: string;
  head: string;
  worktreeRef: string;
  indexRef: string;
  worktreeTree: string;
  indexTree: string;
};
const ident = {
  GIT_AUTHOR_NAME: "pi-timeline",
  GIT_AUTHOR_EMAIL: "pi-timeline@local",
  GIT_COMMITTER_NAME: "pi-timeline",
  GIT_COMMITTER_EMAIL: "pi-timeline@local",
};
export async function capture(
  cwd: string,
  sessionId: string,
): Promise<Snapshot> {
  const { root, head } = await preflight(cwd),
    id = randomBytes(6).toString("hex"),
    dir = await mkdtemp(join(tmpdir(), "pi-timeline-")),
    index = join(dir, "index");
  try {
    const indexTree = await git(root, ["write-tree"]);
    const env = { GIT_INDEX_FILE: index };
    await git(root, ["read-tree", "HEAD"], env);
    await git(root, ["add", "-A", "--", "."], env);
    const worktreeTree = await git(root, ["write-tree"], env),
      wc = await git(root, [
        "commit-tree",
        worktreeTree,
        "-p",
        head,
        "-m",
        "pi-timeline worktree checkpoint",
      ], ident),
      ic = await git(root, [
        "commit-tree",
        indexTree,
        "-p",
        head,
        "-m",
        "pi-timeline index checkpoint",
      ], ident),
      owner = createHash("sha256").update(sessionId).digest("hex").slice(0, 16),
      base = `refs/pi-timeline/${owner}/${id}`,
      worktreeRef = `${base}/worktree`,
      indexRef = `${base}/index`;
    await git(root, ["update-ref", worktreeRef, wc]);
    try {
      await git(root, ["update-ref", indexRef, ic]);
    } catch (error) {
      await git(root, ["update-ref", "-d", worktreeRef]).catch(() => {});
      throw error;
    }
    return {
      snapshotId: id,
      gitRoot: root,
      head,
      worktreeRef,
      indexRef,
      worktreeTree,
      indexTree,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
