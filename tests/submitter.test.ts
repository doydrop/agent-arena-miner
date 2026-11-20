import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DelphiGateway, RemoteReceipt } from "../src/delphi/client.js";
import { Ledger } from "../src/ledger/store.js";
import { submitApproved } from "../src/submit/submit.js";
import type { Draft } from "../src/types.js";

const receipt: RemoteReceipt = {
  remoteId: "sub_1",
  status: "queued",
  verdict: null,
  reason: null,
  reward: null,
  zeroPayReason: null,
  requestId: "req_1",
};

function draft(overrides: Partial<Draft> = {}): Draft {
  const quote = "The agency published the October figure at 3.1 percent after the revision.";
  return {
    id: "draft-live",
    marketAddress: "0xabc",
    question: "Will the October figure be above 3 percent?",
    shortName: "October",
    side: "YES",
    oddsYes: 0.4,
    quote,
    rationale: "Copied from the page.",
    links: [{ url: "https://agency.example/october", label: "agency.example" }],
    sourceHost: "agency.example",
    publishedAt: "2026-11-16T00:00:00.000Z",
    collectedLabel: "16 Nov",
    kind: "news",
    requiresScreenshot: false,
    plainFetch: "ok",
    files: [],
    preview: null,
    sample: false,
    status: "pending",
    idempotencyKey: null,
    pdfSkipped: null,
    createdAt: "2026-11-16T00:00:00.000Z",
    note: `As of 2026-11-16. Side: YES.\n${quote}\nSource:\nhttps://agency.example/october`,
    ...overrides,
  };
}

function gateway(submit: DelphiGateway["submit"]): DelphiGateway {
  return {
    mode: "live",
    async terms() {
      return { ok: true, version: "v1", url: "https://example.invalid/terms", acceptedAt: "2026-11-26T00:00:00.000Z", detail: "ok" };
    },
    async preflight() {
      return { ok: true, message: "ok" };
    },
    submit,
    async wait() {
      return null;
    },
    async feedback() {
      return { sent: false, detail: "no endpoint" };
    },
  };
}

describe("submitter", () => {
  it("does not call Delphi during a dry-run", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sub-"));
    const ledger = await Ledger.open(dir);
    const item = draft();
    ledger.drafts.push(item);
    let called = false;
    const result = await submitApproved({
      draft: item,
      ledger,
      live: false,
      gateway: gateway(async () => {
        called = true;
        return receipt;
      }),
    });
    expect(called).toBe(false);
    expect(result.sent).toBe(false);
    expect(result.message).toMatch(/Nothing was sent/);
    expect(ledger.submissions[0].countsTowardCap).toBe(false);
  });

  it("refuses to send sample data even if live mode was requested", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sub-"));
    const ledger = await Ledger.open(dir);
    const item = draft({ sample: true });
    let called = false;
    const result = await submitApproved({
      draft: item,
      ledger,
      live: true,
      gateway: gateway(async () => {
        called = true;
        return receipt;
      }),
    });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("writes the idempotency key before the submit call and reuses it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sub-"));
    const ledger = await Ledger.open(dir);
    const item = draft();
    ledger.drafts.push(item);
    await ledger.save();
    const keys: string[] = [];
    let calls = 0;
    const resultGateway = gateway(async (input) => {
      const raw = await fs.readFile(path.join(dir, "ledger.json"), "utf8");
      expect(raw).toContain(input.idempotencyKey);
      keys.push(input.idempotencyKey);
      calls += 1;
      if (calls === 1) throw new Error("network dropped");
      return receipt;
    });
    const first = await submitApproved({ draft: item, ledger, live: true, gateway: resultGateway });
    expect(first.ok).toBe(false);
    expect(item.status).toBe("pending");
    expect(item.idempotencyKey).toBeTruthy();
    const second = await submitApproved({ draft: item, ledger, live: true, gateway: resultGateway });
    expect(second.sent).toBe(true);
    expect(keys[0]).toBe(keys[1]);
    expect(ledger.submissions.some((row) => row.countsTowardCap && row.idempotencyKey === keys[0])).toBe(true);
  });
});
