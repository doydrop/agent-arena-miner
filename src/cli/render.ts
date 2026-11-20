import os from "node:os";
import type { RunReport } from "../types.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[38;5;245m";
const GREEN = "\x1b[38;5;78m";
const RED = "\x1b[38;5;203m";
const AMBER = "\x1b[38;5;215m";
const PINK = "\x1b[38;5;217m";
const CREAM = "\x1b[38;5;224m";
const WHITE = "\x1b[38;5;255m";
const BAR = "\x1b[48;5;52m";

export function renderReport(
  report: RunReport,
  options: { color?: boolean; command?: string; cwd?: string; owner?: string } = {},
): string {
  const color = options.color !== false;
  const paint = (code: string, text: string) => (color ? `${code}${text}${RESET}` : text);
  const width = Math.max(72, Math.min(process.stdout.columns || 100, 110));
  const line = (text = "") => text;
  const command = options.command ?? (report.dryRun ? "pnpm start --dry-run" : "pnpm start --live");
  const cwd = options.cwd ?? process.cwd();
  const who = options.owner ?? os.userInfo().username;
  const host = os.hostname().split(".")[0];

  const banner = report.dryRun
    ? report.sample
      ? " TEST MODE — NOTHING IS SENT    ·    sample data, not a real market "
      : " TEST MODE — NOTHING IS SENT "
    : " LIVE — AN APPROVAL IS SENT TO DELPHI ";

  const rows = report.candidates.map((candidate, index) => ({
    n: String(index + 1),
    market: candidate.question,
    side: candidate.side ?? "—",
    odds: Number.isFinite(candidate.oddsYes) ? `${Math.round(candidate.oddsYes * 100)}%` : "—",
    evidence: String(candidate.evidence),
    status: candidate.status,
    tone: candidate.tone,
    sideTone: candidate.side === "NO" ? "no" : "yes",
  }));

  const inner = Math.max(40, width - 2);
  const marketWidth = Math.max(18, Math.min(46, inner - 40));
  const header = ["#", "MARKET", "SIDE", "ODDS", "EVIDENCE", "STATUS"];
  const cols = [3, marketWidth, 6, 6, 10, 18];
  const rule = "─".repeat(inner);
  const out: string[] = ["", paint(DIM, clip(`${who}@${host}  ${cwd}`, inner)), "", paint(WHITE, `> ${command}`), ""];
  out.push(paint(BAR + PINK, banner.padEnd(inner, " ").slice(0, inner)));
  if (report.fallbackReason) {
    for (const part of wrap(report.fallbackReason, inner)) out.push(paint(AMBER, part));
  }
  out.push("");

  for (const step of report.steps) {
    const mark = step.state === "wait" ? paint(AMBER, "○") : step.state === "fail" ? paint(RED, "×") : paint(GREEN, "✓");
    out.push(`  ${paint(DIM, step.at)}  ${mark}  ${paint(BOLD + WHITE, step.title)}`);
    for (const part of wrap(step.detail, inner - 8)) out.push(`         ${paint(DIM, part)}`);
  }

  out.push("");
  out.push(
    `  ${paint(BOLD + CREAM, "CANDIDATES READY FOR REVIEW")}  ${paint(DIM, report.sample ? "sample data" : "your queue")}`,
  );
  out.push(`  ${paint(DIM, header.map((cell, index) => cell.padEnd(cols[index])).join(" "))}`);
  if (rows.length === 0) {
    out.push(paint(DIM, "  The queue is empty."));
  }
  for (const row of rows) {
    const side = row.sideTone === "no" ? paint(RED, row.side.padEnd(cols[2])) : paint(GREEN, row.side.padEnd(cols[2]));
    const status = row.tone === "warn" ? paint(AMBER, row.status) : paint(GREEN, row.status);
    out.push(
      `  ${row.n.padEnd(cols[0])} ${clip(row.market, cols[1]).padEnd(cols[1])} ${side} ${row.odds.padEnd(cols[3])} ${row.evidence.padEnd(cols[4])} ${status}`,
    );
  }

  const coverage = report.coverage;
  out.push("");
  out.push(`  ${paint(DIM, rule)}`);
  out.push(
    `  ${paint(CREAM, "Qualification progress:")} ${coverage.submissions}/${coverage.submissionsGoal} submissions, ${coverage.markets}/${coverage.marketsGoal} markets  ${paint(DIM, "· cap 3 per market")}`,
  );
  out.push(
    `  ${paint(DIM, report.dryRun ? "Dry-run · runs automatically each morning · nothing is POSTed to Delphi" : "Live · only an approved draft is POSTed, and only after the terms are accepted")}`,
  );
  out.push("");
  out.push(`  ${paint(WHITE, "Next:")} open ${paint(BOLD + PINK, report.dashboardUrl)} to approve or reject`);
  out.push(`  ${paint(DIM, `${report.ready} ready to approve, ${report.blocked} still at the gate.`)}`);
  out.push(`  ${paint(DIM, "This window stays open while the dashboard is running. Close it and the page stops.")}`);
  out.push("");
  return out.map(line).join("\n");
}

export function stripColor(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function clip(text: string, length: number): string {
  if (text.length <= length) return text;
  return `${text.slice(0, Math.max(1, length - 1))}…`;
}

function wrap(text: string, length: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > length && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}
