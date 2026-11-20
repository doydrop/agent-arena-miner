import { randomUUID } from "node:crypto";
import { absoluteFile, type DelphiGateway, type RemoteReceipt } from "../delphi/client.js";
import { evaluateGates, historyFromSubmissions } from "../gates/quality.js";
import type { Ledger } from "../ledger/store.js";
import type { Draft, SubmissionRecord } from "../types.js";

export interface SubmitOutcome {
  ok: boolean;
  sent: boolean;
  message: string;
  remoteId: string | null;
}

/**
 * Approve one draft.
 * Dry-run records the decision and does not call the gateway.
 * Live mode writes the idempotency key to disk before submitEvidence.
 */
export async function submitApproved(options: {
  draft: Draft;
  ledger: Ledger;
  gateway: DelphiGateway;
  live: boolean;
}): Promise<SubmitOutcome> {
  const { draft, ledger, gateway, live } = options;
  if (draft.status !== "pending") {
    return { ok: false, sent: false, remoteId: null, message: "This draft was already decided." };
  }
  const report = evaluateGates(draft, historyFromSubmissions(ledger.submissions));
  if (!report.ok) {
    const reason = report.checks.find((check) => !check.ok)?.detail ?? "The quality gate is not open.";
    return { ok: false, sent: false, remoteId: null, message: reason };
  }
  if (draft.sample && live) {
    return { ok: false, sent: false, remoteId: null, message: "Sample drafts are never sent to Delphi." };
  }
  if (!live) {
    draft.status = "approved";
    ledger.submissions.push(localRecord(draft, "dry_run", "Approved on this computer. Nothing was sent."));
    await ledger.save();
    return {
      ok: true,
      sent: false,
      remoteId: null,
      message: "Approved on this computer. Nothing was sent to Delphi.",
    };
  }

  const preflight = await gateway.preflight({
    marketAddress: draft.marketAddress,
    note: draft.note,
    links: draft.links.map((link) => link.url),
  });
  if (!preflight.ok) return { ok: false, sent: false, remoteId: null, message: preflight.message };

  if (!draft.idempotencyKey) draft.idempotencyKey = randomUUID();
  await ledger.save();

  try {
    const receipt = await gateway.submit({
      marketAddress: draft.marketAddress,
      note: draft.note,
      links: draft.links.map((link) => link.url),
      idempotencyKey: draft.idempotencyKey,
      files: draft.files.slice(0, 3).map((file) => ({
        path: absoluteFile(ledger.dir, file.path),
        name: file.name,
        type: file.type,
      })),
    });
    draft.status = "approved";
    ledger.submissions.push(remoteRecord(draft, receipt));
    await ledger.save();
    return {
      ok: true,
      sent: true,
      remoteId: receipt.remoteId,
      message: `Sent to Delphi${receipt.remoteId ? ` (${receipt.remoteId})` : ""}. The receipt is in the ledger.`,
    };
  } catch (error) {
    await ledger.save();
    const message = error instanceof Error ? error.message : "Delphi did not accept the submission.";
    return { ok: false, sent: false, remoteId: null, message };
  }
}

export async function rejectDraft(draft: Draft, ledger: Ledger): Promise<string> {
  if (draft.status !== "pending") return "This draft was already decided.";
  draft.status = "rejected";
  ledger.submissions.push(localRecord(draft, "local_reject", "Rejected on this computer. Nothing was sent."));
  await ledger.save();
  return "Rejected. Nothing was sent to Delphi.";
}

export function applyReceipt(ledger: Ledger, remoteId: string, receipt: RemoteReceipt): void {
  const row = ledger.submissions.find((item) => item.remoteId === remoteId);
  if (!row) return;
  row.status = receipt.status;
  row.verdict = receipt.verdict;
  row.reason = receipt.reason;
  row.reward = receipt.reward;
  row.zeroPayReason = receipt.zeroPayReason;
  row.countsAsJudged = receipt.status === "judged";
}

function localRecord(draft: Draft, status: string, reason: string): SubmissionRecord {
  return {
    id: `local-${draft.id}-${Date.now()}`,
    draftId: draft.id,
    marketAddress: draft.marketAddress,
    question: draft.question,
    shortName: draft.shortName,
    side: draft.side ?? "YES",
    note: draft.note,
    links: draft.links.map((link) => link.url),
    idempotencyKey: null,
    remoteId: null,
    status,
    verdict: status === "dry_run" ? "not sent" : "rejected locally",
    reason,
    reward: null,
    zeroPayReason: null,
    sample: draft.sample,
    countsTowardCap: false,
    countsAsJudged: false,
    createdAt: new Date().toISOString(),
    error: null,
  };
}

function remoteRecord(draft: Draft, receipt: RemoteReceipt): SubmissionRecord {
  return {
    id: `sent-${draft.id}`,
    draftId: draft.id,
    marketAddress: draft.marketAddress,
    question: draft.question,
    shortName: draft.shortName,
    side: draft.side ?? "YES",
    note: draft.note,
    links: draft.links.map((link) => link.url),
    idempotencyKey: draft.idempotencyKey,
    remoteId: receipt.remoteId,
    status: receipt.status,
    verdict: receipt.verdict,
    reason: receipt.reason,
    reward: receipt.reward,
    zeroPayReason: receipt.zeroPayReason,
    sample: false,
    countsTowardCap: true,
    countsAsJudged: receipt.status === "judged",
    createdAt: new Date().toISOString(),
    error: null,
  };
}
