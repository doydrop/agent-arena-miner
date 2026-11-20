import type { AppConfig } from "./config.js";
import type { TermsSnapshot } from "./delphi/client.js";
import { evaluateGates, historyFromSubmissions, needsScreenshot } from "./gates/quality.js";
import type { Ledger } from "./ledger/store.js";
import { marketSlots, qualificationOf } from "./picker/pick.js";
import type { Draft, GateReport } from "./types.js";

export interface PublicChip {
  id: string;
  label: string;
  tone: "ok" | "bad";
}

export interface PublicFile {
  id: string;
  role: string;
  name: string;
  type: string;
  href: string;
}

export interface PublicDraft {
  id: string;
  question: string;
  shortName: string;
  marketAddress: string;
  side: Draft["side"];
  oddsYes: number;
  oddsLabel: string;
  quote: string;
  note: string;
  rationale: string;
  links: { url: string; label: string }[];
  extraSource: string | null;
  sourceHost: string;
  publishedAt: string | null;
  collectedLabel: string;
  kindLabel: string;
  preview: Draft["preview"];
  sample: boolean;
  files: PublicFile[];
  fileSlots: boolean[];
  pdfSkipped: string | null;
  gates: GateReport;
  chips: PublicChip[];
  slots: boolean[];
  slotsUsed: number;
  slotsRemaining: number;
}

export interface PublicState {
  product: "evidence-miner";
  mode: "dry-run" | "live";
  sample: boolean;
  owner: string;
  agentId: string;
  port: number;
  attachPdf: boolean;
  terms: TermsSnapshot;
  coverage: ReturnType<typeof qualificationOf>;
  drafts: PublicDraft[];
  submissions: {
    id: string;
    question: string;
    shortName: string;
    side: string;
    status: string;
    verdict: string | null;
    reason: string | null;
    rewardLabel: string;
    when: string;
    idempotency: string | null;
    sample: boolean;
    remoteId: string | null;
  }[];
  notes: {
    id: string;
    title: string;
    shortName: string;
    quote: string;
    url: string;
    when: string;
    sample: boolean;
  }[];
  lastScan: Ledger["lastScan"];
  queueCount: number;
  ledgerCount: number;
  ready: number;
  blocked: number;
}

export function toPublicState(config: AppConfig, ledger: Ledger, terms: TermsSnapshot): PublicState {
  const history = historyFromSubmissions(ledger.submissions);
  const names = [
    ...ledger.drafts.map((draft) => ({ address: draft.marketAddress, name: draft.shortName })),
    ...ledger.submissions.map((row) => ({ address: row.marketAddress, name: row.shortName })),
  ];
  const coverage = qualificationOf(ledger.submissions, names);
  const pending = ledger.drafts.filter((draft) => draft.status === "pending");
  const drafts = pending.map((draft) => publicDraft(draft, coverage, history));
  const ready = drafts.filter((draft) => draft.gates.ok).length;
  return {
    product: "evidence-miner",
    mode: config.live ? "live" : "dry-run",
    sample: ledger.sample,
    owner: config.owner,
    agentId: config.agentId,
    port: config.port,
    attachPdf: config.attachPdf,
    terms,
    coverage,
    drafts,
    submissions: ledger.submissions
      .slice()
      .reverse()
      .map((row) => ({
        id: row.id,
        question: row.question,
        shortName: row.shortName,
        side: row.side,
        status: row.status,
        verdict: row.verdict,
        reason: row.reason,
        rewardLabel: row.sample
          ? "Sample · not a payment"
          : row.reward
            ? row.reward
            : row.zeroPayReason
              ? row.zeroPayReason
              : "Waiting",
        when: row.createdAt.slice(0, 16).replace("T", " "),
        idempotency: row.idempotencyKey ? `${row.idempotencyKey.slice(0, 8)}…` : null,
        sample: row.sample,
        remoteId: row.remoteId,
      })),
    notes: ledger.notes
      .slice()
      .reverse()
      .map((note) => ({
        id: note.id,
        title: note.title,
        shortName: note.shortName,
        quote: note.quote,
        url: note.url,
        when: (note.publishedAt ?? note.createdAt).slice(0, 10),
        sample: note.sample,
      })),
    lastScan: ledger.lastScan,
    queueCount: pending.length,
    ledgerCount: Math.max(ledger.notes.length, ledger.submissions.length),
    ready,
    blocked: pending.length - ready,
  };
}

function publicDraft(
  draft: Draft,
  coverage: ReturnType<typeof qualificationOf>,
  history: ReturnType<typeof historyFromSubmissions>,
): PublicDraft {
  const gates = evaluateGates(draft, history);
  const slot = coverage.perMarket.find((row) => row.address.toLowerCase() === draft.marketAddress.toLowerCase()) ?? {
    ...marketSlots(0),
    address: draft.marketAddress,
    name: draft.shortName,
  };
  const files = draft.files.map((file) => ({
    id: file.id,
    role: file.role,
    name: file.name,
    type: file.type,
    href: `/api/drafts/${encodeURIComponent(draft.id)}/files/${encodeURIComponent(file.id)}`,
  }));
  return {
    id: draft.id,
    question: draft.question,
    shortName: draft.shortName,
    marketAddress: draft.marketAddress,
    side: draft.side,
    oddsYes: draft.oddsYes,
    oddsLabel: `${Math.round(draft.oddsYes * 100)}%`,
    quote: draft.quote,
    note: draft.note,
    rationale: draft.rationale,
    links: draft.links,
    extraSource: draft.links.length > 1 ? draft.links[1].label : null,
    sourceHost: draft.sourceHost,
    publishedAt: draft.publishedAt,
    collectedLabel: draft.collectedLabel,
    kindLabel: kindLabel(draft),
    preview: draft.preview,
    sample: draft.sample,
    files,
    fileSlots: marketSlots(draft.files.length).slots,
    pdfSkipped: draft.pdfSkipped,
    gates,
    chips: chips(draft, gates),
    slots: slot.slots,
    slotsUsed: slot.used,
    slotsRemaining: slot.remaining,
  };
}

function chips(draft: Draft, gates: GateReport): PublicChip[] {
  const list: PublicChip[] = [];
  if (draft.plainFetch === "ok") list.push({ id: "url", label: "URL can be opened", tone: "ok" });
  list.push({ id: "quote", label: "Full quote", tone: "ok" });
  const missingShot = needsScreenshot(draft) && !draft.files.some((file) => file.role === "screenshot");
  if (needsScreenshot(draft)) {
    list.push({
      id: "screenshot",
      label: missingShot ? "Needs a screenshot" : "Screenshot attached",
      tone: missingShot ? "bad" : "ok",
    });
  }
  const side = gates.checks.find((check) => check.id === "side");
  if (!missingShot || !side?.ok) {
    list.push({ id: "side", label: side?.ok ? "One side" : "Side not ready", tone: side?.ok ? "ok" : "bad" });
  }
  return list;
}

function kindLabel(draft: Draft): string {
  const count = draft.links.length === 1 ? "1 source" : `${draft.links.length} sources`;
  if (draft.kind === "x") return `${count} · X / social`;
  if (draft.kind === "reddit") return `${count} · Reddit`;
  if (draft.kind === "paywall") return `${count} · paywall`;
  return count;
}
