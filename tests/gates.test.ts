import { describe, expect, it } from "vitest";
import { evaluateGates } from "../src/gates/quality.js";
import type { Draft, GateHistoryItem } from "../src/types.js";

const QUOTE = "The agency published the October figure at 3.1 percent after the revision on the public site.";

function draft(overrides: Partial<Draft> = {}): Draft {
  const quote = overrides.quote ?? QUOTE;
  const links = overrides.links ?? [{ url: "https://agency.example/october", label: "agency.example" }];
  return {
    id: "draft-1",
    marketAddress: "0xabc",
    question: "Will the October figure be above 3 percent?",
    shortName: "October",
    side: "YES",
    oddsYes: 0.42,
    quote,
    rationale: "The excerpt is copied from the page.",
    links,
    sourceHost: "agency.example",
    publishedAt: "2026-11-16T00:00:00.000Z",
    collectedLabel: "16 Nov 09:00",
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
    note: `As of 2026-11-16. Side: YES.\n${quote}\nSource:\n${links[0].url}`,
    ...overrides,
  };
}

function past(overrides: Partial<GateHistoryItem> = {}): GateHistoryItem {
  return {
    marketAddress: "0xabc",
    side: "YES",
    quote: "A different earlier fact about the revision process and its public table.",
    note: "A different earlier fact about the revision process and its public table.",
    links: ["https://agency.example/older"],
    countsTowardCap: true,
    ...overrides,
  };
}

describe("quality gates", () => {
  it("passes a dated, fetchable, one-sided quote", () => {
    const report = evaluateGates(draft(), []);
    expect(report.ok).toBe(true);
  });

  it("requires a quote, a date, and a quote inside the note", () => {
    expect(evaluateGates(draft({ quote: "too short", note: "too short" }), []).ok).toBe(false);
    expect(evaluateGates(draft({ publishedAt: null }), []).checks.find((check) => check.id === "date")?.ok).toBe(false);
    expect(evaluateGates(draft({ note: "As of 2026-11-16. Side: YES.\nSource:\nhttps://agency.example/october" }), []).checks.find((check) => check.id === "note")?.ok).toBe(false);
  });

  it("requires a screenshot for X, Reddit, and paywalled pages", () => {
    const shot = { id: "screenshot", role: "screenshot" as const, name: "shot.png", type: "image/png", path: "files/shot.png" };
    expect(evaluateGates(draft({ kind: "x", requiresScreenshot: true, links: [{ url: "https://x.com/post/1", label: "x.com" }], plainFetch: "failed" }), []).ok).toBe(false);
    expect(evaluateGates(draft({ kind: "reddit", requiresScreenshot: true, links: [{ url: "https://reddit.com/r/test", label: "reddit.com" }] }), []).ok).toBe(false);
    expect(evaluateGates(draft({ kind: "paywall", requiresScreenshot: true, plainFetch: "ok" }), []).checks.find((check) => check.id === "screenshot")?.ok).toBe(false);
    const passed = evaluateGates(
      draft({
        kind: "x",
        requiresScreenshot: true,
        links: [{ url: "https://x.com/post/1", label: "x.com" }],
        plainFetch: "failed",
        files: [shot],
        note: `As of 2026-11-16. Side: YES.\n${QUOTE}\nSource:\nhttps://x.com/post/1`,
      }),
      [],
    );
    expect(passed.ok).toBe(true);
  });

  it("blocks a repeated link, the opposite side, and a full market cap", () => {
    expect(evaluateGates(draft(), [past({ links: ["https://agency.example/october"] })]).checks.find((check) => check.id === "dedupe")?.ok).toBe(false);
    expect(evaluateGates(draft({ side: "NO", note: `As of 2026-11-16. Side: NO.\n${QUOTE}` }), [past({ side: "YES" })]).checks.find((check) => check.id === "side")?.ok).toBe(false);
    const full = [past(), past({ links: ["https://agency.example/two"] }), past({ links: ["https://agency.example/three"] })];
    expect(evaluateGates(draft(), full).checks.find((check) => check.id === "cap")?.ok).toBe(false);
  });

  it("holds Approve when there are more than 3 files or a disallowed type", () => {
    const file = (id: string, name: string) => ({ id, role: "attachment" as const, name, type: "text/plain", path: `files/${name}` });
    expect(evaluateGates(draft({ files: [file("a", "a.txt"), file("b", "b.txt"), file("c", "c.txt"), file("d", "d.txt")] }), []).checks.find((check) => check.id === "files")?.ok).toBe(false);
    expect(evaluateGates(draft({ files: [file("a", "notes.docx")] }), []).ok).toBe(false);
  });
});
