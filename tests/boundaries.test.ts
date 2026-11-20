import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { redactSecrets } from "../src/redact.js";
import { renderReport, stripColor } from "../src/cli/render.js";
import type { RunReport } from "../src/types.js";

async function files(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("boundaries", () => {
  it("imports the Delphi SDK only from the Delphi client", async () => {
    const root = path.resolve(import.meta.dirname, "../src");
    const offenders: string[] = [];
    for (const file of await files(root)) {
      const text = await fs.readFile(file, "utf8");
      const importsSdk = /from\s+["']@gensyn-ai\/gensyn-delphi-sdk["']/.test(text) || /import\(["']@gensyn-ai\/gensyn-delphi-sdk["']\)/.test(text);
      if (importsSdk && !file.endsWith(`${path.sep}delphi${path.sep}client.ts`)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("redacts the key and keeps dry-run as the default", () => {
    const secret = "super-secret-key-xyz";
    expect(redactSecrets(`Authorization: Bearer ${secret}`, [secret])).not.toContain(secret);
    const config = loadConfig([], { DELPHI_API_ACCESS_KEY: secret }, process.cwd(), { loadEnvFile: false });
    expect(config.live).toBe(false);
    expect(config.preferSample).toBe(false);
    expect(config.attachPdf).toBe(true);
    const off = loadConfig([], { ATTACH_EVIDENCE_PDF: "false" }, process.cwd(), { loadEnvFile: false });
    expect(off.attachPdf).toBe(false);
    expect(() => loadConfig(["--live", "--dry-run"], {}, process.cwd(), { loadEnvFile: false })).toThrow(/either/);
    const report: RunReport = {
      sample: true,
      dryRun: true,
      fallbackReason: null,
      openMarkets: 18,
      steps: [{ at: "09:14", title: "Scan markets", detail: "18 open markets in the sample set", state: "done" }],
      candidates: [{ question: "Will it rain across Fictional City on 30 Nov 2026?", side: "YES", oddsYes: 0.37, evidence: 2, status: "ready for review", tone: "ok" }],
      coverage: { submissions: 4, submissionsGoal: 10, markets: 2, marketsGoal: 3, perMarket: [] },
      sourceCount: 6,
      dashboardUrl: "http://127.0.0.1:3737",
      blocked: 1,
      ready: 3,
    };
    const rendered = renderReport(report, { color: true, command: "pnpm start --dry-run" });
    const plain = stripColor(rendered);
    expect(plain).toContain("NOTHING IS SENT");
    expect(plain).toContain("sample data, not a real market");
    expect(plain).toContain("http://127.0.0.1:3737");
    expect(plain).not.toContain(secret);
  });
});
