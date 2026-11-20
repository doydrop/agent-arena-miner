export type Side = "YES" | "NO";

export type DraftStatus = "pending" | "approved" | "rejected";

export type FileRole = "evidence-pdf" | "screenshot" | "attachment";

export interface DraftFile {
  id: string;
  role: FileRole;
  name: string;
  type: string;
  /** Path relative to the data directory. */
  path: string;
}

export type SourceKind =
  | "news"
  | "wikipedia"
  | "gdelt"
  | "official"
  | "rss"
  | "x"
  | "reddit"
  | "paywall"
  | "sample";

export type FetchState = "ok" | "failed" | "not_required";

export interface DraftLink {
  url: string;
  label: string;
}

export interface ShotPreview {
  kicker: string;
  title: string;
  body: string;
  footer: string;
}

export interface Draft {
  id: string;
  marketAddress: string;
  question: string;
  shortName: string;
  side: Side | null;
  oddsYes: number;
  note: string;
  quote: string;
  rationale: string;
  links: DraftLink[];
  sourceHost: string;
  publishedAt: string | null;
  collectedLabel: string;
  kind: SourceKind;
  requiresScreenshot: boolean;
  plainFetch: FetchState;
  files: DraftFile[];
  preview: ShotPreview | null;
  sample: boolean;
  status: DraftStatus;
  idempotencyKey: string | null;
  pdfSkipped: string | null;
  createdAt: string;
}

export interface SubmissionRecord {
  id: string;
  draftId: string | null;
  marketAddress: string;
  question: string;
  shortName: string;
  side: Side;
  note: string;
  links: string[];
  idempotencyKey: string | null;
  remoteId: string | null;
  status: string;
  verdict: string | null;
  reason: string | null;
  reward: string | null;
  zeroPayReason: string | null;
  sample: boolean;
  countsTowardCap: boolean;
  countsAsJudged: boolean;
  createdAt: string;
  error: string | null;
}

export interface NoteRecord {
  id: string;
  marketAddress: string;
  shortName: string;
  title: string;
  quote: string;
  url: string;
  publishedAt: string | null;
  sample: boolean;
  createdAt: string;
}

/** A market after the watcher has mapped whatever JSON the feed returned. */
export interface PickerMarket {
  address: string;
  question: string;
  shortName: string;
  status: string;
  /** YES probability in 0..1. NaN when the feed did not include market odds. */
  oddsYes: number;
  forecasterYes: number | null;
  evidenceCutoffAt: string;
  closesAt: string | null;
  rewardPotUsd: number | null;
  dataSources: string[];
}

export interface MarketSlots {
  used: number;
  remaining: number;
  /** True when a sent submission already occupies the slot. */
  slots: boolean[];
}

export interface MarketCoverage extends MarketSlots {
  address: string;
  name: string;
}

export interface Qualification {
  submissions: number;
  submissionsGoal: number;
  markets: number;
  marketsGoal: number;
  perMarket: MarketCoverage[];
}

export interface GateHistoryItem {
  marketAddress: string;
  side: Side;
  quote: string;
  note: string;
  links: string[];
  countsTowardCap: boolean;
}

export interface GateCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface GateReport {
  ok: boolean;
  checks: GateCheck[];
}

export interface RunStep {
  at: string;
  title: string;
  detail: string;
  state: "done" | "wait" | "fail";
}

export interface RunReport {
  sample: boolean;
  dryRun: boolean;
  fallbackReason: string | null;
  openMarkets: number;
  steps: RunStep[];
  candidates: {
    question: string;
    side: Side | null;
    oddsYes: number;
    evidence: number;
    status: string;
    tone: "ok" | "warn";
  }[];
  coverage: Qualification;
  sourceCount: number;
  dashboardUrl: string;
  blocked: number;
  ready: number;
}
