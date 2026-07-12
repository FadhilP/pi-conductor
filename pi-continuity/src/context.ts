import type { Work } from "./active-work.ts";
import type { Fact } from "./memory.ts";
const words = (s: string) =>
  new Set(s.toLowerCase().match(/[a-z0-9_-]{3,}/g) || []);
export function buildContext(
  work: Work | undefined,
  facts: Fact[],
  latest = "",
  budget = 900,
  parent: Fact[] = [],
) {
  const query = words(
      `${latest} ${work?.goal || ""} ${work?.todos.find((t) => t.id === work.currentTodoId)?.text || ""}`,
    ),
    score = (f: Fact) =>
      [...words(`${f.key} ${f.text}`)].filter((w) => query.has(w)).length;
  const relevant = (fact: Fact) => fact.kind === "preference" || score(fact) > 0;
  const selected = facts.filter(relevant).sort(
    (a, b) =>
      Number(b.kind === "preference") - Number(a.kind === "preference") ||
      score(b) - score(a) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  const lines = [
    "Continuity context. Durable memory may be stale; direct instructions and repository evidence override it.",
  ];
  if (work)
    lines.push(
      `Work: ${work.mode}; goal: ${work.goal}`,
      work.planSummary ? `Plan: ${work.planSummary}` : "",
      work.currentTodoId
        ? `Current: ${work.todos.find((t) => t.id === work.currentTodoId)?.text || work.currentTodoId}`
        : "",
      work.latestFailure ? `Blocked: ${work.latestFailure}` : "",
      work.nextAction ? `Next: ${work.nextAction}` : "",
      ...work.todos.map((todo) => `Todo ${todo.id} [${todo.status}]: ${todo.text}`),
      ...work.constraints.map((x) => `Constraint: ${x}`),
    );
  lines.push(
    ...selected.map((f) => `Memory ${f.key}: ${f.text}`),
    ...parent
      .filter(relevant)
      .sort(
        (a, b) =>
          Number(b.kind === "preference") - Number(a.kind === "preference") ||
          score(b) - score(a),
      )
      .slice(0, 2)
      .map((f) => `Parent memory ${f.key}: ${f.text}`),
  );
  const content = lines.filter(Boolean);
  if (content.length === 1) return "";
  return content.join("\n").slice(0, budget * 4);
}
