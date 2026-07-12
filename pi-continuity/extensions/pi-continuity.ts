import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { Container } from "@earendil-works/pi-tui";
import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  fresh,
  setPlan,
  updateTodo,
  hasRemainingTodos,
  sessionWorkFile,
  isWork,
  type Work,
} from "../src/active-work.ts";
import {
  readJson,
  writeJson,
  updateJson,
  withStateLock,
  rm,
  defaultRoot,
} from "../src/storage.ts";
import { registerWorkspace, type Workspace } from "../src/workspace.ts";
import {
  candidate,
  compact,
  isCandidatesFile,
  isMemoryFile,
  type Candidate,
  type Fact,
} from "../src/memory.ts";
import { assertSafe } from "../src/secrets.ts";
import { blocked, planningTools } from "../src/plan-gate.ts";
import { buildContext } from "../src/context.ts";
import { validateQuestion } from "../src/questions.ts";
const Kind = StringEnum([
    "workflow",
    "structure",
    "architecture",
    "warning",
    "preference",
  ] as const),
  Status = StringEnum(["pending", "in_progress", "done", "blocked"] as const),
  Action = StringEnum([
    "clarify",
    "set_plan",
    "todo",
    "state",
    "memory_candidate",
  ] as const),
  MemAction = StringEnum(["add", "replace", "remove"] as const);
