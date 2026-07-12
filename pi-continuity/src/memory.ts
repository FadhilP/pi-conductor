import { randomUUID } from "node:crypto";
import { assertSafe } from "./secrets.ts";
export type Fact = {
  key: string;
  kind: "workflow" | "structure" | "architecture" | "warning" | "preference";
  text: string;
  source: string;
  confidence: number;
  updatedAt: string;
};
export type Candidate = Fact & {
  id: string;
  action: "add" | "replace" | "remove";
  status: "pending" | "applied" | "rejected";
  createdAt: string;
  decidedAt?: string;
};
export type MemoryFile = { schemaVersion: 1; facts: Fact[]; updatedAt?: string };
export type CandidatesFile = { schemaVersion: 1; candidates: Candidate[] };
const kinds = new Set(["workflow", "structure", "architecture", "warning", "preference"]);
const actions = new Set(["add", "replace", "remove"]);
const statuses = new Set(["pending", "applied", "rejected"]);
const safeStrings = (...values: string[]) => {
  try { assertSafe(...values); return true; } catch { return false; }
};
export function isFact(value: any): value is Fact {
  return value && typeof value.key === "string" && value.key.trim() &&
    kinds.has(value.kind) && typeof value.text === "string" && value.text.trim() &&
    typeof value.source === "string" && value.source.trim() &&
    typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 1 &&
    typeof value.updatedAt === "string" && safeStrings(value.key, value.text, value.source);
}
export function isCandidate(value: any): value is Candidate {
  if (!isFact(value)) return false;
  const input = value as any;
  return typeof input.id === "string" && input.id &&
    actions.has(input.action) && statuses.has(input.status) &&
    typeof input.createdAt === "string" &&
    (input.decidedAt === undefined || typeof input.decidedAt === "string");
}
export const isMemoryFile = (value: any): value is MemoryFile =>
  value?.schemaVersion === 1 && Array.isArray(value.facts) && value.facts.every(isFact);
export const isCandidatesFile = (value: any): value is CandidatesFile =>
  value?.schemaVersion === 1 && Array.isArray(value.candidates) && value.candidates.every(isCandidate);
const retentionPriority = (fact: Fact) =>
  fact.kind === "preference" ? 2 : fact.kind === "warning" ? 1 : 0;
export function candidate(
  input: Omit<Candidate, "id" | "status" | "createdAt" | "updatedAt">,
): Candidate {
  assertSafe(input.key, input.text, input.source);
  const now = new Date().toISOString();
  return {
    ...input,
    id: randomUUID(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
}
export function compact(facts: Fact[], candidates: Candidate[], max = 80) {
  const keyed = new Map(facts.map((fact) => [fact.key, fact]));
  for (const item of candidates.filter((item) => item.status === "pending")) {
    if (item.action === "remove") keyed.delete(item.key);
    else
      keyed.set(item.key, {
        key: item.key,
        kind: item.kind,
        text: item.text,
        source: item.source,
        confidence: item.confidence,
        updatedAt: new Date().toISOString(),
      });
  }
  const kept = [...keyed.values()]
    .sort(
      (a, b) =>
        retentionPriority(b) - retentionPriority(a) ||
        b.confidence - a.confidence ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, max);
  return { facts: kept, candidates: [] as Candidate[] };
}
