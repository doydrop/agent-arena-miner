import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildEvidencePdf, syncEvidencePdf } from "../src/pdf/evidence-pdf.js";
import type { Draft } from "../src/types.js";

function draft(files: Draft["files"] = []): Draft {
  return {
    id: "draft-pdf",
    marketAddress: "0x1",
    question: "Will the October figure be above 3 percent?",
    shortName: "October",
    side: "YES",
    oddsYes: 0.42,
    quote: "The agency published the October figure at 3.1 percent.",
    rationale: "The excerpt is copied from the public page and adds no new fact.",
    links: [{ url: "https://agency.example/october", label: "agency.example" }],
    sourceHost: "agency.example",
    publishedAt: "2026-11-16T00:00:00.000Z",
    collectedLabel: "16 Nov",
    kind: "news",
    requiresScreenshot: false,
    plainFetch: "ok",
    files,
    preview: null,
    sample: true,
    status: "pending",
    idempotencyKey: null,
    pdfSkipped: null,
    createdAt: "2026-11-16T00:00:00.000Z",
    note: "As of 2026-11-16. Side: YES.",
  };
}

describe("evidence PDF", () => {
  it("is one page and contains the market, side, source, quote, and rationale", () => {
    const bytes = buildEvidencePdf({
      market: "Will the October figure be above 3 percent?",
      side: "YES",
      oddsLabel: "42%",
      sourceUrl: "https://agency.example/october",
      sourceDate: "2026-11-16",
      quote: "The agency published the October figure at 3.1 percent.",
      rationale: "The excerpt is copied from the public page.",
      sample: true,
      fileNumber: 1,
      fileLimit: 3,
    });
    const text = bytes.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const xref = Number(text.match(/startxref\n(\d+)/)?.[1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    expect(text.match(/\/Type \/Page(?!s)/g)).toHaveLength(1);
    expect(text).toContain("Will the October figure be above 3 percent?");
    expect(text).toContain("YES");
    expect(text).toContain("https://agency.example/october");
    expect(text).toContain("3.1 percent");
    expect(text).toContain("copied from the public page");
    expect(text).toContain("3-file limit");
  });

  it("attaches the PDF only when the toggle is on and a file slot remains", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-"));
    const off = draft();
    await syncEvidencePdf(off, dir, false);
    expect(off.files.some((file) => file.role === "evidence-pdf")).toBe(false);

    const on = draft();
    await syncEvidencePdf(on, dir, true);
    expect(on.files.filter((file) => file.role === "evidence-pdf")).toHaveLength(1);
    const saved = await fs.readFile(path.join(dir, "files", "draft-pdf.pdf"));
    expect(saved.subarray(0, 5).toString()).toBe("%PDF-");

    const full = draft([
      { id: "a", role: "attachment", name: "a.txt", type: "text/plain", path: "files/a.txt" },
      { id: "b", role: "attachment", name: "b.txt", type: "text/plain", path: "files/b.txt" },
      { id: "c", role: "attachment", name: "c.txt", type: "text/plain", path: "files/c.txt" },
    ]);
    await syncEvidencePdf(full, dir, true);
    expect(full.files.some((file) => file.role === "evidence-pdf")).toBe(false);
    expect(full.pdfSkipped).toMatch(/3 files/);

    const room = draft([
      { id: "a", role: "attachment", name: "a.txt", type: "text/plain", path: "files/a.txt" },
      { id: "b", role: "screenshot", name: "b.png", type: "image/png", path: "files/b.png" },
    ]);
    room.id = "draft-room";
    await syncEvidencePdf(room, dir, true);
    expect(room.files).toHaveLength(3);
    expect(room.files[0].role).toBe("evidence-pdf");
  });
});
