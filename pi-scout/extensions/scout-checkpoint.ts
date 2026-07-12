import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { saveCheckpoint } from "../src/checkpoint.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "scout_checkpoint",
    label: "Scout Checkpoint",
    description:
      "Save a compact cited reconnaissance checkpoint for timeout recovery.",
    promptSnippet:
      "Save compact cited repository findings for timeout recovery",
    parameters: Type.Object(
      {
        report: Type.String({ minLength: 1, maxLength: 8192 }),
      },
      { additionalProperties: false },
    ),
    async execute(_id, { report }) {
      const path = process.env.PI_SCOUT_CHECKPOINT_PATH;
      if (!path) throw new Error("PI_SCOUT_CHECKPOINT_PATH is not configured.");
      await saveCheckpoint(path, report);
      return {
        content: [{ type: "text" as const, text: "Scout checkpoint saved." }],
        details: {},
      };
    },
  });
}
