import fs from "node:fs/promises";
import path from "node:path";
import type { Draft } from "../types.js";

export interface EvidencePdfInput {
  market: string;
  side: string;
  oddsLabel: string;
  sourceUrl: string;
  sourceDate: string;
  quote: string;
  rationale: string;
  sample: boolean;
  fileNumber: number;
  fileLimit: number;
}

/** Windows-1252 bytes for characters a Type1 Helvetica font can show. */
function toWinAnsi(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 32;
    const mapped = WIN1252.get(code);
    if (mapped != null) bytes.push(mapped);
    else if (code >= 32 && code <= 126) bytes.push(code);
    else if (code >= 160 && code <= 255) bytes.push(code);
    else bytes.push(63);
  }
  return bytes;
}

const WIN1252 = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
]);

function pdfLiteral(text: string): string {
  return `(${toWinAnsi(text)
    .map((byte) => {
      if (byte === 0x5c || byte === 0x28 || byte === 0x29) return `\\${String.fromCharCode(byte)}`;
      if (byte < 32 || byte > 126) return `\\${byte.toString(8).padStart(3, "0")}`;
      return String.fromCharCode(byte);
    })
    .join("")})`;
}

function wrap(text: string, size: number, width: number): string[] {
  const maxChars = Math.max(12, Math.floor(width / (size * 0.5)));
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/**
 * A one-page PDF with no library. Helvetica only, so the file stays tiny.
 * The note sent to Delphi keeps the original Unicode. This page is the attachment.
 */
export function buildEvidencePdf(input: EvidencePdfInput): Buffer {
  const commands: string[] = [];
  const ink = "0.141 0.110 0.094";
  const muted = "0.420 0.380 0.350";
  const pink = "0.714 0.420 0.490";
  let y = 710;

  const draw = (font: "F1" | "F2", size: number, x: number, color: string, text: string) => {
    commands.push("BT", `${color} rg`, `/${font} ${size} Tf`, `1 0 0 1 ${x} ${y} Tm`, `${pdfLiteral(text)} Tj`, "ET");
  };

  commands.push("0.957 0.925 0.890 rg", "0 742 612 50 re f", `${pink} rg`, "0 742 8 50 re f");
  y = 768;
  draw("F2", 11, 54, pink, "EVIDENCE NOTE");
  y = 750;
  draw("F1", 9, 400, muted, input.sample ? "SAMPLE DATA" : "PUBLIC SOURCE");

  const block = (label: string, body: string, size = 11, maxLines = 8) => {
    if (y < 72) return;
    y -= 8;
    draw("F2", 8, 54, pink, label.toUpperCase());
    y -= 16;
    const lines = wrap(body, size, 500).slice(0, maxLines);
    for (const line of lines) {
      if (y < 64) return;
      draw("F1", size, 54, ink, line);
      y -= size + 4;
    }
  };

  block("Market", input.market, 13, 4);
  block("Side", `${input.side}    odds ${input.oddsLabel}`, 12, 1);
  block("Source", input.sourceUrl, 10, 3);
  block("Source date", input.sourceDate, 11, 1);
  block("Quoted excerpt", input.quote, 11, 10);
  block("Rationale", input.rationale, 10, 6);

  y = 46;
  draw(
    "F1",
    8,
    54,
    muted,
    `File ${input.fileNumber} of up to ${input.fileLimit}. This PDF counts toward the 3-file limit. Page 1 of 1.`,
  );

  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

export function pdfInputFromDraft(draft: Draft, fileNumber: number): EvidencePdfInput {
  return {
    market: draft.question,
    side: draft.side ?? "UNSET",
    oddsLabel: Number.isFinite(draft.oddsYes) ? `${Math.round(draft.oddsYes * 100)}%` : "unknown",
    sourceUrl: draft.links[0]?.url ?? "none",
    sourceDate: draft.publishedAt ? draft.publishedAt.slice(0, 10) : "unknown",
    quote: draft.quote || "No quote yet.",
    rationale: draft.rationale || "The quote above is copied from the source. It does not add a fact of its own.",
    sample: draft.sample,
    fileNumber,
    fileLimit: 3,
  };
}

/** Add or remove the evidence PDF so the draft stays within the 3-file cap. */
export async function syncEvidencePdf(draft: Draft, dataDir: string, enabled: boolean): Promise<void> {
  draft.files = draft.files.filter((file) => file.role !== "evidence-pdf");
  draft.pdfSkipped = null;
  const relative = `files/${draft.id}.pdf`;
  const absolute = path.join(dataDir, "files", `${draft.id}.pdf`);
  if (!enabled) {
    await fs.rm(absolute, { force: true });
    return;
  }
  if (draft.files.length >= 3) {
    draft.pdfSkipped = "The PDF was skipped because this draft already has 3 files.";
    await fs.rm(absolute, { force: true });
    return;
  }
  const bytes = buildEvidencePdf(pdfInputFromDraft(draft, draft.files.length + 1));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, bytes);
  draft.files.unshift({
    id: "pdf",
    role: "evidence-pdf",
    name: "evidence-note.pdf",
    type: "application/pdf",
    path: relative,
  });
}
