import type { Job } from "./jobs.ts";
export function jobContext(jobs: Job[]) {
  const selected = jobs
    .filter(
      (j) =>
        j.state === "running" ||
        j.state === "cancelling" ||
        !j.completionAnnounced,
    )
    .slice(0, 4);
  if (!selected.length) return "";
  for (const j of selected)
    if (!["running", "cancelling"].includes(j.state))
      j.completionAnnounced = true;
  return `Background jobs:\n${selected.map((j) => `- ${j.id} ${j.label}: ${j.state}${j.exitCode !== undefined ? `, exit ${j.exitCode}` : ""}`).join("\n")}\nCall heartbeat_status for output.`.slice(
    0,
    1200,
  );
}