export default function (pi: ExtensionAPI) {
  let root = defaultRoot(),
    dir = "",
    workFile = "",
    workspace: Workspace | undefined,
    all: Workspace[] = [],
    work: Work | undefined,
    facts: Fact[] = [],
    parentFacts: Fact[] = [],
    candidates: Candidate[] = [],
    savedTools: string[] | undefined,
    lastPrompt = "";
  const paths = () => ({
    work: workFile,
    memory: join(dir, "memory.json"),
    candidates: join(dir, "candidates.json"),
  });
  const saveWork = async () => {
    if (work) {
      assertSafe(
        work.goal,
        work.planSummary,
        ...work.constraints,
        work.latestFailure,
        work.nextAction,
        ...work.todos.map((t) => t.text),
      );
      await writeJson(paths().work, work);
    }
  };
  const refresh = (ctx: any) => {
    if (ctx.hasUI) ctx.ui.setStatus("pi-continuity", undefined);
    if (ctx.mode === "tui")
      ctx.ui.setWidget(
        "pi-continuity",
        work && !["completed", "cancelled"].includes(work.mode)
          ? [
              "Tasks",
              ...work.todos.map(
                (t) =>
                  `${t.status === "done" ? "✓" : t.status === "in_progress" ? "●" : "○"} ${t.text}`,
              ),
            ]
          : undefined,
      );
  };
  const hideTasks = (ctx: any) => {
    if (ctx.mode === "tui") ctx.ui.setWidget("pi-continuity", undefined);
  };
  const compactMemory = async () =>
    withStateLock(dir, async () => {
      const latestFacts = (
          await readJson(
            paths().memory,
            { schemaVersion: 1 as const, facts: [] as Fact[] },
            isMemoryFile,
          )
        ).facts,
        latestCandidates = (
          await readJson(
            paths().candidates,
            { schemaVersion: 1 as const, candidates: [] as Candidate[] },
            isCandidatesFile,
          )
        ).candidates;
      facts = latestFacts;
      candidates = latestCandidates;
      if (!candidates.some((item) => item.status === "pending")) return;
      const result = compact(facts, candidates, 80);
      facts = result.facts;
      candidates = result.candidates;
      await writeJson(paths().memory, {
        schemaVersion: 1,
        facts,
        updatedAt: new Date().toISOString(),
      });
      await writeJson(paths().candidates, {
        schemaVersion: 1,
        candidates,
      });
    });
  const gate = (on: boolean) => {
    let coordinated = false;
    pi.events.emit("pi-conductor:tool-policy", {
      version: 1,
      kind: "register",
      owner: "pi-continuity",
      managedTools: ["continuity_update"],
      enabledTools: ["continuity_update"],
      ...(on ? { allowOnly: planningTools() } : {}),
      acknowledge: () => { coordinated = true; },
    });
    if (coordinated) {
      savedTools = undefined;
      return;
    }
    if (on) {
      savedTools ??= pi.getActiveTools();
      const allowed = new Set(planningTools());
      pi.setActiveTools(pi.getActiveTools().filter((tool) => allowed.has(tool)));
    } else if (savedTools) {
      const allowed = new Set(planningTools());
      const restored = [
        ...pi.getActiveTools(),
        ...savedTools.filter((tool) => !allowed.has(tool)),
        "continuity_update",
      ];
      pi.setActiveTools([...new Set(restored)]);
      savedTools = undefined;
    }
  };
  pi.on("session_start", async (_e, ctx) => {
    const reg = await registerWorkspace(root, ctx.cwd);
    workspace = reg.workspace;
    all = reg.all;
    dir = reg.dir;
    workFile = join(
      dir,
      "sessions",
      sessionWorkFile(ctx.sessionManager.getSessionId()),
    );
    const p = paths();
    work = await readJson<Work | undefined>(
      p.work,
      undefined,
      (value) => value === undefined || isWork(value),
    );
    facts = (
      await readJson(p.memory, { schemaVersion: 1 as const, facts: [] as Fact[] }, isMemoryFile)
    ).facts;
    candidates = (
      await readJson(
        p.candidates,
        { schemaVersion: 1 as const, candidates: [] as Candidate[] },
        isCandidatesFile,
      )
    ).candidates;
    const parent = workspace.parentId
      ? all.find((item) => item.id === workspace!.parentId)
      : undefined;
    parentFacts = parent
      ? (
          await readJson(
            join(root, "workspaces", parent.id, "memory.json"),
            { schemaVersion: 1 as const, facts: [] as Fact[] },
            isMemoryFile,
          )
        ).facts
      : [];
    gate(work?.mode === "planning");
    refresh(ctx);
  });
  pi.on("session_shutdown", () => {
    pi.events.emit("pi-conductor:tool-policy", {
      version: 1,
      kind: "unregister",
      owner: "pi-continuity",
    });
  });
  pi.on("agent_start", (_e, ctx) => refresh(ctx));
  pi.on("agent_settled", async (_e, ctx) => {
    hideTasks(ctx);
    await compactMemory();
  });
  pi.on("tool_call", (event) => {
    if (blocked(work?.mode === "planning", event.toolName))
      return {
        block: true,
        reason: "Plan mode is read-only. Approve or cancel plan first.",
      };
  });
  pi.on("input", (event) => {
    if (event.source !== "extension") lastPrompt = event.text;
  });
  pi.on("context", (event) => {
    const activeWork =
      work && !["completed", "cancelled"].includes(work.mode)
        ? work
        : undefined;
    const text = buildContext(activeWork, facts, lastPrompt, 900, parentFacts);
    if (text)
      return {
        messages: [
          ...event.messages,
          {
            role: "custom",
            customType: "pi-continuity",
            content:
              text +
              (work?.mode === "planning"
                ? "\nPlanning gate active. Inspect only. Clarify unresolved decisions, then call continuity_update set_plan before requesting approval."
                : ""),
            display: false,
            timestamp: Date.now(),
          },
        ],
      };
  });
  pi.registerTool({
    name: "continuity_update",
    label: "Continuity Update",
    description:
      "Update plan, todos, state, clarification, or durable-memory candidate.",
    promptGuidelines: [
      "For every non-trivial multi-step task, call continuity_update set_plan with brief todos before execution even when user did not invoke /plan; this creates an executing task list without activating the planning gate. During explicit planning use clarify only for unresolved user decisions, then set_plan. During execution, use exact todo IDs from Continuity context: mark one todo in_progress before work, then mark it done immediately after verification. Before final response, update every todo touched this turn and set completion true when none remain. Record concise failures/next action. Propose memory only for durable non-secret facts.",
    ],
    renderShell: "self",
    renderCall: () => new Container(),
    renderResult: () => new Container(),
    parameters: Type.Object(
      {
        action: Action,
        question: Type.Optional(Type.String({ maxLength: 500 })),
        options: Type.Optional(
          Type.Array(
            Type.Object({
              label: Type.String({ maxLength: 120 }),
              description: Type.Optional(Type.String({ maxLength: 240 })),
            }),
          ),
        ),
        goal: Type.Optional(Type.String({ maxLength: 2000 })),
        constraints: Type.Optional(
          Type.Array(Type.String({ maxLength: 500 }), { maxItems: 12 }),
        ),
        planSummary: Type.Optional(Type.String({ maxLength: 4000 })),
        todos: Type.Optional(
          Type.Array(Type.String({ maxLength: 120 }), { maxItems: 12 }),
        ),
        todoId: Type.Optional(
          Type.String({
            description:
              "Exact todo ID shown in Continuity context, such as todo_1",
          }),
        ),
        status: Type.Optional(Status),
        currentTodoId: Type.Optional(Type.String()),
        latestFailure: Type.Optional(Type.String({ maxLength: 1000 })),
        nextAction: Type.Optional(Type.String({ maxLength: 1000 })),        completion: Type.Optional(Type.Boolean()),
        key: Type.Optional(Type.String({ maxLength: 200 })),        kind: Type.Optional(Kind),
        text: Type.Optional(Type.String({ maxLength: 1000 })),
        source: Type.Optional(Type.String({ maxLength: 500 })),        confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        memoryAction: Type.Optional(MemAction),
      },
      { additionalProperties: false },
    ),
    async execute(_i, p, _s, _u, ctx): Promise<any> {
      if (p.action === "clarify") {
        if (work?.mode !== "planning")
          return {
            content: [
              {
                type: "text",
                text: "Clarification available only during planning.",
              },
            ],
          };
        validateQuestion(p.question || "", p.options || []);
        if (!ctx.hasUI)
          return {
            content: [
              {
                type: "text",
                text: `Ask user in prose and wait: ${p.question}`,
              },
            ],
          };
        const labels = [
          ...(p.options || []).map((o) =>
            o.description ? `${o.label} — ${o.description}` : o.label,
          ),
          "Write a different answer…",
        ];
        const choice = await ctx.ui.select(p.question!, labels);
        if (!choice)
          return { content: [{ type: "text", text: "No answer selected." }] };
        if (choice === "Write a different answer…") {
          const answer = await ctx.ui.editor("Custom answer", "");
          return {
            content: [
              { type: "text", text: answer?.trim() || "No answer selected." },
            ],
          };
        }
        return { content: [{ type: "text", text: choice }] };
      }
      if (p.action === "set_plan") {
        const planning = work?.mode === "planning";
        if (!planning && !(p.todos?.length))
          return {
            content: [
              {
                type: "text",
                text: "At least one todo is required outside explicit plan mode.",
              },
            ],
          };
        if (!work || work.mode === "completed" || work.mode === "cancelled") {
          work = fresh(p.goal?.trim() || lastPrompt);
          work.mode = "executing";
          work.approved = true;
        }
        const now = new Date().toISOString();
        work.goal = p.goal?.trim() || work.goal;
        work.constraints = (p.constraints || []).slice(0, 12);
        work.planSummary = p.planSummary?.trim() || "";
        setPlan(work, p.todos || [], now);
        work.updatedAt = now;
        await saveWork();
        refresh(ctx);
        return {
          content: [
            {
              type: "text",
              text: planning
                ? "Plan stored. Await explicit /plan approve."
                : "Executing task list stored.",
            },
          ],
        };
      }
      if (p.action === "memory_candidate") {
        if (
          !p.key ||
          !p.kind ||
          !p.text ||
          !p.source ||
          p.confidence === undefined ||
          !p.memoryAction
        )
          return {
            content: [
              { type: "text", text: "Missing memory candidate fields." },
            ],
          };
        const next = candidate({
          key: p.key,
          kind: p.kind,
          text: p.text,
          source: p.source,
          confidence: p.confidence,
          action: p.memoryAction,
        });
        candidates = await withStateLock(dir, async () =>
          (
            await updateJson(
              paths().candidates,
              { schemaVersion: 1 as const, candidates: [] as Candidate[] },
              (file) => ({
                schemaVersion: 1 as const,
                candidates: [...file.candidates, next],
              }),
              isCandidatesFile,
            )
          ).candidates,
        );
        return {
          content: [{ type: "text", text: "Memory candidate stored." }],
        };
      }
      if (!work)
        return { content: [{ type: "text", text: "No active work." }] };
      if (p.action === "todo") {
        if (!p.todoId || !p.status || !updateTodo(work, p.todoId, p.status))
          return {
            content: [
              {
                type: "text",
                text: `Unknown todo or status. Valid IDs: ${work.todos.map((t) => t.id).join(", ") || "none"}.`,
              },
            ],
          };
        if (p.latestFailure !== undefined) work.latestFailure = p.latestFailure;
        if (p.nextAction !== undefined) work.nextAction = p.nextAction;
      } else if (p.action === "state") {
        work.currentTodoId = p.currentTodoId ?? work.currentTodoId;
        if (p.latestFailure !== undefined) work.latestFailure = p.latestFailure;
        if (p.nextAction !== undefined) work.nextAction = p.nextAction;
        if (p.completion) {
          if (hasRemainingTodos(work))
            return {
              content: [
                { type: "text", text: "Cannot complete while todos remain." },
              ],
            };
          work.mode = "completed";
          work.currentTodoId = undefined;
          work.completedAt = new Date().toISOString();
          gate(false);
        }
      }
      work.updatedAt = new Date().toISOString();
      await saveWork();
      refresh(ctx);
      return { content: [{ type: "text", text: "Continuity state updated." }] };
    },
  });
  pi.registerCommand("plan", {
    description: "Start, approve, cancel, or inspect plan",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (value === "approve") {
        if (!work?.planSummary)
          return void ctx.ui.notify("No stored plan.", "error");
        work.mode = "executing";
        work.approved = true;
        await saveWork();
        gate(false);
        refresh(ctx);
        pi.sendUserMessage(
          "Execute approved stored plan. Track and verify todos.",
        );
        return;
      }
      if (value === "cancel") {
        if (work) {
          work.mode = "cancelled";
          await saveWork();
        }
        gate(false);
        refresh(ctx);
        return;
      }
      if (value === "status") {
        ctx.ui.notify(
          work ? `${work.mode}: ${work.goal}` : "No active work.",
          "info",
        );
        return;
      }
      work = fresh(value);
      savedTools = pi.getActiveTools();
      gate(true);
      await saveWork();
      refresh(ctx);
      if (value)
        pi.sendUserMessage(
          `Plan this task without modifying project files: ${value}`,
        );
    },
  });
  pi.registerCommand("todos", {
    description: "Show continuity todos",
    handler: async (_a, ctx) =>
      ctx.ui.notify(
        work?.todos.map((t) => `${t.id} ${t.status} ${t.text}`).join("\n") ||
          "No todos.",
        "info",
      ),
  });
  pi.registerCommand("memory", {
    description: "Inspect, compact, or forget workspace memory",
    handler: async (args, ctx) => {
      const sub = args.trim();
      if (sub === "compact") {
        await compactMemory();
        ctx.ui.notify(
          `Applied memory candidates. ${facts.length} facts.`,
          "info",
        );
      } else if (sub === "show")
        ctx.ui.notify(
          facts.map((f) => `${f.key}: ${f.text}`).join("\n") || "No facts.",
          "info",
        );
      else if (sub === "forget workspace") {
        if (
          !ctx.hasUI ||
          !(await ctx.ui.confirm(
            "Forget continuity workspace?",
            workspace?.canonicalPath || ctx.cwd,
          ))
        )
          return;
        await rm(dir, { recursive: true, force: true });
        if (workspace)
          await updateJson<Workspace[]>(
            join(root, "workspaces.json"),
            [],
            (items) =>
              items
                .filter((item) => item.id !== workspace!.id)
                .map((item) =>
                  item.parentId === workspace!.id
                    ? (({ parentId: _parentId, ...rest }) => rest)(item)
                    : item,
                ),
            Array.isArray,
          );
        work = undefined;
        facts = [];
        candidates = [];
        gate(false);
        refresh(ctx);
      } else
        ctx.ui.notify(
          `${facts.length} facts, ${candidates.filter((c) => c.status === "pending").length} pending candidates.`,
          "info",
        );
    },
  });
}
