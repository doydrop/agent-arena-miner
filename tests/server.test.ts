import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createDryGateway } from "../src/delphi/client.js";
import { Ledger } from "../src/ledger/store.js";
import { runPipeline } from "../src/pipeline.js";
import { createLogger } from "../src/redact.js";
import { startDashboard } from "../src/server/dashboard.js";

const root = path.resolve(import.meta.dirname, "..");
const secret = "super-secret-key-xyz";
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dash-"));
const config = loadConfig(["--sample", "--no-open"], {
  PORT: "0",
  DATA_DIR: dir,
  DELPHI_API_ACCESS_KEY: secret,
  ATTACH_EVIDENCE_PDF: "true",
}, root, { loadEnvFile: false });
const ledger = await Ledger.open(dir);
const log = createLogger(config.secrets);
await runPipeline({ config, ledger, log });
const server = await startDashboard({
  config,
  ledger,
  gateway: createDryGateway(),
  log,
  run: (opts) => runPipeline(opts),
});

afterAll(async () => {
  await server.close();
});

describe("dashboard", () => {
  it("serves the sample queue and never echoes the API key", async () => {
    const response = await fetch(`${server.url}/api/state`);
    const text = await response.text();
    expect(text).not.toContain(secret);
    const state = JSON.parse(text);
    expect(state.product).toBe("evidence-miner");
    expect(state.mode).toBe("dry-run");
    expect(state.sample).toBe(true);
    expect(state.queueCount).toBe(4);
    expect(state.ledgerCount).toBe(6);
    expect(state.coverage.submissions).toBe(4);
    expect(state.coverage.markets).toBe(2);
    const city = state.coverage.perMarket.find((row: { name: string }) => row.name === "Fictional City");
    expect(city.slots).toEqual([true, true, false]);
    expect(city.remaining).toBe(1);
    const coffee = state.drafts.find((row: { id: string }) => row.id === "draft-coffee");
    const rain = state.drafts.find((row: { id: string }) => row.id === "draft-rain");
    expect(coffee.gates.ok).toBe(false);
    expect(rain.gates.ok).toBe(true);
    expect(rain.files.some((file: { role: string }) => file.role === "evidence-pdf")).toBe(true);
    expect(rain.files.length).toBeLessThanOrEqual(3);
    const page = await fetch(`${server.url}/queue`);
    expect(await page.text()).toContain("Evidence Mining");
    const pdf = await fetch(`${server.url}/api/drafts/draft-rain/files/pdf`);
    expect((await pdf.text()).startsWith("%PDF-")).toBe(true);
  });

  it("locks Approve until the gate passes, then keeps the approval local", async () => {
    const blocked = await fetch(`${server.url}/api/drafts/draft-coffee/approve`, { method: "POST" });
    expect(blocked.status).toBe(400);
    const png = await fs.readFile(path.join(root, "public", "sample-post.png"));
    const uploaded = await fetch(`${server.url}/api/drafts/draft-coffee/screenshot`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-filename": "coffee.png" },
      body: png,
    });
    expect(uploaded.status).toBe(200);
    const approved = await fetch(`${server.url}/api/drafts/draft-coffee/approve`, { method: "POST" });
    const body = await approved.json();
    expect(approved.status).toBe(200);
    expect(body.sent).toBe(false);
    expect(body.message).toMatch(/Nothing was sent/);
    const state = await (await fetch(`${server.url}/api/state`)).json();
    expect(state.drafts.some((row: { id: string }) => row.id === "draft-coffee")).toBe(false);
    expect(JSON.stringify(state)).not.toContain(secret);
  });
});
