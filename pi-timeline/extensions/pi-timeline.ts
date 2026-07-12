import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { capture, type Snapshot } from "../src/snapshot.ts";
import { restore } from "../src/restore.ts";
import { promptText, promptTitle } from "../src/prompts.ts";
import { git } from "../src/git.ts";
type RecordV3 = Snapshot & {
  version: 3;
  kind: "pi-prompt-checkpoint";
  promptEntryId: string;
  ownerSessionId: string;
  continuationEntryId: string;
  createdAt: string;
};
type Bound = { record: RecordV3; checkpointEntryId: string; preview: string };
type ClearV1 = {
  version: 1;
  ownerSessionId: string;
  checkpointEntryIds: string[];
};
export default function (pi: ExtensionAPI) {
  let records = new Map<string, Bound>(),
    paired = false,
    namingDecided = false,
    pendingContext = "";
  const load = (ctx: any) => {
    records = new Map();
    const entries = ctx.sessionManager.getEntries(),
      byId = new Map(entries.map((e: any) => [e.id, e]));
    for (const e of entries) {
      if (
        e.type === "custom" &&
        e.customType === "pi-prompt-checkpoint" &&
        e.data?.version === 3
      ) {
        const u = byId.get(e.data.promptEntryId) as any;
        if (u?.type === "message" && u.message.role === "user")
          records.set(e.id, {
            record: e.data,
            checkpointEntryId: e.id,
            preview: promptText(u.message),
          });
      } else if (
        e.type === "custom" &&
        e.customType === "pi-timeline-clear" &&
        e.data?.version === 1
      )
        for (const id of e.data.checkpointEntryIds ?? []) records.delete(id);
    }
  };
  const refresh = (ctx: any) => {
    if (ctx.hasUI)
      ctx.ui.setStatus(
        "pi-timeline",
        records.size
          ? `checkpoints: ${records.size} · session: ${paired ? "paired" : "unpaired"}`
          : undefined,
      );
  };
  const deleteRefs = async (snapshot: Snapshot) => {
    await git(snapshot.gitRoot, ["update-ref", "-d", snapshot.worktreeRef]);
    await git(snapshot.gitRoot, ["update-ref", "-d", snapshot.indexRef]);
  };
  async function checkpoint(ctx: any): Promise<Snapshot | undefined> {
    const branch = ctx.sessionManager.getBranch(),
      user = [...branch]
        .reverse()
        .find(
          (e: any) => e.type === "message" && e.message.role === "user",
        ) as any;
    if (!user) return;
    const existing = [...records.values()]
      .reverse()
      .find((bound) => bound.record.promptEntryId === user.id);
    if (paired && existing) return existing.record;
    const continuation = ctx.sessionManager.getLeafId();
    try {
      const snap = await capture(ctx.cwd, ctx.sessionManager.getSessionId()),
        record: RecordV3 = {
          version: 3,
          kind: "pi-prompt-checkpoint",
          promptEntryId: user.id,
          ownerSessionId: ctx.sessionManager.getSessionId(),
          continuationEntryId: continuation,
          ...snap,
          createdAt: new Date().toISOString(),
        };
      pi.appendEntry("pi-prompt-checkpoint", record);
      const checkpointEntryId = ctx.sessionManager.getLeafId()!;
      records.set(checkpointEntryId, {
        record,
        checkpointEntryId,
        preview: promptText(user.message),
      });
      paired = true;
      refresh(ctx);
      return record;
    } catch (e: any) {
      if (ctx.hasUI)
        ctx.ui.notify(`Timeline checkpoint skipped: ${e.message}`, "warning");
    }
  }
  pi.on("session_start", (_e, ctx) => {
    load(ctx);
    paired = false;
    namingDecided = ctx.sessionManager
      .getEntries()
      .some((entry: any) => entry.type === "session_info");
    refresh(ctx);
  });
  pi.on("session_info_changed", () => {
    namingDecided = true;
  });
  pi.on("input", (event) => {
    if (event.source !== "extension") paired = false;
  });
  pi.on("agent_settled", async (_e, ctx) => {
    if (!namingDecided) {
      namingDecided = true;
      const firstUser = ctx.sessionManager
        .getBranch()
        .find(
          (entry: any) =>
            entry.type === "message" && entry.message.role === "user",
        ) as any;
      const name = firstUser && promptTitle(firstUser.message);
      if (name) pi.setSessionName(name);
    }
    await checkpoint(ctx);
  });
  pi.on("session_tree", (_e, ctx) => {
    paired = false;
    refresh(ctx);
    ctx.ui.notify(
      "Conversation changed with /tree; files were not restored. Use /timeline.",
      "warning",
    );
  });
  pi.on("context", (event) => {
    if (pendingContext) {
      const text = pendingContext;
      pendingContext = "";
      return {
        messages: [
          ...event.messages,
          {
            role: "custom",
            customType: "pi-timeline",
            content: text,
            display: false,
            timestamp: Date.now(),
          },
        ],
      };
    }
  });
  pi.registerCommand("timeline", {
    description: "List, view, fork, or clear Git-backed prompt checkpoints",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      load(ctx);
      const [actionRaw, idRaw] = args.trim().split(/\s+/, 2),
        action = actionRaw || "select";
      if (action === "list") {
        ctx.ui.notify(
          [...records].map(([id, b]) => `${id} ${b.preview}`).join("\n") ||
            "No checkpoints.",
          "info",
        );
        return;
      }
      if (action === "clear") {
        if (
          !ctx.hasUI ||
          !(await ctx.ui.confirm(
            "Clear timeline refs?",
            "Delete refs owned by current session? Git objects are not garbage-collected.",
          ))
        )
          return;
        const owned = [...records].filter(
          ([, bound]) =>
            bound.record.ownerSessionId === ctx.sessionManager.getSessionId(),
        );
        for (const [, bound] of owned)
          await deleteRefs(bound.record).catch(() => {});
        const cleared: ClearV1 = {
          version: 1,
          ownerSessionId: ctx.sessionManager.getSessionId(),
          checkpointEntryIds: owned.map(([id]) => id),
        };
        pi.appendEntry("pi-timeline-clear", cleared);
        for (const [id] of owned) records.delete(id);
        refresh(ctx);
        return;
      }
      if (ctx.mode !== "tui" && ctx.mode !== "rpc") {
        ctx.ui.notify(
          "Timeline restore requires interactive confirmation.",
          "error",
        );
        return;
      }
      let mode = action;
      let id: string | undefined = idRaw;
      if (action === "select") {
        id = await ctx.ui.select(
          "Checkpoint",
          [...records].map(([id, b]) => `${id} ${b.preview}`),
        );
        id = id?.split(" ")[0];
        if (!id) return;
        mode =
          (await ctx.ui.select("Action", ["View", "Fork & continue"])) ===
          "View"
            ? "jump"
            : "fork";
      }
      const target = id && records.get(id);
      if (!target) {
        ctx.ui.notify("Unknown or unavailable checkpoint.", "error");
        return;
      }
      const source = await checkpoint(ctx);
      if (!source) {
        ctx.ui.notify("Unable to checkpoint current state.", "error");
        return;
      }
      const ok = await ctx.ui.confirm(
        mode === "fork" ? "Fork and restore?" : "View and restore?",
        `${target.preview}\nCurrent dirty state is checkpointed. Ignored files stay untouched.`,
      );
      if (!ok) return;
      if (mode === "jump") {
        const old = ctx.sessionManager.getLeafId();
        try {
          await ctx.navigateTree(target.record.continuationEntryId, {
            summarize: false,
          });
          await restore(target.record, ctx.cwd);
          paired = true;
          pendingContext = `Filesystem restored from user prompt ${id}. Later changes may not exist.`;
          refresh(ctx);
        } catch (e: any) {
          await restore(source, ctx.cwd).catch(() => {});
          if (old)
            await ctx.navigateTree(old, { summarize: false }).catch(() => {});
          ctx.ui.notify(
            `Timeline restore failed and rollback attempted: ${e.message}`,
            "error",
          );
        }
      } else {
        await ctx.fork(target.checkpointEntryId, {
          position: "at",
          withSession: async (fresh) => {
            try {
              await restore(target.record, fresh.cwd);
              await fresh.sendMessage(
                {
                  customType: "pi-timeline",
                  content: `Filesystem restored in forked Pi session from user prompt ${id}.`,
                  display: false,
                },
                { deliverAs: "nextTurn" },
              );
              fresh.ui.notify("Timeline fork restored.", "info");
            } catch (e: any) {
              await restore(source, fresh.cwd).catch(() => {});
              fresh.ui.notify(
                `Child restore failed; source files restored: ${e.message}`,
                "error",
              );
            }
          },
        });
      }
    },
  });
}
