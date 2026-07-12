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
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
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
  const out = [...facts];
  for (const c of candidates.filter((c) => c.status === "pending")) {
    if (c.action === "remove") {
      const i = out.findIndex((f) => f.key === c.key);
      if (i >= 0) out.splice(i, 1);
    } else if (c.action === "replace") {
      const i = out.findIndex((f) => f.key === c.key);
      const f: Fact = {
        key: c.key,
        kind: c.kind,
        text: c.text,
        source: c.source,
        confidence: c.confidence,
        updatedAt: new Date().toISOString(),
      };
      i >= 0 ? out.splice(i, 1, f) : out.push(f);
    } else if (
      !out.some((f) => f.key === c.key && norm(f.text) === norm(c.text))
    )
      out.push({
        key: c.key,
        kind: c.kind,
        text: c.text,
        source: c.source,
        confidence: c.confidence,
        updatedAt: new Date().toISOString(),
      });
    c.status = "applied";
    c.decidedAt = new Date().toISOString();
  }
  return { facts: out.slice(-max), candidates };
}
