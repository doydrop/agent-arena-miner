import fs from "node:fs/promises";
import path from "node:path";
import { ASSUMPTIONS } from "../delphi/assumptions.js";
import type { AppConfig } from "../config.js";
import type { DelphiGateway } from "../delphi/client.js";

export async function writeFeedback(
  config: AppConfig,
  gateway: DelphiGateway,
  message: string,
): Promise<{ file: string; sent: boolean; detail: string }> {
  const body = message.trim() || "Describe what went wrong, what you expected, and the exact error text.";
  const text = [
    "# Evidence Mining feedback",
    "",
    "Send this note for the feedback bounty. Do not paste your API key.",
    "",
    `- Agent id: ${config.agentId}`,
    `- Harness: ${config.agentHarness}`,
    `- Model: ${config.agentModel || "(none)"}`,
    `- SDK expected: ${ASSUMPTIONS.sdk}@${ASSUMPTIONS.sdkVersion}`,
    `- Mode: ${config.live ? "live" : "dry-run"}`,
    `- API URL: ${config.apiUrl}`,
    `- Wrote at: ${new Date().toISOString()}`,
    "",
    "## What happened",
    "",
    body,
    "",
    "## What I expected",
    "",
    "",
    "## Error text",
    "",
    "",
  ].join("\n");
  const file = path.join(config.dataDir, "feedback-draft.md");
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(file, text);
  if (!config.feedbackSend) {
    return {
      file,
      sent: false,
      detail: "Saved the note. It was not posted. Add --send only after DELPHI_FEEDBACK_URL exists.",
    };
  }
  const result = await gateway.feedback(text);
  return { file, sent: result.sent, detail: result.detail };
}
