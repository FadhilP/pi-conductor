export const RUN_ENTRY_TYPE = "pi-conductor-run";
export const HANDOFF_ENTRY_TYPE = "pi-continuity-handoff";
export type RunRole = "planner" | "executor" | "reviewer";
export type RunEntry = {
  version: 1;
  runId: string;
  role: RunRole;
  parentSessionId?: string;
  createdAt: string;
};

export function isRunEntry(value: any): value is RunEntry {
  return Boolean(
    value?.version === 1 &&
      typeof value.runId === "string" &&
      value.runId.length > 0 &&
      ["planner", "executor", "reviewer"].includes(value.role) &&
      (value.parentSessionId === undefined ||
        typeof value.parentSessionId === "string") &&
      typeof value.createdAt === "string",
  );
}
